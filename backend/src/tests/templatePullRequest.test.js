/**
 * templatePullRequest.test.js — Issue #161
 *
 * O contador de tarefas do GitHub soma todo `- [ ]` do corpo do PR como
 * trabalho pendente. Enquanto o template misturava caixa de trabalho com caixa
 * de classificação, todo PR honesto aparecia incompleto: um PR de melhoria que
 * vai para a `develop`, sem migração e sem variável nova, tinha cinco caixas
 * obrigatoriamente vazias — e estava pronto.
 *
 * Ruído constante ensina a ignorar, inclusive as caixas que significam trabalho
 * de verdade. Estes testes prendem a regra: caixa só existe onde vazio
 * significa pendência.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '../../..');
const TEMPLATE = fs.readFileSync(path.join(RAIZ, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8');

/** Devolve o trecho entre um cabeçalho e o próximo `##`, sem os comentários. */
function secao(titulo) {
    const corpo = TEMPLATE.split(new RegExp(`^## ${titulo}\\s*$`, 'm'))[1] || '';
    return corpo.split(/^## /m)[0].replace(/<!--[\s\S]*?-->/g, '');
}

const caixas = (texto) => texto.match(/^\s*-\s\[[ x]\]/gm) || [];

describe('template de PR: caixa vazia significa trabalho pendente (Issue #161)', () => {
    test('o tipo do PR é texto, não três caixas das quais duas ficam vazias', () => {
        expect(TEMPLATE).toMatch(/^\*\*Tipo:\*\*/m);
        expect(TEMPLATE).not.toMatch(/^\s*-\s\[[ x]\].*Correção/m);
        expect(TEMPLATE).not.toMatch(/^\s*-\s\[[ x]\].*Nova função/m);
    });

    test('a seção Deploy responde por escrito em vez de deixar caixa vazia', () => {
        const deploy = secao('Deploy');

        expect(caixas(deploy)).toHaveLength(0);
        // As três perguntas continuam sendo respondidas — a informação não some.
        expect(deploy).toMatch(/Ambiente/);
        expect(deploy).toMatch(/Migração de banco/);
        expect(deploy).toMatch(/Variável de ambiente nova/);
    });

    test('as seções condicionais mandam apagar, não deixar em branco', () => {
        for (const nome of ['Interface', 'Observabilidade']) {
            const bruto = TEMPLATE.split(new RegExp(`^## ${nome}\\s*$`, 'm'))[1].split(/^## /m)[0];

            expect(caixas(bruto).length).toBeGreaterThan(0);
            expect(bruto).toMatch(/APAGUE esta seção inteira/);
        }
    });

    test('o Checklist continua em caixas — ali vazio sempre significou pendência', () => {
        expect(caixas(secao('Checklist')).length).toBeGreaterThanOrEqual(5);
    });

    test('nenhuma caixa vem pré-marcada: marcar é ato de quem abre o PR', () => {
        expect(TEMPLATE).not.toMatch(/^\s*-\s\[x\]/m);
    });

    test('a linha que o pr-policy exige continua no template', () => {
        // O gate reprova PR sem referência a Issue; perder esta linha faria o
        // template gerar PRs que o próprio CI recusa.
        expect(TEMPLATE).toMatch(/^Closes #/m);
    });
});
