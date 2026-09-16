/**
 * ipCliente.js — de onde vem o IP do cliente, e quando dá para acreditar nele.
 *
 * Atrás do Render (e de qualquer proxy, balanceador ou CDN) a conexão TCP que
 * chega ao Node é do proxy, não do cliente. O IP real viaja no cabeçalho
 * `X-Forwarded-For`, que o próprio cliente também consegue escrever. Ler esse
 * cabeçalho sem critério entrega ao atacante a escolha da própria chave de rate
 * limit: basta mandar um `X-Forwarded-For` diferente a cada requisição.
 *
 * A regra é a do Express (`trust proxy`), só que configurada por ambiente:
 * a cadeia do `X-Forwarded-For` é lida da direita para a esquerda e só se
 * atravessa salto que seja proxy CONFIÁVEL. O primeiro endereço que não é
 * proxy confiável é o cliente. Endereço à esquerda dele foi escrito por quem
 * não controlamos e é ignorado.
 *
 * TRUST_PROXY aceita:
 *   - número de saltos (`1` = só o proxy imediato, que é o caso do Render);
 *   - lista de IPs/faixas CIDR separados por vírgula;
 *   - atalhos: `loopback`, `linklocal`, `uniquelocal` (redes privadas) e
 *     `cloudflare` (faixas publicadas em https://www.cloudflare.com/ips/);
 *   - `false` para desligar (servidor exposto direto, sem proxy).
 * `true` é RECUSADO: confiaria em qualquer `X-Forwarded-For`, que é exatamente
 * o que isto existe para impedir.
 *
 * IP_CLIENTE_CABECALHO (opcional) nomeia um cabeçalho de IP único posto pela
 * CDN, como `cf-connecting-ip`. Ele só é lido quando a conexão veio de um proxy
 * confiável; vindo direto do cliente, é tão falsificável quanto o resto.
 */
const net = require('node:net');
const logger = require('./logger');

// Faixas publicadas pela Cloudflare. Mudam raramente; ao mudar, atualizar aqui.
// Atenção: requisição feita de dentro de um Cloudflare Worker também sai
// dessas faixas. Por isso o atalho é opt-in e não faz parte do padrão.
const FAIXAS_CLOUDFLARE = [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32',
];

// Atalhos que o próprio Express (proxy-addr) já conhece.
const ATALHOS_NATIVOS = new Set(['loopback', 'linklocal', 'uniquelocal']);

// Um salto: o balanceador do Render. Mesmo valor que já rodava em produção.
const TRUST_PROXY_PADRAO = 1;
const MAX_SALTOS = 10;

function faixaValida(texto) {
    const [endereco, prefixo, sobra] = texto.split('/');
    if (sobra !== undefined) return false;
    const versao = net.isIP(endereco);
    if (!versao) return false;
    if (prefixo === undefined) return true;
    if (!/^\d{1,3}$/.test(prefixo)) return false;
    return Number(prefixo) <= (versao === 4 ? 32 : 128);
}

/**
 * Interpreta o valor de TRUST_PROXY. Nunca lança: valor inválido volta para o
 * padrão, com o motivo em `avisos` para o boot registrar.
 *
 * @returns {{ valor: number|false|string[], avisos: string[] }}
 */
