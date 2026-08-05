const mongoose = require('mongoose');

/**
 * IaConversa — histórico das conversas com o copiloto.
 *
 * O QUE É PERSISTIDO, E O QUE NÃO É
 * ---------------------------------
 * Só os turnos de TEXTO (pergunta do usuário e resposta final do assistente).
 * O retorno cru das ferramentas é deliberadamente descartado.
 *
 * O motivo é de proteção de dados: um retorno de `consultarNotas` carrega nome,
 * matrícula e notas de um aluno. Persistido, ele viraria uma cópia paralela do
 * boletim dentro da conversa de OUTRA pessoa — fora dos models que a rotina de
 * anonimização sabe limpar. Anonimizar o aluno esvaziaria `Nota` e deixaria o
 * número intacto aqui.
 *
 * A resposta do assistente ainda pode citar um número ("João tem 12 faltas"), e
 * isso é inevitável sem destruir a funcionalidade. O que se faz com esse
 * resíduo é limitar a janela (TTL, abaixo) e garantir a exclusão a pedido.
 *
 * EXPIRAÇÃO AUTOMÁTICA
 * --------------------
 * Índice TTL sobre `atualizadoEm`: a conversa some 90 dias após a última
 * mensagem. Não é limpeza de disco — é redução de exposição. Uma conversa
 * parada há três meses tem valor de uso quase nulo e continua sendo dado
 * pessoal de terceiros esperando um incidente.
 */

const DIAS_RETENCAO = Number(process.env.IA_RETENCAO_DIAS) || 90;

const MensagemSchema = new mongoose.Schema({
    papel: { type: String, enum: ['usuario', 'assistente'], required: true },
    texto: { type: String, required: true },
    // Nomes das ferramentas consultadas neste turno. Só os NOMES — nunca o
    // retorno delas. Serve para auditoria ("de onde veio esse número?") sem
    // replicar o dado consultado.
    ferramentas: { type: [String], default: undefined },
    em: { type: Date, default: Date.now }
}, { _id: false });

const IaConversaSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },

    usuarioId: { type: String, required: true, index: true },
    // Multi-escola: o mesmo discriminador de tenant do resto do sistema. Uma
    // conversa pertence à escola em que foi tida — trocar de escola não deve
    // trazer junto o histórico da anterior.
    escolaId: { type: String, index: true },

    titulo: { type: String, default: 'Nova conversa' },
    mensagens: { type: [MensagemSchema], default: [] },

    /**
     * Resumo comprimido dos turnos que já saíram da janela enviada ao modelo.
     * É o que dá continuidade a uma conversa longa sem reenviar (e repagar)
     * o histórico inteiro a cada mensagem.
     */
    resumo: { type: String, default: '' },
    mensagensResumidas: { type: Number, default: 0 },

    criadoEm: { type: Date, default: Date.now },
    // SEM `index: true` aqui de propósito. Ele criaria um índice `atualizadoEm_1`
    // simples, e o MongoDB recusa um segundo índice com a MESMA chave e opções
    // diferentes — o índice TTL declarado abaixo falharia em silêncio e a
    // retenção de 90 dias simplesmente não aconteceria. O próprio índice TTL já
    // serve as consultas por essa chave.
    atualizadoEm: { type: Date, default: Date.now }
}, {
    strict: true,
    collection: 'ia_conversas'
});

// Lista da sidebar: conversas de um usuário numa escola, mais recentes primeiro.
IaConversaSchema.index({ usuarioId: 1, escolaId: 1, atualizadoEm: -1 });

// TTL. O MongoDB varre a cada ~60s e remove o que passou da janela.
IaConversaSchema.index(
    { atualizadoEm: 1 },
    { expireAfterSeconds: DIAS_RETENCAO * 24 * 60 * 60, name: 'ttl_retencao_conversa' }
);

const IaConversa = mongoose.models.IaConversa || mongoose.model('IaConversa', IaConversaSchema);

/**
 * Alinha o índice TTL ao valor atual de `IA_RETENCAO_DIAS`.
 *
 * O MongoDB grava `expireAfterSeconds` DENTRO do índice, no momento da criação.
 * Mudar a variável de ambiente e reiniciar não tem efeito nenhum: o índice
 * antigo continua valendo e a retenção segue a do dia em que a coleção nasceu —
 * em silêncio, que é o pior modo de uma política de dados falhar.
 *
 * `collMod` reconfigura o índice existente sem derrubá-lo (portanto sem perder
 * a proteção durante a janela de recriação).
 *
 * @returns {Promise<{acao: string, de?: number, para?: number}>}
 */
async function sincronizarRetencao() {
    const desejado = DIAS_RETENCAO * 24 * 60 * 60;
    const colecao = IaConversa.collection;

    let indices;
    try {
        indices = await colecao.indexes();
    } catch (e) {
        // Coleção ainda não existe (base nova): o índice nasce correto no
        // primeiro insert, via `ensureIndexes` do Mongoose.
        if (e.codeName === 'NamespaceNotFound' || e.code === 26) {
            return { acao: 'colecao-inexistente' };
        }
        throw e;
    }

    const atual = indices.find(i => i.name === 'ttl_retencao_conversa');

    if (!atual) {
        await colecao.createIndex(
            { atualizadoEm: 1 },
            { expireAfterSeconds: desejado, name: 'ttl_retencao_conversa' }
        );
        return { acao: 'criado', para: desejado };
    }

    if (atual.expireAfterSeconds === desejado) {
        return { acao: 'ja-alinhado', para: desejado };
    }

    await colecao.conn.db.command({
        collMod: colecao.collectionName,
        index: { name: 'ttl_retencao_conversa', expireAfterSeconds: desejado }
    });

    return { acao: 'atualizado', de: atual.expireAfterSeconds, para: desejado };
}

module.exports = IaConversa;
module.exports.DIAS_RETENCAO = DIAS_RETENCAO;
module.exports.sincronizarRetencao = sincronizarRetencao;
