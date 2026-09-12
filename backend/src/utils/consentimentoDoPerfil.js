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
 *
 * AS QUATRO CAIXAS SÃO INDEPENDENTES
 * ----------------------------------
 * Salvar o perfil exigia as quatro caixas da aba "Termos LGPD" marcadas: quem
 * só queria corrigir o telefone precisava consentir com tudo, inclusive com
 * "Comunicações Rápidas". Corrigir dado cadastral é direito do titular
 * (Art. 18, III) e consentimento vale por finalidade (Art. 8º, §4º), então a
 * decisão registrada na #280 foi separar: nome e telefone salvam sem caixa
 * nenhuma, e cada caixa é uma escolha própria.
 *
 * Três delas moram em `lgpdConsents` (`AUTORIZACOES_DO_PERFIL`); a quarta,
 * ciência da política, é o consentimento geral acima. Cada aceite novo deixa
 * sua própria assinatura no histórico — a caixa das notas do aluno é dado de
 * criança (Art. 14, §1º), e é ali que a prova pesa mais.
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
 * Chave em `lgpdConsents` → `termoId` da assinatura que o aceite deixa no
 * `lgpdHistory`.
 */
const AUTORIZACOES_DO_PERFIL = Object.freeze({
    perfilDadosCadastrais: 'perfil_dados_cadastrais',
    perfilNotasDesempenho: 'perfil_notas_desempenho',
    perfilComunicacoes: 'perfil_comunicacoes',
});

/**
 * Mescla as autorizações pedidas nas que o titular já tem.
 *
 * Mesclar, e não substituir: o `updateProfile` gravava `lgpdConsents` inteiro,
 * e a aba do perfil manda só as três chaves dela — as outras onze, escolhidas
 * no `CompletarCadastro`, voltariam para `false` em silêncio.
 *
 * @param {object} atuais          `lgpdConsents` gravado hoje (pode faltar).
 * @param {object} pedidas         `lgpdConsents` do corpo do pedido.
 * @param {(chave: string) => boolean} chaveValida o schema conhece a chave.
 * @returns {{campos: Object<string, boolean>, aceitasAgora: string[]}}
 *   `campos` em notação de ponto, prontos para o `$set`; `aceitasAgora`, as
 *   autorizações do perfil que passaram de desmarcada a marcada neste pedido.
 */
function mesclarAutorizacoes(atuais, pedidas, chaveValida) {
    const campos = {};
    const aceitasAgora = [];

    for (const [chave, valor] of Object.entries(pedidas || {})) {
        if (typeof valor !== 'boolean' || !chaveValida(chave)) continue;
        campos[`lgpdConsents.${chave}`] = valor;

        // Só o aceite NOVO assina: remarcar o que já estava marcado não é
        // consentir de novo. Desmarcar é revogar (Art. 8º, §5º) e só apaga a
        // escolha — o histórico de aceites anteriores é imutável.
        if (valor && Object.hasOwn(AUTORIZACOES_DO_PERFIL, chave) && !atuais?.[chave]) {
            aceitasAgora.push(chave);
        }
    }

    return { campos, aceitasAgora };
}

/**
 * A assinatura auditável do aceite dado pelo perfil, no mesmo formato de todo
 * o sistema (`registroDeConsentimento`): termo, versão, data, IP, navegador e
 * método de validação.
 *
 * @param {object} req requisição autenticada.
 * @param {Date} aceitoEm a MESMA data gravada no campo, para os dois baterem.
 * @param {string} [termoId] padrão: o consentimento geral (política).
 */
function assinaturaDoPerfil(req, aceitoEm, termoId = CONSENTIMENTO_ID) {
    const registro = registroDeConsentimento({
        termoId,
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
    AUTORIZACOES_DO_PERFIL,
    decidirConsentimentoDoPerfil,
    mesclarAutorizacoes,
    assinaturaDoPerfil,
};
