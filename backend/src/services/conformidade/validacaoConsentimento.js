/**
 * validacaoConsentimento.js — provar que foi o responsável quem consentiu.
 *
 * O QUE FALTAVA
 * -------------
 * O sistema já registrava o consentimento (`utils/consentimentoLgpd.js`): termo,
 * versão, data, IP e navegador. O que ele não conseguia responder é a pergunta
 * que a ANPD faz quando há reclamação: *como você sabe que foi o responsável
 * legal, e não outra pessoa no computador dele?*
 *
 * O art. 14, §1º da LGPD exige consentimento ESPECÍFICO E EM DESTAQUE dado por
 * um dos pais ou responsável para tratar dado de criança. "Estava logado" é uma
 * prova fraca: sessão aberta em celular emprestado, tablet compartilhado,
 * computador da escola. Um segundo fator no ato do consentimento transforma a
 * afirmação em evidência.
 *
 * POR QUE E-MAIL, E NÃO SMS OU GOV.BR
 * -----------------------------------
 * Porque o canal de e-mail já existe neste sistema, é usado no 2FA e no
 * primeiro acesso, e funciona hoje. SMS depende de contrato com gateway; o
 * Gov.br depende de credenciamento do município como serviço confiante. Os dois
 * são melhores e nenhum dos dois está disponível para escrever agora — e um
 * consentimento sem validação nenhuma, esperando o contrato, seria a pior das
 * três opções.
 *
 * `metodoValidacao` é gravado no histórico justamente para essa evolução: no dia
 * em que o SMS ou o Gov.br entrar, os registros antigos continuam dizendo com
 * qual força foram validados, em vez de todos parecerem iguais.
 *
 * O CÓDIGO NUNCA É GUARDADO EM TEXTO
 * ----------------------------------
 * Fica o hash scrypt (`utils/codigosBackup`), como no 2FA. Um dump do banco não
 * pode virar um molho de códigos de consentimento válidos.
 */

const crypto = require('node:crypto');

/** Cinco minutos: o mesmo prazo do código de 2FA por e-mail. */
const VALIDADE_MS = 5 * 60 * 1000;

/** Quantas tentativas erradas antes de o código ser descartado. */
const MAX_TENTATIVAS = 5;

const METODOS = {
    /** Sessão autenticada, sem segundo fator — o que existia antes. */
    SESSAO: 'SESSAO_AUTENTICADA',
    /** Código de uso único enviado ao e-mail cadastrado do responsável. */
    EMAIL: 'EMAIL_VERIFICADO',
    /** Reservados para quando os canais existirem — ver o cabeçalho. */
    SMS: 'SMS_VERIFICADO',
    GOV_BR: 'GOV_BR_AUTH',
};

/**
 * Código de 6 dígitos com `crypto.randomInt`.
 *
 * `Math.random()` não serve: o estado do gerador é recuperável a partir de
 * poucas saídas, e aqui cada saída é enviada por e-mail para alguém.
 */
function gerarCodigo() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Decide se um código apresentado ainda pode ser conferido.
 *
 * Separado da conferência criptográfica de propósito: esta parte é pura e
 * responde "expirou? travou por tentativas?" sem depender de banco nem de
 * scrypt, que é o que torna os casos de borda testáveis.
 *
 * @param {{expiraEm?: Date, tentativas?: number}} pendente
 * @param {Date} [agora=new Date()]
 * @returns {{valido: boolean, motivo?: string}}
 */
function situacaoDoCodigo(pendente, agora = new Date()) {
    if (!pendente || !pendente.expiraEm) {
        return { valido: false, motivo: 'Nenhum código de confirmação foi solicitado.' };
    }
    if ((pendente.tentativas || 0) >= MAX_TENTATIVAS) {
        return {
            valido: false,
            motivo: 'Muitas tentativas. Solicite um novo código de confirmação.',
        };
    }
    if (agora > new Date(pendente.expiraEm)) {
        return { valido: false, motivo: 'Código expirado. Solicite um novo.' };
    }
    return { valido: true };
}

/**
 * Monta o registro que vai para `Usuario.lgpdHistory`.
 *
 * Guarda o QUE foi consentido (termo e versão), QUANDO, DE ONDE (IP) e COMO foi
 * validado. Sem o método, dois registros idênticos podem ter forças
 * probatórias completamente diferentes, e ninguém consegue distinguir depois.
 *
 * @param {object} entrada
 * @param {string} entrada.termoId
 * @param {string} entrada.versao
 * @param {string} entrada.metodoValidacao um dos valores de `METODOS`.
 * @param {object} [entrada.req] requisição, para IP e user-agent.
 * @param {Date}   [entrada.aceitoEm=new Date()]
 */
function registroDeConsentimento({ termoId, versao, metodoValidacao, req, aceitoEm } = {}) {
    const cabecalhos = req?.headers || {};
    const bruto = req?.ip || cabecalhos['x-forwarded-for'] || '';
    return {
        termoId,
        versao,
        aceitoEm: aceitoEm instanceof Date ? aceitoEm : new Date(),
        ip: String(bruto).split(',')[0].trim() || 'desconhecido',
        browser: cabecalhos['user-agent'] || 'desconhecido',
        os: cabecalhos['sec-ch-ua-platform'] || 'desconhecido',
        loginType: 'Portal Local',
        metodoValidacao: metodoValidacao || METODOS.SESSAO,
    };
}

/** Corpo do e-mail com o código. Texto simples de propósito — ver o teste. */
function emailDoCodigo(codigo, nome) {
    return {
        assunto: 'Código para confirmar o consentimento (LGPD)',
        html: `
            <p>Olá${nome ? `, ${nome}` : ''}.</p>
            <p>Para confirmar o consentimento sobre os dados escolares, use o código:</p>
            <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${codigo}</p>
            <p>Ele vale por 5 minutos e serve apenas para esta confirmação.</p>
            <p><strong>Se você não pediu este código, ignore este e-mail</strong> — nenhum
            consentimento é registrado sem ele.</p>
        `,
    };
}

module.exports = {
    VALIDADE_MS,
    MAX_TENTATIVAS,
    METODOS,
    gerarCodigo,
    situacaoDoCodigo,
    registroDeConsentimento,
    emailDoCodigo,
};