function interpretarTrustProxy(bruto) {
    const texto = String(bruto ?? '').trim();
    if (!texto) return { valor: TRUST_PROXY_PADRAO, avisos: [] };

    const minusculo = texto.toLowerCase();
    if (['true', '*', 'all', 'todos'].includes(minusculo)) {
        return {
            valor: TRUST_PROXY_PADRAO,
            avisos: [
                `TRUST_PROXY=${texto} confiaria em qualquer X-Forwarded-For, e qualquer cliente escolheria o próprio IP. Valor recusado; usando ${TRUST_PROXY_PADRAO}.`,
            ],
        };
    }
    if (['false', 'nenhum', 'none'].includes(minusculo)) return { valor: false, avisos: [] };

    if (/^\d+$/.test(texto)) {
        const saltos = Number(texto);
        if (saltos === 0) return { valor: false, avisos: [] };
        if (saltos > MAX_SALTOS) {
            return {
                valor: TRUST_PROXY_PADRAO,
                avisos: [
                    `TRUST_PROXY=${texto} saltos não corresponde a infraestrutura real. Usando ${TRUST_PROXY_PADRAO}.`,
                ],
            };
        }
        return { valor: saltos, avisos: [] };
    }

    const lista = [];
    const avisos = [];
    for (const item of texto.split(',')) {
        const entrada = item.trim();
        if (!entrada) continue;
        const chave = entrada.toLowerCase();
        if (ATALHOS_NATIVOS.has(chave)) lista.push(chave);
        else if (chave === 'cloudflare') lista.push(...FAIXAS_CLOUDFLARE);
        else if (faixaValida(entrada)) lista.push(entrada);
        else
            avisos.push(
                `TRUST_PROXY: "${entrada}" não é IP, faixa CIDR nem atalho conhecido. Ignorado.`
            );
    }

    if (lista.length === 0) {
        avisos.push(`TRUST_PROXY sem nenhuma entrada válida. Usando ${TRUST_PROXY_PADRAO}.`);
        return { valor: TRUST_PROXY_PADRAO, avisos };
    }
    return { valor: lista, avisos };
}

/**
 * Aplica TRUST_PROXY ao app. Chamar uma vez, antes de qualquer middleware que
 * leia `req.ip`.
 */
function configurarConfiancaProxy(app, bruto = process.env.TRUST_PROXY) {
    const { valor, avisos } = interpretarTrustProxy(bruto);
    for (const aviso of avisos) {
        logger.warn(`[proxy] ${aviso}`, { action: 'proxy.configuracaoInvalida' });
    }
    app.set('trust proxy', valor);
    return valor;
}

/** Descrição legível da confiança aplicada, para o diagnóstico. */
function descreverConfianca(valor) {
    if (valor === false) return 'nenhum proxy confiável (conexão direta)';
    if (typeof valor === 'number') return `${valor} salto(s) de proxy`;
    if (Array.isArray(valor)) {
        const cloudflare = FAIXAS_CLOUDFLARE.every((f) => valor.includes(f));
        const resto = valor.filter((f) => !FAIXAS_CLOUDFLARE.includes(f));
        return [...resto, ...(cloudflare ? ['cloudflare'] : [])].join(', ');
    }
    return String(valor);
}

/**
 * Normaliza um endereço para comparação e chave: tira o prefixo de IPv4
 * mapeado (`::ffff:1.2.3.4`) e o zone id (`fe80::1%eth0`). Endereço inválido
 * vira string vazia.
 */
function normalizarIp(bruto) {
    if (typeof bruto !== 'string') return '';
    let ip = bruto.trim().split('%')[0];
    const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapeado) ip = mapeado[1];
    return net.isIP(ip) ? ip.toLowerCase() : '';
}

/** A conexão TCP veio de um proxy que a configuração manda confiar? */
function conexaoDeProxyConfiavel(req) {
    const confia = req.app?.get('trust proxy fn');
    const par = req.socket?.remoteAddress;
    return typeof confia === 'function' && Boolean(par) && Boolean(confia(par, 0));
}

let avisouCadeiaIgnorada = false;

/**
 * IP do cliente, já resolvido pela lista de proxies confiáveis.
 * Devolve string vazia quando não há endereço válido.
 */
function ipDoCliente(req) {
    const cabecalho = String(process.env.IP_CLIENTE_CABECALHO || '')
        .trim()
        .toLowerCase();
    if (cabecalho && conexaoDeProxyConfiavel(req)) {
        const valor = req.headers?.[cabecalho];
        const ip = normalizarIp(typeof valor === 'string' ? valor.split(',')[0] : '');
        if (ip) return ip;
    }

    // X-Forwarded-For chegando por conexão que não é proxy confiável: ou a
    // configuração não bate com a infraestrutura (e todo cliente vai parecer
    // o mesmo IP), ou alguém está tentando escolher o próprio IP. Os dois
    // casos merecem uma linha no log, e uma só.
    if (
        !avisouCadeiaIgnorada &&
        req.headers?.['x-forwarded-for'] &&
        !conexaoDeProxyConfiavel(req)
    ) {
        avisouCadeiaIgnorada = true;
        logger.warn(
            '[proxy] X-Forwarded-For recebido de conexão que não é proxy confiável; cabeçalho ignorado. Se o servidor está atrás de proxy, confira TRUST_PROXY.',
            { action: 'proxy.cadeiaIgnorada' }
        );
    }

    return normalizarIp(req.ip || req.socket?.remoteAddress || '');
}

