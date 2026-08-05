const mongoose = require('mongoose');

/**
 * IaAcaoPendente — ação de escrita aguardando confirmação do usuário.
 *
 * POR QUE NO BANCO, E NÃO EM MEMÓRIA
 * ----------------------------------
 * Um Map em memória funcionaria num processo só. O deploy é no Render, onde
 * um segundo processo (ou um restart durante os 5 minutos de validade) faria o
 * token sumir e a confirmação falhar de forma intermitente — o tipo de bug que
 * some quando se vai investigar.
 *
 * O QUE FICA GUARDADO AQUI
 * ------------------------
 * Os PARÂMETROS da ação. Isso é essencial: na confirmação o cliente envia
 * apenas o token, e o servidor executa o que ELE guardou. Se os parâmetros
 * viajassem de volta pelo cliente, a tela de confirmação viraria teatro — daria
 * para confirmar "criar turma 6C" e enviar outra coisa no lugar.
 *
 * O token não é gravado em claro: guarda-se o SHA-256 dele, como a denylist de
 * sessão já faz com o jti. Uma leitura do banco não devolve tokens utilizáveis.
 */

/** Janela de validade. Curta de propósito: é uma confirmação, não um rascunho. */
const TTL_MINUTOS = 5;

const IaAcaoPendenteSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },

    // SHA-256 do token entregue ao cliente.
    tokenHash: { type: String, required: true, unique: true },

    // Dono da ação. A confirmação revalida os dois — um token vazado não vale
    // nada nas mãos de outra pessoa nem em outra escola.
    usuarioId: { type: String, required: true, index: true },
    escolaId: { type: String, default: null },
    perfil: { type: String, required: true },

    ferramenta: { type: String, required: true },
    // Parâmetros já normalizados pelo preview. Fonte da verdade da execução.
    parametros: { type: mongoose.Schema.Types.Mixed, default: {} },
    resumo: { type: String, required: true },

    criadoEm: { type: Date, default: Date.now },
    expiraEm: { type: Date, required: true }
}, {
    strict: true,
    collection: 'ia_acoes_pendentes'
});

// A varredura do TTL roda a cada ~60s, então um token pode sobreviver alguns
// segundos além de `expiraEm`. Por isso o ConfirmationStore TAMBÉM compara a
// data no momento do consumo — o índice é limpeza, não é o controle.
IaAcaoPendenteSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.IaAcaoPendente
    || mongoose.model('IaAcaoPendente', IaAcaoPendenteSchema);
module.exports.TTL_MINUTOS = TTL_MINUTOS;
