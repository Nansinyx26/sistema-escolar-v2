/**
 * handlersInline.trava.test.js — Issue #613 (épico #612)
 *
 * Os handlers inline (`onclick="..."`) são o motivo de a CSP ainda ter
 * `script-src-attr 'unsafe-inline'`. Enquanto o épico tira os que existem,
 * esta trava impede que entrem novos: cada arquivo tem um teto gravado em
 * `scripts/handlers-inline.json`.
 *
 * Baixou? Atualize a trava (`node scripts/handlers-inline.js --gravar`): ela
 * precisa dizer quanto falta, não quanto havia.
 */
const { contar, lerTrava } = require('../../../scripts/handlers-inline');

describe('trava dos handlers inline (Issue #613)', () => {
    const atual = contar();
    const trava = lerTrava();

    it('nenhum arquivo ganhou handler inline', () => {
        const subiram = Object.entries(atual)
            .filter(([arquivo, n]) => n > (trava[arquivo] || 0))
            .map(([arquivo, n]) => `${arquivo}: ${trava[arquivo] || 0} → ${n}`);

        // Use `data-acao` (js/acoes.js) ou addEventListener no lugar do atributo.
        expect(subiram).toEqual([]);
    });

    it('a trava acompanha o que já saiu', () => {
        const baixaram = Object.entries(trava)
            .filter(([arquivo, n]) => (atual[arquivo] || 0) < n)
            .map(([arquivo, n]) => `${arquivo}: ${n} → ${atual[arquivo] || 0}`);

        // Rode `node scripts/handlers-inline.js --gravar` e commite a trava.
        expect(baixaram).toEqual([]);
    });
});
