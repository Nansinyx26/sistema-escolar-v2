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
const logger = require('../utils/logger');
const logContext = require('../utils/logContext');
const escolaBloqueio = require('../services/escolaBloqueio');

const CARGO_MODEL = {
    professor: () => require('../models/Professor'),
    diretor: () => require('../models/Diretor'),
    secretaria: () => require('../models/Secretaria'),
};

// Cache leve do estado global de escolas (evita 1 query por request)
// Quem opera DENTRO de uma escola. Sem escola resolvida, a requisição destes
// perfis é recusada (Issue #396).
const PERFIS_DE_EQUIPE = ['diretor', 'secretaria', 'professor'];

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
function invalidarCacheEscolas() {
    escolasCache.at = 0;
    conferenciasDaSessao.clear();
}

// Resultado da conferência "esta escola da sessão ainda vale para esta conta
// de equipe", por 60 s — o mesmo horizonte do cache de escolas acima. Sem ele,
// toda requisição de equipe pagaria a consulta de vínculo. Teto de entradas
// para não crescer sem limite num processo de vida longa.
const conferenciasDaSessao = new Map();
const CONFERENCIA_TTL_MS = 60_000;
const CONFERENCIA_MAX = 5000;

async function vinculosDoUsuario(user) {
    if (!user) return [];
    const loader = CARGO_MODEL[user.perfil];
    if (!loader) return []; // responsavel/aluno/admin não usam vinculos de equipe
    const Model = loader();
    const doc = await Model.findOne({
        $or: [{ idUsuario: String(user.id || user._id) }, { email: user.email }],
    })
        .select('vinculos')
        .lean();
    return (doc && doc.vinculos) || [];
}

/**
 * Fixa a escola na requisição E no contexto de log. Todo log emitido daqui em
 * diante carrega `escolaId`, o que torna auditável — pelo próprio log — se uma
 * requisição tocou dados de outra escola.
 */
/**
 * Escola gravada no próprio cadastro do usuário. É o que salva as contas
 * criadas antes do documento de vínculo existir — sem isso elas cairiam na
 * recusa do passo 5. `npm run migrate:multiescola` preenche os vínculos.
 */
async function escolaIdDaConta(user) {
    const id = user?.id || user?._id;
    if (!id) return null;
    try {
        const Usuario = require('../models/Usuario');
        const conta = await Usuario.findById(String(id)).select('escolaId').lean();
        return conta?.escolaId ? String(conta.escolaId) : null;
    } catch (_e) {
        return null;
    }
}

function definirEscola(req, escolaId) {
    req.escolaId = escolaId;
    logContext.set({ escolaId: escolaId ? String(escolaId) : undefined });
}

function idDoUsuario(user) {
    return String(user?.id || user?._id || '');
}

/** Grava a escola na sessão SEMPRE junto com o dono dela (Issue #576). */
function gravarNaSessao(req) {
    if (!req.session) return;
    req.session.escolaAtivaId = req.escolaId;
    req.session.usuarioId = idDoUsuario(req.user);
}

/**
 * A escola guardada na sessão ainda vale para quem está fazendo a requisição?
 * (Issue #576)
 *
 * O cookie da sessão (`escola_sess`) é independente do JWT. A escola ficava lá
 * e era usada por quem viesse depois no mesmo navegador — o login só a
 * sobrescrevia quando resolvia outra, e login com Google nem tocava a sessão.
 * E quem perdia o vínculo com a escola continuava operando nela até a sessão
 * expirar.
 *
 * Vale quando:
 *   1. a sessão é DESTA conta (`usuarioId` igual ao do token). Sessão sem dono
 *      (criada antes desta regra) também é descartada: a resolução abaixo a
 *      refaz, agora com dono;
 *   2. para equipe, a escola é uma que a própria resolução aceitaria — um dos
 *      vínculos; sem vínculo, a escola da conta; sem as duas, a ativa única.
 *      Admin (rede) e responsável (acesso pelo filho) não têm vínculo de
 *      equipe: para eles basta o item 1.
 */
async function escolaDaSessaoVale(req) {
    const meuId = idDoUsuario(req.user);
    if (!meuId || String(req.session.usuarioId || '') !== meuId) return false;

    const perfil = String(req.user?.perfil || '').toLowerCase();
    if (!PERFIS_DE_EQUIPE.includes(perfil)) return true;

    const escola = String(req.session.escolaAtivaId);
    const chave = `${meuId}:${escola}`;
    const guardada = conferenciasDaSessao.get(chave);
    if (guardada && Date.now() - guardada.em < CONFERENCIA_TTL_MS) return guardada.ok;

    const vinculos = await vinculosDoUsuario(req.user);
    let ok;
    if (vinculos.length > 0) {
        ok = vinculos.some((v) => String(v.escolaId) === escola);
    } else {
        const daConta = await escolaIdDaConta(req.user);
        ok = daConta ? daConta === escola : (await estadoEscolas()).ativaUnicaId === escola;
    }

    if (conferenciasDaSessao.size >= CONFERENCIA_MAX) conferenciasDaSessao.clear();
    conferenciasDaSessao.set(chave, { ok, em: Date.now() });
    return ok;
}

