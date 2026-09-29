/**
 * E-mail de cada notificação com a arte do resumo mensal (Issue #540).
 */
const { htmlNotificacao } = require('../services/EmailNotificacao');

const base = {
    titulo: 'Reunião de pais',
    mensagem: 'Sexta-feira às 19h.\nNo pátio.',
    link: 'https://escola.exemplo/html/dashboard.html',
    base: 'https://escola.exemplo/',
    data: new Date('2026-09-28T15:00:00Z'),
};

describe('htmlNotificacao', () => {
    test('usa a arte do resumo mensal: logo, ondas, chip e botão', () => {
        const html = htmlNotificacao(base);
        expect(html).toContain('https://escola.exemplo/img/email/logo.png');
        expect(html).toContain('https://escola.exemplo/img/email/ondas.png');
        expect(html).toContain('NOTIFICAÇÃO');
        expect(html).toContain('Abrir no sistema');
        expect(html).toContain('href="https://escola.exemplo/html/dashboard.html"');
        expect(html).toContain('28 de setembro de 2026');
    });

    test('escapa título e mensagem e preserva as quebras de linha', () => {
        const html = htmlNotificacao({
            ...base,
            titulo: '<script>alert(1)</script>',
            mensagem: 'linha 1\n<b>linha 2</b>',
        });
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('linha 1<br>&lt;b&gt;linha 2&lt;/b&gt;');
    });

    test('aviso comum sai em menta com o sino', () => {
        const html = htmlNotificacao(base);
        expect(html).toContain('>Aviso<');
        expect(html).toContain('/img/email/item-sino-novidade.png');
    });

    test('prioridade alta sai em roxo como "Importante"', () => {
        const html = htmlNotificacao({ ...base, prioridade: 'urgente' });
        expect(html).toContain('>Importante<');
        expect(html).toContain('/img/email/item-sino-correcao.png');
    });

    test('evento e resumo diário saem em azul com o ícone próprio', () => {
        expect(htmlNotificacao({ ...base, categoria: 'evento' })).toContain(
            '/img/email/item-calendario-melhoria.png'
        );
        expect(htmlNotificacao({ ...base, tipo: 'resumo_diario' })).toContain(
            '/img/email/item-grafico-melhoria.png'
        );
    });

    test('todo ícone usado existe em img/email', () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const pasta = path.join(__dirname, '..', '..', '..', 'img', 'email');
        const casos = [
            {},
            { prioridade: 'alta' },
            { categoria: 'evento' },
            { categoria: 'academico' },
            { categoria: 'sistema' },
            { tipo: 'resumo_diario' },
        ];
        for (const c of casos) {
            const html = htmlNotificacao({ ...base, ...c });
            const nomes = [...html.matchAll(/\/img\/email\/([\w-]+\.png)/g)].map((m) => m[1]);
            for (const nome of nomes) expect(fs.existsSync(path.join(pasta, nome))).toBe(true);
        }
    });
});
