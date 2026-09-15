/**
 * ipCliente.test.js — de onde vem o IP do cliente (Issue #333).
 *
 * O ponto central: X-Forwarded-For só é lido quando a conexão veio de um proxy
 * CONFIÁVEL. Um cabeçalho escrito pelo próprio cliente não pode escolher a
 * chave de rate limit.
 */
const express = require('express');
const request = require('supertest');
const {
    interpretarTrustProxy,
    configurarConfiancaProxy,
    chaveIp,
    ipDoCliente,
    criarListaIps,
    diagnosticoIp,
    FAIXAS_CLOUDFLARE,
} = require('../utils/ipCliente');

/** App mínimo que devolve o IP resolvido com a confiança dada. */
function appCom(trustProxy) {
    const app = express();
    configurarConfiancaProxy(app, trustProxy);
    app.get('/ip', (req, res) => res.json({ ip: ipDoCliente(req), chave: chaveIp(req) }));
    app.get('/diag', (req, res) => res.json(diagnosticoIp(req)));
    return app;
}

describe('interpretarTrustProxy', () => {
    it('sem valor usa 1 salto, que é o balanceador do Render', () => {
        expect(interpretarTrustProxy(undefined)).toEqual({ valor: 1, avisos: [] });
        expect(interpretarTrustProxy('  ')).toEqual({ valor: 1, avisos: [] });
    });

    it.each(['true', 'TRUE', '*', 'all'])(
        'recusa "%s", que confiaria em qualquer cabeçalho',
        (v) => {
            const { valor, avisos } = interpretarTrustProxy(v);
            expect(valor).toBe(1);
            expect(avisos[0]).toMatch(/recusado/);
        }
    );

    it('aceita número de saltos e desliga com 0 ou false', () => {
        expect(interpretarTrustProxy('2').valor).toBe(2);
        expect(interpretarTrustProxy('0').valor).toBe(false);
        expect(interpretarTrustProxy('false').valor).toBe(false);
    });

    it('recusa quantidade de saltos sem sentido', () => {
        const { valor, avisos } = interpretarTrustProxy('50');
        expect(valor).toBe(1);
        expect(avisos).toHaveLength(1);
    });

    it('monta a lista com IPs, faixas e atalhos, ignorando entrada inválida', () => {
        const { valor, avisos } = interpretarTrustProxy(
            'loopback, 10.0.0.0/8, 2001:db8::1, cloudflare, nao-e-ip, 10.0.0.0/99'
        );
        expect(valor).toEqual(
            expect.arrayContaining(['loopback', '10.0.0.0/8', '2001:db8::1', ...FAIXAS_CLOUDFLARE])
        );
        expect(avisos).toHaveLength(2);
    });

    it('lista sem nada válido volta para o padrão', () => {
        const { valor, avisos } = interpretarTrustProxy('nada, lixo');
        expect(valor).toBe(1);
        expect(avisos.at(-1)).toMatch(/nenhuma entrada válida/);
    });
});

