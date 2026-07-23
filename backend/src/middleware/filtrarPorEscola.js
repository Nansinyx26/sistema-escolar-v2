/**
 * filtrarPorEscola — injeta req.escolaId (contexto multi-escola) nas rotas de dados.
 *
 * Ordem de resolução:
 *   1. req.session.escolaAtivaId (setado no login/cadastro/troca de escola);
 *   2. vínculo ÚNICO do usuário logado (professor/diretor/secretaria) — cacheia na sessão;
 *   3. escola ativa única do sistema (transição: hoje só a Jaguari é ativa);
 *   4. se o sistema ainda não tem escolas cadastradas (pré-migração/testes),
 *      segue sem filtro — comportamento idêntico ao anterior ao multi-escola.
 *
 * Usuário com MÚLTIPLOS vínculos e sem escola ativa na sessão recebe 409
 * { requiresEscolha: true } — o frontend deve exibir o seletor de escolas.
 *
 * Deve rodar APÓS authJWT (usa req.user).
 */
const Escola = require('../models/Escola');

const CARGO_MODEL = {
    professor: () => require('../models/Professor'),
    diretor: () => require('../models/Diretor'),
    secretaria: () => require('../models/Secretaria'),
};

// Cache leve do estado global de escolas (evita 1 query por request)
let escolasCache = { at: 0, total: 0, ativaUnicaId: null };
async function estadoEscolas() {
    if (Date.now() - escolasCache.at < 60_000) return escolasCache;
    const total = await Escola.countDocuments();
    let ativaUnicaId = null;
    if (total > 0) {
        const ativas = await Escola.find({ ativo: true }).select('_id').limit(2).lean();
        if (ativas.length === 1) ativaUnicaId = String(ativas[0]._id);
    }
    escolasCache = { at: Date.now(), total, ativaUnicaId };
    return escolasCache;
}
// Permite invalidar o cache (ex.: ao ativar uma escola)
function invalidarCacheEscolas() { escolasCache.at = 0; }

async function vinculosDoUsuario(user) {
    if (!user) return [];
    const loader = CARGO_MODEL[user.perfil];
    if (!loader) return []; // responsavel/aluno/admin não usam vinculos de equipe
    const Model = loader();
    const doc = await Model.findOne({
        $or: [{ idUsuario: String(user.id || user._id) }, { email: user.email }]
    }).select('vinculos').lean();
    return (doc && doc.vinculos) || [];
}

module.exports = async function filtrarPorEscola(req, res, next) {
    try {
        // 1. Sessão já tem escola ativa
        if (req.session && req.session.escolaAtivaId) {
            req.escolaId = req.session.escolaAtivaId;
            return next();
        }

        const estado = await estadoEscolas();

        // 4. Sistema sem escolas (pré-migração/testes) — segue sem filtro
        if (estado.total === 0) return next();

        // 2. Vínculo único do usuário
        const vinculos = await vinculosDoUsuario(req.user);
        if (vinculos.length === 1) {
            req.escolaId = vinculos[0].escolaId;
            if (req.session) req.session.escolaAtivaId = req.escolaId;
            return next();
        }
        if (vinculos.length > 1) {
            return res.status(409).json({
                success: false,
                requiresEscolha: true,
                error: 'Selecione a escola em que deseja trabalhar.',
                escolas: vinculos.map(v => v.escolaId)
            });
        }

        // 3. Perfis sem vínculo (admin, responsavel, aluno) — escola ativa única
        if (estado.ativaUnicaId) {
            req.escolaId = estado.ativaUnicaId;
            if (req.session) req.session.escolaAtivaId = req.escolaId;
        }
        return next();
    } catch (e) {
        // SEGURANÇA: falha FECHADA. Seguir sem req.escolaId fazia todos os
        // controllers (padrão `if (req.escolaId) query.escolaId = ...`)
        // simplesmente abandonarem o filtro e varrerem a rede inteira.
        console.error('[filtrarPorEscola] erro:', e.message);
        try {
            const estado = await estadoEscolas();
            if (estado.total === 0) return next(); // pré-migração/testes: sem multi-tenant
        } catch (_) { /* estado indisponível → trata como multi-tenant ativo */ }
        return res.status(503).json({
            success: false,
            error: 'Não foi possível determinar a escola desta sessão. Faça login novamente.'
        });
    }
};
/**
 * Filtro de LEITURA por escola.
 *
 * ESTRITO por padrão: só retorna documentos da escola ativa. Registros
 * legados (escolaId ausente, null, '' ou 'default') ficam de fora — incluí-los
 * significava que QUALQUER documento sem escolaId era visível para TODAS as
 * escolas da rede, furando o isolamento multi-tenant.
 *
 * Durante a transição, `ESCOLA_INCLUIR_LEGADOS=true` restaura a tolerância.
 * Use apenas até rodar `npm run migrate:multiescola`; nenhum caminho de
 * criação grava mais 'default'.
 *
 * @param {string} [escolaId] valor de req.escolaId
 * @returns {Object} objeto de filtro Mongo (vazio = sem restrição por escola)
 */
const INCLUIR_LEGADOS = String(process.env.ESCOLA_INCLUIR_LEGADOS || '').toLowerCase() === 'true';

function escolaMatch(escolaId) {
    if (!escolaId || escolaId === 'default') return {};
    if (!INCLUIR_LEGADOS) return { escolaId: String(escolaId) };
    return {
        $or: [
            { escolaId: String(escolaId) },
            { escolaId: { $in: [null, '', 'default'] } },
            { escolaId: { $exists: false } },
        ],
    };
}

module.exports.invalidarCacheEscolas = invalidarCacheEscolas;
module.exports.vinculosDoUsuario = vinculosDoUsuario;
module.exports.escolaMatch = escolaMatch;
