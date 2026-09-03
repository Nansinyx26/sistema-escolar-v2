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
 * Contas antigas têm `consentimentoAceiteEm` preenchido no cadastro sem
 * nenhuma entrada correspondente em `lgpdHistory` (ver os `Usuario.create` do
 * `UserController`). Ignorar esse campo faria o sistema pedir de novo um
 * consentimento que a pessoa já deu; ignorar o histórico faria o registro
 * auditável valer menos que o carimbo. Por isso `consentimentoVigente()` olha
 * os dois e devolve o mais recente.
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

module.exports = { CONSENTIMENTO_ID, CONSENTIMENTO_VERSAO, consentimentoVigente };
