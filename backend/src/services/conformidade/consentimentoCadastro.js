/**
 * consentimentoCadastro.js — o consentimento LGPD colhido NO ATO de criar a conta.
 *
 * POR QUE ESTE ARQUIVO EXISTE (Issues #236 e #295)
 * ------------------------------------------------
 * Até a #236, os caminhos de cadastro gravavam `consentimentoAceiteEm: now` no
 * próprio `Usuario.create`, sem tela e sem ninguém marcar nada — e
 * `consentimentoVigente()` tratava esse carimbo como consentimento válido. A
 * conta nascia "consentida", nunca era perguntada, e "Meus Dados" mostrava uma
 * data de aceite que nenhuma pessoa produziu.
 *
 * O PR #277 parou o carimbo. Só isso deixava a conta sem base legal registrada.
 * Este módulo fecha o outro lado: o cadastro EXIGE a manifestação da pessoa no
 * corpo da requisição, recusa (400) sem ela, e grava o aceite do mesmo jeito
 * que o resto do sistema grava — no `lgpdHistory`, com termo, versão, data, IP
 * e navegador.
 *
 * QUEM USA, E ONDE O ACEITE É OBRIGATÓRIO
 * ---------------------------------------
 * As cinco rotas de formulário do `UserController` — `register-responsavel`,
 * `register-docente`, `register-diretor`, `register-secretaria` e
 * `register-code` — recusam (400) sem o aceite, por
 * `validarConsentimentoDoCadastro()`, e o gravam por `assinaturasDoCadastro()`.
 *
 * O `register-responsavel` chegou a ficar opcional (Issue #288), porque o
 * portal pede o aceite depois, no `CompletarCadastro`. A decisão registrada na
 * #295 foi exigir nas cinco: o que se pede aqui é só a ciência da política, e
 * as finalidades específicas continuam opcionais no perfil (Issue #280).
 *
 * O `google-login` não usa nenhuma das duas: é um login que cria a conta como
 * efeito colateral, não um formulário. A conta Google nasce com
 * `profileCompleted: false`, e cai no mesmo `CompletarCadastro`.
 *
 * A VERSÃO TEM DE BATER
 * ---------------------
 * A pessoa aceita um TEXTO, e o texto tem versão. Um formulário aberto antes de
 * a política mudar enviaria a versão antiga; gravar a atual nesse caso seria
 * registrar o aceite de um texto que ela não leu. Por isso a recusa pede para
 * recarregar a página, em vez de promover a versão em silêncio.
 *
 * O MÉTODO DE VALIDAÇÃO É O MAIS FRACO DA LISTA — E FICA DITO
 * ----------------------------------------------------------
 * No cadastro ainda não existe sessão, então `SESSAO_AUTENTICADA` seria falso.
 * O que existe é uma caixa marcada num formulário, de um IP e um navegador. É
 * isso que fica gravado (`METODOS.CADASTRO`). A validação forte por e-mail
 * continua disponível depois, em `/api/conformidade/consentimento/codigo`, e
 * convive no histórico com este registro sem apagá-lo.
 */

const {
    CONSENTIMENTO_ID,
    CONSENTIMENTO_VERSAO,
    aceiteExplicitoVigente,
} = require('../../utils/consentimentoLgpd');
const { METODOS, registroDeConsentimento } = require('./validacaoConsentimento');

/** Código que o frontend usa para distinguir esta recusa das outras 400. */
const CODIGO_RECUSA = 'CONSENTIMENTO_OBRIGATORIO';

/**
 * Confere a manifestação de consentimento que veio no corpo do cadastro.
 *
 * Espera `body.consentimentoLgpd = { aceito: true, versao: '<vigente>' }`. O
 * que conta como aceite é decidido por `aceiteExplicitoVigente()`, a mesma
 * regra do cadastro do responsável — só o booleano `true`, com a versão
 * vigente. Aqui só se escolhe a mensagem da recusa.
 *
 * @param {object} body corpo da requisição de cadastro.
 * @returns {null | {success: false, code: string, error: string}}
 *   `null` quando o consentimento está em ordem; senão, o corpo da resposta 400.
 */
function validarConsentimentoDoCadastro(body) {
    const manifestacao = body?.consentimentoLgpd;
    if (aceiteExplicitoVigente(manifestacao)) return null;

    // Marcou a caixa, mas de um texto que já não é o vigente.
    const versaoVelha = manifestacao?.aceito === true;
    return {
        success: false,
        code: CODIGO_RECUSA,
        error: versaoVelha
            ? `A Política de Privacidade foi atualizada (versão ${CONSENTIMENTO_VERSAO}). ` +
              'Recarregue a página, leia a versão atual e aceite novamente.'
            : 'Para criar a conta é preciso ler e aceitar a Política de Privacidade.',
    };
}

/**
 * Os campos de consentimento a espalhar no `Usuario.create` do cadastro.
 *
 * Grava nos DOIS lugares, pelo mesmo motivo do `ModeracaoController`: o
 * `lgpdHistory` é o registro auditável, e o campo legado é o que o portal e o
 * `GET /api/auth/me` ainda leem. Gravar só no histórico deixaria a conta
 * dizendo "não assinado" com a assinatura registrada ao lado. As duas datas são
 * a MESMA, para que nunca pareçam dois atos diferentes.
 *
 * Só chame depois de `validarConsentimentoDoCadastro()` devolver `null`.
 *
 * @param {object} req requisição do cadastro, para IP e navegador.
 * @returns {{lgpdHistory: object[], consentimentoAceiteEm: Date, consentimentoVersao: string}}
 */
function assinaturasDoCadastro(req) {
    const registro = registroDeConsentimento({
        termoId: CONSENTIMENTO_ID,
        versao: CONSENTIMENTO_VERSAO,
        metodoValidacao: METODOS.CADASTRO,
        req,
    });
    // Mesmo rótulo que o `newLgpdRecords` e o `consentimentoDoPerfil` gravam.
    registro.loginType = 'Conta Local';

    return {
        lgpdHistory: [registro],
        consentimentoAceiteEm: registro.aceitoEm,
        consentimentoVersao: CONSENTIMENTO_VERSAO,
    };
}

module.exports = { CODIGO_RECUSA, validarConsentimentoDoCadastro, assinaturasDoCadastro };
