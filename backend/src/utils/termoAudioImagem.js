/**
 * termoAudioImagem.js — identidade e vigência do Termo de Uso de Áudio e Imagem.
 *
 * POR QUE ESTE ARQUIVO EXISTE (Issue #118)
 * ----------------------------------------
 * `docs/moderacao/TERMO-DE-USO-AUDIO-IMAGEM.md`, cláusula 2.1:
 *
 *   "O envio da primeira mensagem de áudio ou imagem no chat só é liberado após
 *    o aceite expresso deste Termo, registrado no sistema com data, hora e
 *    identificação do usuário."
 *
 * O aceite era REGISTRADO, mas nunca EXIGIDO: nenhum middleware da rota de
 * upload o consultava. Quem chamasse `POST /api/chat-direto/upload` por fora do
 * navegador enviava áudio e imagem sem ter aceitado nada.
 *
 * A regra de "o que conta como aceite" mora aqui, e não dentro do controller,
 * porque agora ela tem DOIS leitores: a consulta (`GET
 * /api/moderacao/aceite-termo`) e a barreira (`middleware/exigirAceiteTermo`).
 * Duas cópias divergiriam no dia em que a versão do Termo mudasse — que é
 * exatamente o dia em que a divergência custa caro.
 *
 * A VERSÃO FAZ PARTE DA CHAVE
 * ---------------------------
 * A cláusula 2.4 prevê novo aceite quando o Termo mudar. Por isso a checagem
 * compara `termoId` E `versao`: quem aceitou a v1 não segue liberado depois de
 * uma alteração relevante. Trocar `TERMO_VERSAO` aqui é o que reabre o pedido
 * de aceite para todo mundo.
 */

const TERMO_ID = 'termo_audio_imagem';
const TERMO_VERSAO = '1.0';

/**
 * Devolve o aceite VIGENTE (mais recente na versão atual) ou `null`.
 *
 * @param {Array<{termoId?: string, versao?: string, aceitoEm?: Date}>} lgpdHistory
 *   histórico de assinaturas do usuário — é onde o aceite é gravado, e não num
 *   campo próprio, para não existirem dois lugares onde procurar a mesma coisa
 *   na hora de responder a um titular.
 */
function aceiteVigente(lgpdHistory) {
    return (
        (lgpdHistory || [])
            .filter((registro) => registro.termoId === TERMO_ID && registro.versao === TERMO_VERSAO)
            .sort((a, b) => new Date(b.aceitoEm) - new Date(a.aceitoEm))[0] || null
    );
}

module.exports = { TERMO_ID, TERMO_VERSAO, aceiteVigente };
