/**
 * consentimento-cadastro.js — o aceite da Política de Privacidade no cadastro.
 *
 * POR QUE ESTE ARQUIVO EXISTE (Issue #295)
 * ----------------------------------------
 * O backend passou a recusar (400) o cadastro que não traz o consentimento no
 * corpo, e a gravar o aceite no `lgpdHistory` com data, versão, IP e navegador.
 * Antes (Issue #236), a conta nascia com um consentimento carimbado que ninguém
 * tinha dado.
 *
 * Oito telas criam conta — os quatro formulários de `html/pages/cadastro-*` e o
 * cadastro com código das quatro páginas `html/login*.html` — e todas precisam
 * mandar a mesma coisa. A versão mora aqui, uma vez só, e não em cada script.
 *
 * A VERSÃO PRECISA BATER COM A DO BACKEND
 * ---------------------------------------
 * `CONSENTIMENTO_VERSAO` em `backend/src/utils/consentimentoLgpd.js`. Se a
 * política mudar e só um dos lados for atualizado, todo cadastro passa a ser
 * recusado. `backend/src/tests/consentimentoCadastro.test.js` lê este arquivo e
 * falha se as duas versões divergirem.
 *
 * A CAIXA NASCE DESMARCADA
 * ------------------------
 * Nenhuma tela marca a caixa por conta própria, e `payload()` lê o estado dela
 * no momento do envio. Caixa pré-marcada não é manifestação "inequívoca" — que
 * é como a LGPD define consentimento (art. 5º, XII).
 */
(() => {
    const VERSAO = '2.0';
    const ID_PADRAO = 'aceiteLgpdCadastro';

    /** A caixa de aceite da página (ou `null`, se a página não tiver uma). */
    function caixa(id) {
        return document.getElementById(id || ID_PADRAO);
    }

    /** `true` só se a caixa existe e está marcada agora. */
    function marcado(id) {
        return Boolean(caixa(id)?.checked);
    }

    /** O que vai em `consentimentoLgpd` no corpo do cadastro. */
    function payload(id) {
        return { aceito: marcado(id), versao: VERSAO };
    }

    window.ConsentimentoCadastro = Object.freeze({ VERSAO, caixa, marcado, payload });
})();
