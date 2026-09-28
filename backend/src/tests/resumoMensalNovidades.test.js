const {
    releases,
    mesAnterior,
    nomeDoMes,
    itensDoMes,
    montarResumoMensal,
} = require('../config/changelog');
const { htmlResumoMensal } = require('../services/EmailResumoMensal');

const exemplo = [
    {
        versao: '1.2.1',
        data: '2026-09-20',
        itens: [
            { tipo: 'correcao', texto: 'Boletim voltou a abrir no celular.' },
            { tipo: 'melhoria', texto: 'Refatoração do controller de turmas.', interno: true },
        ],
    },
    {
        versao: '1.2.0',
        data: '2026-09-02',
        itens: [
            {
                tipo: 'novidade',
                icone: 'pdf',
                texto: 'Agora dá para exportar a frequência <em PDF>.',
                detalhe: 'Direto da turma.',
            },
            { tipo: 'melhoria', texto: 'Chamada carrega mais rápido.' },
        ],
    },
    { versao: '1.1.9', data: '2026-08-30', itens: [{ tipo: 'novidade', texto: 'De agosto.' }] },
];

describe('resumo mensal de novidades', () => {
    it('calcula o mês anterior, inclusive na virada do ano', () => {
        expect(mesAnterior('2026-10')).toBe('2026-09');
        expect(mesAnterior('2027-01')).toBe('2026-12');
        expect(nomeDoMes('2026-03')).toBe('março de 2026');
    });

    it('junta só o que importa ao usuário no mês, novidades primeiro', () => {
        const itens = itensDoMes('2026-09', exemplo);
        expect(itens.map((i) => i.tipo)).toEqual(['novidade', 'melhoria', 'correcao']);
        expect(itens.some((i) => i.texto.includes('Refatoração'))).toBe(false);
        expect(itens.some((i) => i.texto === 'De agosto.')).toBe(false);
    });

    it('não monta resumo para mês sem nada relevante', () => {
        expect(montarResumoMensal('2026-11', exemplo)).toBeNull();
        expect(
            montarResumoMensal('2026-10', [
                { data: '2026-10-05', itens: [{ tipo: 'melhoria', texto: 'CI', interno: true }] },
            ])
        ).toBeNull();
    });

    it('o título carrega o mês (chave da dedup por escola)', () => {
        const r = montarResumoMensal('2026-09', exemplo);
        expect(r.titulo).toBe('Novidades do sistema — setembro de 2026');
        expect(r.mensagem).toContain('• Correção: Boletim voltou a abrir no celular.');
    });

    it('o changelog real só tem itens válidos', () => {
        for (const release of releases) {
            expect(release.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            for (const item of release.itens) {
                expect(['novidade', 'melhoria', 'correcao']).toContain(item.tipo);
                expect(typeof item.texto).toBe('string');
            }
        }
    });

    it('o e-mail agrupa por tipo, usa os ícones e escapa o texto', () => {
        const r = montarResumoMensal('2026-09', exemplo);
        const html = htmlResumoMensal(r, 'https://x/y?a=1&b=2', 'https://escola.exemplo/');
        expect(html).toContain('Novidades');
        expect(html).toContain('Correções');
        expect(html).toContain('setembro de 2026');
        expect(html).toContain('1 novidade');
        expect(html).toContain('Direto da turma.');
        expect(html).toContain('&lt;em PDF&gt;');
        expect(html).not.toContain('<em PDF>');
        expect(html).toContain('https://x/y?a=1&amp;b=2');
        expect(html).toContain('https://escola.exemplo/img/email/item-pdf-novidade.png');
        // Sem ícone definido, vale o padrão do tipo.
        expect(html).toContain('/img/email/item-chave-correcao.png');
        expect(html.indexOf('exportar')).toBeLessThan(html.indexOf('Boletim'));
    });

    it('ícone desconhecido cai no padrão do tipo', () => {
        const html = htmlResumoMensal(
            { mesNome: 'maio de 2026', itens: [{ tipo: 'melhoria', texto: 'x', icone: '../x' }] },
            '/',
            ''
        );
        expect(html).toContain('/img/email/item-tendencia-melhoria.png');
        expect(html).not.toContain('../x');
    });

    it('toda imagem citada pelo template existe em img/email', () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const r = montarResumoMensal('2026-09', exemplo);
        const html = htmlResumoMensal(r, '/', '');
        const nomes = [...html.matchAll(/\/img\/email\/([\w-]+\.png)/g)].map((m) => m[1]);
        expect(nomes.length).toBeGreaterThan(5);
        const pasta = path.join(__dirname, '..', '..', '..', 'img', 'email');
        for (const nome of new Set(nomes)) {
            expect(fs.existsSync(path.join(pasta, nome))).toBe(true);
        }
    });
});