/** Expande um IPv6 válido nos seus oito grupos de 16 bits. */
function expandirIpv6(ip) {
    let endereco = ip;
    // IPv4 embutido nos últimos 32 bits (ex.: 64:ff9b::192.0.2.1).
    const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(endereco);
    if (v4) {
        const [a, b, c, d] = v4[1].split('.').map(Number);
        endereco = `${endereco.slice(0, -v4[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }
    const [esquerda, direita] = endereco.split('::');
    const gruposEsquerda = esquerda ? esquerda.split(':') : [];
    if (direita === undefined) return gruposEsquerda;
    const gruposDireita = direita ? direita.split(':') : [];
    const zeros = new Array(8 - gruposEsquerda.length - gruposDireita.length).fill('0');
    return [...gruposEsquerda, ...zeros, ...gruposDireita];
}

/**
 * Chave de rate limit para o IP do cliente.
 *
 * IPv4 → o próprio endereço. IPv6 → o prefixo /64, que é o bloco que um
 * provedor entrega a UM assinante: sem isso, trocar de endereço dentro do
 * próprio bloco (2^64 endereços) zeraria o contador a cada requisição. A
 * expansão é necessária porque `2001:db8::1` e `2001:db8:0:0::2` são o mesmo
 * /64 escrito de formas diferentes.
 */
function chaveIp(req) {
    const ip = ipDoCliente(req);
    if (!ip) return 'sem-ip';
    if (net.isIP(ip) === 4) return ip;
    const grupos = expandirIpv6(ip)
        .slice(0, 4)
        .map((g) => parseInt(g || '0', 16).toString(16));
    return `${grupos.join(':')}::/64`;
}

/**
 * Lista de IPs/faixas (separados por vírgula) para consulta rápida.
 * Entrada inválida é ignorada e informada em `invalidos`.
 */
function criarListaIps(texto) {
    const lista = new net.BlockList();
    const invalidos = [];
    let total = 0;
    for (const item of String(texto || '').split(',')) {
        const entrada = item.trim();
        if (!entrada) continue;
        if (!faixaValida(entrada)) {
            invalidos.push(entrada);
            continue;
        }
        const [endereco, prefixo] = entrada.split('/');
        const tipo = net.isIP(endereco) === 4 ? 'ipv4' : 'ipv6';
        if (prefixo === undefined) lista.addAddress(endereco, tipo);
        else lista.addSubnet(endereco, Number(prefixo), tipo);
        total++;
    }
    return {
        total,
        invalidos,
        contem(ip) {
            const normalizado = normalizarIp(ip);
            if (!normalizado || total === 0) return false;
            return lista.check(normalizado, net.isIP(normalizado) === 4 ? 'ipv4' : 'ipv6');
        },
    };
}

/**
 * O que o servidor enxerga desta requisição. Serve para conferir, em produção,
 * se TRUST_PROXY bate com a infraestrutura: o `ipResolvido` precisa ser o IP
 * público de quem fez a chamada, nunca o do balanceador.
 */
function diagnosticoIp(req) {
    const cabecalho = String(process.env.IP_CLIENTE_CABECALHO || '')
        .trim()
        .toLowerCase();
    return {
        ipResolvido: ipDoCliente(req) || null,
        chaveRateLimit: chaveIp(req),
        enderecoConexao: req.socket?.remoteAddress || null,
        conexaoDeProxyConfiavel: conexaoDeProxyConfiavel(req),
        xForwardedFor: req.headers?.['x-forwarded-for'] || null,
        trustProxy: descreverConfianca(req.app?.get('trust proxy')),
        cabecalhoCdn: cabecalho
            ? { nome: cabecalho, valor: req.headers?.[cabecalho] || null }
            : null,
    };
}

module.exports = {
    configurarConfiancaProxy,
    interpretarTrustProxy,
    ipDoCliente,
    chaveIp,
    criarListaIps,
    diagnosticoIp,
    FAIXAS_CLOUDFLARE,
};