describe('IP resolvido atrás de proxy', () => {
    // O supertest conecta pelo loopback: o "proxy" aqui é a própria conexão.

    it('com 1 salto, o cliente é o último endereço da cadeia', async () => {
        const res = await request(appCom('1'))
            .get('/ip')
            .set('X-Forwarded-For', '6.6.6.6, 203.0.113.9');
        // 6.6.6.6 foi escrito por alguém fora da infraestrutura: ignorado.
        expect(res.body.ip).toBe('203.0.113.9');
    });

    it('com lista de proxies, atravessa só os confiáveis', async () => {
        const res = await request(appCom('loopback, 10.0.0.0/8'))
            .get('/ip')
            .set('X-Forwarded-For', '6.6.6.6, 203.0.113.9, 10.1.2.3');
        expect(res.body.ip).toBe('203.0.113.9');
    });

    it('conexão que não é proxy confiável não escolhe o próprio IP', async () => {
        // Só 10.0.0.0/8 é proxy; a conexão vem do loopback, então a cadeia
        // inteira é do cliente e não vale nada.
        const res = await request(appCom('10.0.0.0/8'))
            .get('/ip')
            .set('X-Forwarded-For', '203.0.113.9');
        expect(res.body.ip).toMatch(/^(127\.0\.0\.1|::1)$/);
    });

    it('sem proxy confiável, o X-Forwarded-For é ignorado', async () => {
        const res = await request(appCom('false')).get('/ip').set('X-Forwarded-For', '203.0.113.9');
        expect(res.body.ip).toMatch(/^(127\.0\.0\.1|::1)$/);
    });

    describe('cabeçalho de CDN (IP_CLIENTE_CABECALHO)', () => {
        beforeEach(() => {
            process.env.IP_CLIENTE_CABECALHO = 'CF-Connecting-IP';
        });
        afterEach(() => {
            delete process.env.IP_CLIENTE_CABECALHO;
        });

        it('é lido quando a conexão vem de proxy confiável', async () => {
            const res = await request(appCom('loopback'))
                .get('/ip')
                .set('X-Forwarded-For', '198.51.100.1')
                .set('CF-Connecting-IP', '203.0.113.50');
            expect(res.body.ip).toBe('203.0.113.50');
        });

        it('é ignorado quando a conexão não é proxy confiável', async () => {
            const res = await request(appCom('10.0.0.0/8'))
                .get('/ip')
                .set('CF-Connecting-IP', '203.0.113.50');
            expect(res.body.ip).toMatch(/^(127\.0\.0\.1|::1)$/);
        });

        it('valor que não é IP é descartado', async () => {
            const res = await request(appCom('loopback'))
                .get('/ip')
                .set('X-Forwarded-For', '198.51.100.1')
                .set('CF-Connecting-IP', '<script>');
            expect(res.body.ip).toBe('198.51.100.1');
        });
    });

    it('o diagnóstico mostra conexão, cadeia e IP resolvido', async () => {
        const res = await request(appCom('1')).get('/diag').set('X-Forwarded-For', '203.0.113.9');
        expect(res.body).toMatchObject({
            ipResolvido: '203.0.113.9',
            chaveRateLimit: '203.0.113.9',
            conexaoDeProxyConfiavel: true,
            xForwardedFor: '203.0.113.9',
            trustProxy: '1 salto(s) de proxy',
        });
    });
});

describe('chaveIp', () => {
    const chaveDe = (ip) => chaveIp({ ip, headers: {}, socket: {} });

    it('IPv4 é o próprio endereço, inclusive quando vem mapeado em IPv6', () => {
        expect(chaveDe('203.0.113.9')).toBe('203.0.113.9');
        expect(chaveDe('::ffff:203.0.113.9')).toBe('203.0.113.9');
    });

    it('IPv6 comprimido de formas diferentes cai no mesmo /64', () => {
        const a = chaveDe('2001:db8::1');
        const b = chaveDe('2001:db8:0:0::2');
        const c = chaveDe('2001:0db8:0000:0000:ffff:ffff:ffff:ffff');
        expect(a).toBe('2001:db8:0:0::/64');
        expect(b).toBe(a);
        expect(c).toBe(a);
    });

    it('outro /64 tem outra chave', () => {
        expect(chaveDe('2001:db8:0:1::1')).not.toBe(chaveDe('2001:db8::1'));
    });

    it('tira o zone id e lida com IPv4 embutido', () => {
        expect(chaveDe('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
        expect(chaveDe('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
    });

    it('sem IP válido devolve uma chave fixa, sem quebrar', () => {
        expect(chaveDe(undefined)).toBe('sem-ip');
        expect(chaveDe('lixo')).toBe('sem-ip');
    });
});

describe('criarListaIps', () => {
    it('reconhece endereço e faixa, IPv4 e IPv6', () => {
        const lista = criarListaIps('203.0.113.25, 198.51.100.0/24, 2001:db8::/32');
        expect(lista.total).toBe(3);
        expect(lista.contem('203.0.113.25')).toBe(true);
        expect(lista.contem('198.51.100.77')).toBe(true);
        expect(lista.contem('::ffff:198.51.100.77')).toBe(true);
        expect(lista.contem('2001:db8:1::5')).toBe(true);
        expect(lista.contem('203.0.113.26')).toBe(false);
    });

    it('ignora entrada inválida e informa qual foi', () => {
        const lista = criarListaIps('lixo, 10.0.0.0/40, 10.0.0.1');
        expect(lista.total).toBe(1);
        expect(lista.invalidos).toEqual(['lixo', '10.0.0.0/40']);
    });

    it('lista vazia não contém nada', () => {
        expect(criarListaIps('').contem('10.0.0.1')).toBe(false);
    });
});
