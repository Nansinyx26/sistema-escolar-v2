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
 * Quem decide pela escola (direção e admin) usa sem pedir (Issue #725): para
 * esses perfis, escola sem decisão registrada conta como ligada. Se a escola
 * GRAVOU `false`, a decisão vale para eles também — é assim que a direção
 * desliga. Professor e secretaria seguem o padrão da rede.
 *
 * Sem escola resolvida (admin da rede, por exemplo), vale o padrão do perfil.
 */
const Escola = require('../../models/Escola');

const TTL_MS = 30_000;
const cache = new Map();

function padraoDaRede() {
    return String(process.env.IA_ESCOLAS_PADRAO || '').toLowerCase() === 'ligada';
}

// Quem decide pela escola (Issue #711). A rota que grava a decisão confere de
// novo — inclusive o vínculo com a escola —, então `podeLigar` só decide se a
// tela oferece o botão, e `escolaId` diz qual escola o interruptor consultou.
const PERFIS_QUE_LIGAM = new Set(['diretor', 'admin']);

/** Decisão gravada pela escola: `true`, `false` ou `null` (sem decisão). */
async function decisaoDaEscola(escolaId) {
    const chave = String(escolaId);
    const emCache = cache.get(chave);
    if (emCache && Date.now() - emCache.at < TTL_MS) return emCache.decisao;

    let decisao = null;
    try {
        const escola = await Escola.findById(chave).select('iaHabilitada').lean();
        if (escola && typeof escola.iaHabilitada === 'boolean') decisao = escola.iaHabilitada;
    } catch (_e) {
        // Sem conseguir ler a decisão, vale o padrão.
    }
    cache.set(chave, { at: Date.now(), decisao });
    return decisao;
}

/**
 * @param {string|null} escolaId escola resolvida da requisição
 * @param {string} [perfil] perfil de quem pede; direção e admin usam sem pedir
 * @returns {Promise<boolean>}
 */
async function iaLiberada(escolaId, perfil) {
    const padrao = PERFIS_QUE_LIGAM.has(perfil) || padraoDaRede();
    if (!escolaId) return padrao;
    const decisao = await decisaoDaEscola(escolaId);
    return decisao === null ? padrao : decisao;
}

const RESPOSTA_DESLIGADA = {
    success: false,
    codigo: 'IA_DESLIGADA_NESTA_ESCOLA',
    error: 'O assistente está desligado nesta escola. A direção pode ligá-lo na página do Assistente de IA.',
};

/** Resposta 403 dizendo também se quem perguntou pode ligar a IA, e onde. */
function respostaDesligada(perfil, escolaId) {
    if (!PERFIS_QUE_LIGAM.has(perfil) || !escolaId) {
        return { ...RESPOSTA_DESLIGADA, podeLigar: false };
    }
    return { ...RESPOSTA_DESLIGADA, podeLigar: true, escolaId: String(escolaId) };
}

function limparCache() {
    cache.clear();
}

module.exports = { iaLiberada, RESPOSTA_DESLIGADA, respostaDesligada, limparCache };
