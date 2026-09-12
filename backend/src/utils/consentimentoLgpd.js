/**
 * consentimentoLgpd.js — identidade e vigência do CONSENTIMENTO GERAL de dados.
 *
 * POR QUE ESTE ARQUIVO EXISTE (Issue #201)
 * ----------------------------------------
 * O sistema tinha DOIS consentimentos e só um caminho para assinar cada um:
 *
 *   • o Termo de Áudio e Imagem (`utils/termoAudioImagem.js`), assinável por
 *     qualquer perfil na página `html/termo-audio-imagem.html`; e
 *   • o consentimento LGPD geral (`consentimentoAceiteEm` /
 *     `consentimentoVersao`), gravado APENAS no onboarding do responsável
 *     (`UserController.updateProfile`, ramo `isResponsavel`).
 *
 * Professor, diretor, secretaria e admin não tinham por onde consentir. "Meus
 * Dados" dizia, para eles, "Consentimento LGPD: Não registrado" — e continuaria
 * dizendo para sempre, porque nenhuma tela deles escrevia nesse campo. Isso é
 * pior do que uma lacuna de interface: a base legal do tratamento dos dados
 * desses titulares não estava registrada em lugar nenhum.
 *
 * A regra de "o que conta como consentimento" mora aqui, e não dentro de um
 * controller, pelo mesmo motivo do arquivo irmão: ela já tem mais de um leitor
 * (o aceite em `ModeracaoController` e a consulta em `MeusDadosController`), e
 * duas cópias divergiriam — foi exatamente o que aconteceu com o `termoId` do
 * Termo de Áudio e Imagem, escrito `'TERMO_AUDIO_IMAGEM'` de um lado e
 * `'termo_audio_imagem'` do outro, o que fazia o aceite nunca aparecer.
 *
 * A VERSÃO É A MESMA QUE O PORTAL JÁ GRAVA
 * ----------------------------------------
 * `portal-responsavel/src/components/CompletarCadastro.tsx` registra
 * `{ termoId: 'politica_privacidade', versao: '2.0' }`. Usar outro par aqui
 * criaria dois consentimentos "gerais" concorrentes e faria o responsável que
 * já assinou no portal aparecer como pendente.
 *
 * DOIS LUGARES ONDE O ACEITE PODE ESTAR — E ISSO É HERANÇA, NÃO DESIGN
 * -------------------------------------------------------------------
 * O aceite auditável mora em `lgpdHistory` (com IP, navegador e versão). O
 * campo `consentimentoAceiteEm` é o formato antigo, e ainda é o que o portal e
 * o `GET /api/auth/me` leem — por isso `consentimentoVigente()` olha os dois e
 * devolve o mais recente.
 *
 * O CAMPO SÓ VALE SE ALGUÉM CONSENTIU (Issue #236)
 * ------------------------------------------------
 * Até a #236, sete caminhos de criação de conta gravavam
 * `consentimentoAceiteEm: now` no próprio `Usuario.create`, sem tela e sem
 * ninguém marcar nada. Como esta função trata o campo como consentimento
 * válido, o carimbo fazia três estragos:
 *
 *   • "Meus Dados" (Art. 18) informava ao titular um consentimento que ele
 *     nunca deu, com a data do cadastro;
 *   • o `ModeracaoController` só grava o aceite auditável quando
 *     `!consentimentoAtual.aceito` — com o carimbo, nunca gravava, nem quando
 *     a pessoa assinava de verdade;
 *   • o `EditarPerfil` do portal abria as caixas de consentimento já marcadas.
 *
 * Os sete caminhos pararam de gravar, e a migração
 * `1788652800000-invalidar-consentimento-carimbado-no-cadastro` tirou o
 * carimbo das contas antigas — só onde ele coincide com o `createdAt` e não há
 * aceite no histórico. Quem gravar este campo de novo precisa ter um ato do
 * titular por trás; criar a conta não é um.
 */

/** Mesmo par que o portal grava — ver o bloco "A VERSÃO" acima. */
const CONSENTIMENTO_ID = 'politica_privacidade';
const CONSENTIMENTO_VERSAO = '2.0';

/**
 * O consentimento vigente do titular, vindo do histórico OU do campo legado.
 *
 * @param {{lgpdHistory?: Array, consentimentoAceiteEm?: Date, consentimentoVersao?: string}} usuario
 *   documento do usuário (aceita `.lean()`), com pelo menos `lgpdHistory`,
 *   `consentimentoAceiteEm` e `consentimentoVersao` selecionados.
 * @returns {{aceito: boolean, aceitoEm: Date|null, versao: string|null}}
 */
function consentimentoVigente(usuario) {
    const doHistorico = (usuario?.lgpdHistory || [])
        .filter((registro) => registro.termoId === CONSENTIMENTO_ID)
        .sort((a, b) => new Date(b.aceitoEm) - new Date(a.aceitoEm))[0];

    const doCampo = usuario?.consentimentoAceiteEm
        ? { aceitoEm: usuario.consentimentoAceiteEm, versao: usuario.consentimentoVersao || null }
        : null;

    const candidatos = [
        doHistorico && { aceitoEm: doHistorico.aceitoEm, versao: doHistorico.versao || null },
        doCampo,
    ].filter(Boolean);

    if (candidatos.length === 0) {
        return { aceito: false, aceitoEm: null, versao: null };
    }

    const maisRecente = candidatos.sort((a, b) => new Date(b.aceitoEm) - new Date(a.aceitoEm))[0];

    return { aceito: true, aceitoEm: maisRecente.aceitoEm, versao: maisRecente.versao };
}

/**
 * O pedido traz um aceite EXPLÍCITO da versão vigente? (Issue #288)
 *
 * É a forma com que uma tela de cadastro diz "a pessoa marcou a caixa":
 * `{ aceito: true, versao: '2.0' }`. Qualquer outra coisa — campo ausente,
 * `aceito` que não seja o booleano `true`, versão que o servidor não conhece —
 * não é consentimento, e a conta nasce sem ele (Issue #236).
 *
 * @param {unknown} consentimento `consentimentoLgpd` do corpo do pedido.
 * @returns {boolean}
 */
function aceiteExplicitoVigente(consentimento) {
    return consentimento?.aceito === true && consentimento?.versao === CONSENTIMENTO_VERSAO;
}

module.exports = {
    CONSENTIMENTO_ID,
    CONSENTIMENTO_VERSAO,
    consentimentoVigente,
    aceiteExplicitoVigente,
};
