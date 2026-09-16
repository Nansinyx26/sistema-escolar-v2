/**
 * BloqueioIpService — falhas de autenticação por IP e bloqueio progressivo.
 *
 * Fluxo de uma tentativa (ver middleware/protecaoLogin.js):
 *   1. `registrarTentativa` — IP bloqueado? responde 429 sem tocar no login;
 *                             senão soma 1 ANTES do login rodar (uma operação só);
 *   2. login certo          — `devolverTentativa` desfaz a soma;
 *      login errado         — a soma fica; no teto, `bloquear`.
 *
 * Contar antes e devolver no sucesso é o que segura a rajada paralela: se o
 * contador só subisse depois da resposta, cem requisições disparadas juntas
 * passariam todas antes de a primeira falha ser registrada.
 *
 * Todas as escritas são UMA operação atômica no documento do IP, então duas
 * instâncias atendendo o mesmo atacante não perdem contagem nem aplicam o
 * mesmo bloqueio duas vezes (o que pularia um nível de reincidência).
 */
const BloqueioIp = require('../../models/BloqueioIp');

// Teto do expoente: 2^20 × base já passa de qualquer teto razoável, e evita
// que um nível acumulado por anos vire número sem sentido no documento.
const NIVEL_MAXIMO = 20;

const idDoRegistro = (escopo, chave) => `${escopo}:${chave}`;

/**
 * @returns {Promise<{ bloqueado: boolean, restanteMs?: number, nivel?: number }>}
 */
async function consultar(escopo, chave, agora = new Date()) {
    const doc = await BloqueioIp.collection.findOne(
        { _id: idDoRegistro(escopo, chave) },
        { projection: { bloqueadoAte: 1, nivel: 1 } }
    );
    if (!doc?.bloqueadoAte || doc.bloqueadoAte <= agora) return { bloqueado: false };
    return {
        bloqueado: true,
        restanteMs: doc.bloqueadoAte.getTime() - agora.getTime(),
        nivel: doc.nivel,
    };
}

/**
 * Soma uma tentativa na janela atual (ou abre uma janela nova), a menos que o
 * IP já esteja bloqueado.
 *
 * Verificar o bloqueio e contar são UMA operação. Separadas, uma rajada
 * passava assim: a 6ª requisição aplicava o bloqueio (que zera as falhas) e as
 * que já tinham passado pela verificação contavam de novo a partir do zero,
 * chegando ao login. Tentativa feita durante o bloqueio também não conta: se
 * contasse, o primeiro erro depois do prazo já bloquearia de novo, num nível
 * acima, por tentativas que nunca chegaram ao login.
 *
 * @returns {Promise<{ tentativas: number, restanteMs: number }>} tentativas na
 *   janela, incluindo esta; `restanteMs` > 0 quando o IP está bloqueado
 */
async function registrarTentativa(escopo, chave, config, agora = new Date()) {
    const bloqueadoAgora = { $gt: ['$bloqueadoAte', agora] };
    const janelaValida = { $gt: ['$janelaFimEm', agora] };
    const doc = await BloqueioIp.collection.findOneAndUpdate(
        { _id: idDoRegistro(escopo, chave) },
        [
            {
                $set: {
                    escopo,
                    chave,
                    // Bloqueado: não mexe. Janela valendo: soma. Senão: recomeça.
                    falhas: {
                        $cond: [
                            bloqueadoAgora,
                            '$falhas',
                            {
                                $cond: [
                                    janelaValida,
                                    { $add: [{ $ifNull: ['$falhas', 0] }, 1] },
                                    1,
                                ],
                            },
                        ],
                    },
                    janelaFimEm: {
                        $cond: [
                            { $or: [bloqueadoAgora, janelaValida] },
                            '$janelaFimEm',
                            new Date(agora.getTime() + config.janelaMs),
                        ],
                    },
                    nivel: { $ifNull: ['$nivel', 0] },
                },
            },
            // O registro vive pelo menos até a janela acabar. Se já existe um
            // prazo maior (memória de reincidência), ele é mantido.
            {
                $set: {
                    expiraEm: { $max: [{ $ifNull: ['$expiraEm', agora] }, '$janelaFimEm'] },
                },
            },
        ],
        { upsert: true, returnDocument: 'after' }
    );
    const restanteMs = doc.bloqueadoAte ? doc.bloqueadoAte.getTime() - agora.getTime() : 0;
    return { tentativas: doc.falhas, restanteMs: Math.max(0, restanteMs) };
}

