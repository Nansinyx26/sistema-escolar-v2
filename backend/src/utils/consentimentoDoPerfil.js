/**
 * consentimentoDoPerfil.js — o aceite LGPD dado por uma tela de PERFIL.
 *
 * O QUE ESTAVA ERRADO (Issue #280)
 * --------------------------------
 * `UserController.updateProfile` gravava `consentimentoAceiteEm = new Date()`
 * sempre que o corpo trazia o campo — e o `EditarPerfil` do portal manda o
 * campo em TODO salvamento. Dois defeitos saíam daí:
 *
 *   1. O aceite ficava só no campo legado, sem entrada em `lgpdHistory`. É um
 *      ato real do titular (ele marca as caixas), mas sem prova do ato: sem IP,
 *      sem navegador, sem versão. Pelo Art. 8º, §2º da LGPD, cabe ao
 *      controlador provar o consentimento, e o histórico existe para isso.
 *   2. Corrigir o telefone MOVIA a data do consentimento para hoje. A data
 *      deixava de dizer quando a pessoa consentiu e passava a dizer quando ela
 *      salvou o perfil pela última vez.
 *
 * A GARANTIA MORA NO SERVIDOR
 * ---------------------------
 * A Issue sugeria o `EditarPerfil` passar a mandar `newLgpdRecords`. Isso
 * conserta uma tela e deixa a regra dependente de cada cliente lembrar do
 * campo — foi exatamente assim que o defeito nasceu. Decidindo aqui, qualquer
 * cliente que diga "consinto" produz campo E assinatura, ou nenhum dos dois.
 *
 * A pergunta que decide tudo é: o titular já tem uma assinatura auditável da
 * versão VIGENTE? A existência do campo legado não serve de resposta — ele pode
 * ser um carimbo automático de cadastro (Issue #236), que é justamente o que
 * não prova nada.
 */
const {
    registroDeConsentimento,
    METODOS,
} = require('../services/conformidade/validacaoConsentimento');
const { CONSENTIMENTO_ID, CONSENTIMENTO_VERSAO } = require('./consentimentoLgpd');

/**
 * O que gravar quando o titular consente pela tela de perfil.
 *
 * @param {object} situacao
 * @param {boolean} situacao.jaTemAssinatura   `lgpdHistory` já tem
 *   `politica_privacidade` na versão vigente.
 * @param {boolean} situacao.loteTrazAssinatura o próprio pedido já traz essa
 *   assinatura em `newLgpdRecords` (é o que o `CompletarCadastro` faz).
 * @returns {{gravarCampo: boolean, acrescentarAssinatura: boolean}}
 */
function decidirConsentimentoDoPerfil({ jaTemAssinatura, loteTrazAssinatura } = {}) {
    // Já consentiu, com prova: nada muda. Nem a data — salvar o telefone não é
    // consentir de novo, e o histórico não é log de cliques.
    if (jaTemAssinatura) {
        return { gravarCampo: false, acrescentarAssinatura: false };
    }

    // Consentimento novo. O campo sempre anda junto de uma assinatura; se o
    // pedido já traz a dele, acrescentar outra duplicaria o registro.
    return { gravarCampo: true, acrescentarAssinatura: !loteTrazAssinatura };
}

/**
 * A assinatura auditável do aceite dado pelo perfil, no mesmo formato de todo
 * o sistema (`registroDeConsentimento`): termo, versão, data, IP, navegador e
 * método de validação.
 *
 * @param {object} req requisição autenticada.
 * @param {Date} aceitoEm a MESMA data gravada no campo, para os dois baterem.
 */
function assinaturaDoPerfil(req, aceitoEm) {
    const registro = registroDeConsentimento({
        termoId: CONSENTIMENTO_ID,
        versao: CONSENTIMENTO_VERSAO,
        metodoValidacao: METODOS.SESSAO,
        req,
        aceitoEm,
    });
    // Mesmo rótulo que o caminho de `newLgpdRecords` já grava no histórico.
    registro.loginType = req?.user?.loginGoogle ? 'Google' : 'Conta Local';
    return registro;
}

module.exports = {
    CONSENTIMENTO_ID,
    CONSENTIMENTO_VERSAO,
    decidirConsentimentoDoPerfil,
    assinaturaDoPerfil,
};