/**
 * Segue adiante, a menos que a escola resolvida esteja bloqueada (Issue #463).
 * É aqui que se pega a escola que só o VÍNCULO revela — o authJWT conhece
 * apenas a da sessão e a do cadastro. O super admin passa sempre: é assim que
 * ele visualiza uma escola bloqueada.
 */
async function seguirSeEscolaLiberada(req, res, next) {
    const bloqueada = await escolaBloqueio.escolaBloqueadaPara(req.user, [req.escolaId]);
    if (bloqueada) return escolaBloqueio.recusarSessaoBloqueada(req, res, bloqueada);
    return next();
}

module.exports = async function filtrarPorEscola(req, res, next) {
    try {
        // 1. Sessão já tem escola ativa — e ela é desta conta (Issue #576)
        if (req.session && req.session.escolaAtivaId) {
            if (await escolaDaSessaoVale(req)) {
                definirEscola(req, req.session.escolaAtivaId);
                return seguirSeEscolaLiberada(req, res, next);
            }
            logger.warn('[filtrarPorEscola] escola da sessão descartada', {
                perfil: req.user?.perfil,
                motivo:
                    String(req.session.usuarioId || '') === idDoUsuario(req.user)
                        ? 'sem_vinculo'
                        : 'outra_conta',
                action: 'tenant.sessaoDescartada',
            });
            req.session.escolaAtivaId = undefined;
            req.session.usuarioId = undefined;
            req.session.superAdminContexto = undefined;
        }

        const estado = await estadoEscolas();

        // 4. Sistema sem escolas (pré-migração/testes) — segue sem filtro
        if (estado.total === 0) return next();

        // 2. Vínculo único do usuário
        const vinculos = await vinculosDoUsuario(req.user);
        if (vinculos.length === 1) {
            definirEscola(req, vinculos[0].escolaId);
            gravarNaSessao(req);
            return seguirSeEscolaLiberada(req, res, next);
        }
        if (vinculos.length > 1) {
            return res.status(409).json({
                success: false,
                requiresEscolha: true,
                error: 'Selecione a escola em que deseja trabalhar.',
                escolas: vinculos.map((v) => v.escolaId),
            });
        }

        // 3. Escola do próprio cadastro (contas anteriores ao multi-escola,
        //    criadas antes de existir o documento de vínculo).
        const escolaDaConta = await escolaIdDaConta(req.user);
        if (escolaDaConta) {
            definirEscola(req, escolaDaConta);
            gravarNaSessao(req);
            return seguirSeEscolaLiberada(req, res, next);
        }

        // 4. Rede com uma única escola ativa: é ela, para qualquer perfil.
        if (estado.ativaUnicaId) {
            definirEscola(req, estado.ativaUnicaId);
            gravarNaSessao(req);
            return seguirSeEscolaLiberada(req, res, next);
        }

        // 5. Nada resolveu a escola.
        //
        // Para PERFIL DE EQUIPE isso é motivo de recusa (Issue #396). Seguir
        // adiante sem `req.escolaId` faz cada controller — que filtra no
        // padrão `if (req.escolaId) query.escolaId = ...` — abandonar o recorte
        // e responder com a rede inteira. Enquanto houver uma escola ativa só,
        // o passo 4 resolve e este caminho nem é alcançado; ele existe para o
        // dia em que a segunda escola for ativada.
        //
        // O admin é a exceção explícita: a conta dele é da rede, não de uma
        // escola, e é por ela que se administra uma escola ainda sem equipe.
        // O responsável também segue: o acesso dele é decidido pelo vínculo com
        // o próprio filho, não pela escola da sessão.
        if (PERFIS_DE_EQUIPE.includes(String(req.user?.perfil || '').toLowerCase())) {
            logger.warn('[filtrarPorEscola] perfil de equipe sem escola resolvida', {
                perfil: req.user?.perfil,
                action: 'tenant.semEscola',
            });
            return res.status(403).json({
                success: false,
                codigo: 'ESCOLA_NAO_RESOLVIDA',
                error: 'Sua conta não está vinculada a uma escola. Procure a administração do sistema.',
            });
        }

        return next();
    } catch (e) {
        // SEGURANÇA: falha FECHADA. Seguir sem req.escolaId fazia todos os
        // controllers (padrão `if (req.escolaId) query.escolaId = ...`)
        // simplesmente abandonarem o filtro e varrerem a rede inteira.
        logger.error('[filtrarPorEscola] não foi possível resolver a escola da sessão', {
            err: e,
            action: 'tenant.resolver',
        });
        try {
            const estado = await estadoEscolas();
            if (estado.total === 0) return next(); // pré-migração/testes: sem multi-tenant
        } catch (e2) {
            // Estado indisponível → trata como multi-tenant ativo (falha fechada).
            // Precisa aparecer: é o caminho que devolve 503 ao usuário.
            logger.warn(
                '[filtrarPorEscola] estado de escolas indisponível — assumindo multi-tenant ativo',
                {
                    err: e2,
                    action: 'tenant.resolver',
                }
            );
        }
        return res.status(503).json({
            success: false,
            error: 'Não foi possível determinar a escola desta sessão. Faça login novamente.',
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
module.exports.escolaIdDaConta = escolaIdDaConta;
module.exports.escolaMatch = escolaMatch;