/** Login que não falhou por credencial: a tentativa não conta. */
async function devolverTentativa(escopo, chave, agora = new Date()) {
    await BloqueioIp.collection.updateOne(
        { _id: idDoRegistro(escopo, chave), falhas: { $gt: 0 }, janelaFimEm: { $gt: agora } },
        { $inc: { falhas: -1 } }
    );
}

/**
 * Aplica o bloqueio, se o IP ainda não estiver bloqueado.
 *
 * Duração = base × 2^(nível − 1), limitada ao teto. O nível sobe quando o
 * bloqueio anterior terminou dentro da memória de reincidência; fora dela,
 * recomeça em 1.
 *
 * @returns {Promise<{ aplicado: boolean, nivel: number, duracaoMs: number, restanteMs: number }>}
 */
async function bloquear(escopo, chave, config, agora = new Date()) {
    const id = idDoRegistro(escopo, chave);
    const inicioDaMemoria = new Date(agora.getTime() - config.memoriaMs);
    const doc = await BloqueioIp.collection.findOneAndUpdate(
        { _id: id, $or: [{ bloqueadoAte: null }, { bloqueadoAte: { $lte: agora } }] },
        [
            {
                $set: {
                    nivel: {
                        $cond: [
                            { $gte: ['$bloqueadoAte', inicioDaMemoria] },
                            { $min: [{ $add: [{ $ifNull: ['$nivel', 0] }, 1] }, NIVEL_MAXIMO] },
                            1,
                        ],
                    },
                },
            },
            {
                $set: {
                    duracaoMs: {
                        $min: [
                            config.bloqueioMaxMs,
                            {
                                $multiply: [
                                    config.bloqueioBaseMs,
                                    { $pow: [2, { $subtract: ['$nivel', 1] }] },
                                ],
                            },
                        ],
                    },
                },
            },
            {
                $set: {
                    duracaoMs: { $toLong: '$duracaoMs' },
                    bloqueadoAte: { $add: [agora, { $toLong: '$duracaoMs' }] },
                    ultimoBloqueioEm: agora,
                    falhas: 0,
                    janelaFimEm: null,
                    expiraEm: { $add: [agora, { $toLong: '$duracaoMs' }, config.memoriaMs] },
                },
            },
        ],
        { returnDocument: 'after' }
    );

    if (doc) {
        return {
            aplicado: true,
            nivel: doc.nivel,
            duracaoMs: Number(doc.duracaoMs),
            restanteMs: doc.bloqueadoAte.getTime() - agora.getTime(),
        };
    }

    // Outra requisição (ou outra instância) bloqueou primeiro: devolve o
    // bloqueio que já está valendo, sem subir o nível de novo.
    const atual = await consultar(escopo, chave, agora);
    return {
        aplicado: false,
        nivel: atual.nivel || 0,
        duracaoMs: 0,
        restanteMs: atual.restanteMs || config.bloqueioBaseMs,
    };
}

/** Bloqueios ativos, do mais recente para o mais antigo. */
async function listarAtivos(agora = new Date(), limite = 200) {
    const docs = await BloqueioIp.collection
        .find({ bloqueadoAte: { $gt: agora } })
        .sort({ bloqueadoAte: -1 })
        .limit(limite)
        .toArray();
    return docs.map((d) => ({
        id: d._id,
        escopo: d.escopo,
        chave: d.chave,
        nivel: d.nivel,
        bloqueadoAte: d.bloqueadoAte,
        restanteSegundos: Math.ceil((d.bloqueadoAte.getTime() - agora.getTime()) / 1000),
        ultimoBloqueioEm: d.ultimoBloqueioEm,
    }));
}

/**
 * Remove o registro inteiro (bloqueio, falhas e reincidência). É o que o
 * administrador usa quando o bloqueio foi falso positivo, como a escola toda
 * saindo pelo mesmo IP.
 */
async function remover(id) {
    const { deletedCount } = await BloqueioIp.collection.deleteOne({ _id: String(id) });
    return deletedCount > 0;
}

module.exports = {
    consultar,
    registrarTentativa,
    devolverTentativa,
    bloquear,
    listarAtivos,
    remover,
};
