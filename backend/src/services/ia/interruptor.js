/**
 * interruptor.js — a IA é ligada por escola (Issue #401).
 *
 * Mandar dado de aluno, mesmo pseudonimizado, para um provedor externo é
 * decisão da escola, não do sistema. Por isso o padrão é DESLIGADO: a rede
 * liga escola por escola, depois de decidir e avisar as famílias.
 *
 *   IA_ESCOLAS_PADRAO=ligada  → escolas sem decisão registrada ficam ligadas
 *   Escola.iaHabilitada       → decisão daquela escola (vence o padrão)
 *
 * Sem escola resolvida (admin da rede, por exemplo), vale o padrão.
 */
const Escola = require('../../models/Escola');

const TTL_MS = 30_000;
const cache = new Map();

function padraoDaRede() {
    return String(process.env.IA_ESCOLAS_PADRAO || '').toLowerCase() === 'ligada';
}

/** @returns {Promise<boolean>} */
async function iaLiberada(escolaId) {
    if (!escolaId) return padraoDaRede();
    const chave = String(escolaId);
    const emCache = cache.get(chave);
    if (emCache && Date.now() - emCache.at < TTL_MS) return emCache.valor;

    let valor = padraoDaRede();
    try {
        const escola = await Escola.findById(chave).select('iaHabilitada').lean();
        if (escola && typeof escola.iaHabilitada === 'boolean') valor = escola.iaHabilitada;
    } catch (_e) {
        // Sem conseguir ler a decisão, vale o padrão da rede.
    }
    cache.set(chave, { at: Date.now(), valor });
    return valor;
}

const RESPOSTA_DESLIGADA = {
    success: false,
    codigo: 'IA_DESLIGADA_NESTA_ESCOLA',
    error: 'O assistente está desligado nesta escola. A direção pode ligá-lo nas configurações.',
};

function limparCache() {
    cache.clear();
}

module.exports = { iaLiberada, RESPOSTA_DESLIGADA, limparCache };
