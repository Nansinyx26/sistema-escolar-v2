/**
 * consentimento-cadastro.js — ciência da Política de Privacidade e
 * consentimentos específicos no cadastro.
 *
 * POR QUE ESTE ARQUIVO EXISTE (Issues #295 e #414)
 * -------------------------------------------------
 * O backend recusa (400) o cadastro que não traz a ciência do aviso de
 * privacidade, e grava o aceite no `lgpdHistory` com data, versão, IP e
 * navegador.
 *
 * A Issue #414 separou o que antes era uma caixa única ("li e autorizo") em
 * DOIS atos independentes:
 *
 *   1. **Ciência** (obrigatória) — "Li e tomei ciência da Política de
 *      Privacidade". Sem ela o cadastro é recusado. Não afirma autorização.
 *   2. **Consentimento educacional** (opcional) — "Autorizo o tratamento dos
 *      meus dados para fins educacionais". Pode ser recusado sem impedir o
 *      cadastro; a escola trata com base legal própria (obrigação legal,
 *      execução de contrato).
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
 * AS CAIXAS NASCEM DESMARCADAS
 * ----------------------------
 * Nenhuma tela marca a caixa por conta própria, e `payload()` lê o estado delas
 * no momento do envio. Caixa pré-marcada não é manifestação "inequívoca" — que
 * é como a LGPD define consentimento (art. 5º, XII).
 */
(() => {
    const VERSAO = '2.0';
    const ID_CIENCIA = 'aceiteLgpdCadastro';
    const ID_EDUCACIONAL = 'consentEducacional';

    /** A caixa de ciência da política (obrigatória) ou `null`. */
    function caixa(id) {
        return document.getElementById(id || ID_CIENCIA);
    }

    /** A caixa de consentimento educacional (opcional) ou `null`. */
    function caixaEducacional(id) {
        return document.getElementById(id || ID_EDUCACIONAL);
    }

    /** `true` só se a caixa de ciência existe e está marcada agora. */
    function marcado(id) {
        return Boolean(caixa(id)?.checked);
    }

    /** `true` se a caixa educacional existe e está marcada. */
    function educacionalMarcado(id) {
        return Boolean(caixaEducacional(id)?.checked);
    }

    /**
     * O que vai em `consentimentoLgpd` no corpo do cadastro.
     *
     * `aceito` continua significando "ciência da política" — é o que o backend
     * valida como obrigatório. `consentimentos` carrega os opcionais; o backend
     * grava-os no `lgpdHistory` mas não bloqueia o cadastro por eles.
     */
    function payload(idCiencia, idEducacional) {
        return {
            aceito: marcado(idCiencia),
            versao: VERSAO,
            consentimentos: {
                educacional: educacionalMarcado(idEducacional),
            },
        };
    }

    window.ConsentimentoCadastro = Object.freeze({
        VERSAO,
        caixa,
        caixaEducacional,
        marcado,
        educacionalMarcado,
        payload,
    });
})();
