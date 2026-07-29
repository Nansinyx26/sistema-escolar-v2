'use strict';

/**
 * ToolRegistry.js — catálogo de ferramentas do copiloto.
 *
 * PRIMEIRA barreira de autorização: filtra por cargo ANTES de declarar as
 * ferramentas ao modelo. O modelo nem fica sabendo que `listarProfessores`
 * existe quando conversa com um responsável — o que, além de seguro, evita a
 * frustração de ele prometer uma consulta que seria recusada depois.
 *
 * A SEGUNDA barreira (`PermissionGuard`, dentro de cada handler) revalida tudo.
 * Ver o cabeçalho daquele arquivo para o porquê de existirem duas.
 *
 * CONTRATO DE UMA FERRAMENTA (tools/*.js)
 *   name              string   — identificador enviado ao modelo
 *   description       string   — quando usar; é o que guia a escolha do modelo
 *   schema            object   — JSON Schema dos parâmetros (NUNCA inclui escolaId)
 *   cargosPermitidos  string[] — perfis que podem chamá-la
 *   mutates           boolean  — true exige confirmação (Fase 4)
 *   handler(params, ctx)       — executa; recebe o contexto do servidor
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const { ErroPermissao, exigirCargo } = require('./PermissionGuard');
const ConfirmationStore = require('./ConfirmationStore');
const AuditLogger = require('./AuditLogger');

const DIRETORIO_FERRAMENTAS = path.join(__dirname, 'tools');

/** Campos obrigatórios na declaração. Erro aqui é de programação, não de runtime. */
const CAMPOS = ['name', 'description', 'schema', 'cargosPermitidos', 'mutates', 'handler'];

function validarFerramenta(ferramenta, arquivo) {
    for (const campo of CAMPOS) {
        if (ferramenta[campo] === undefined) {
            throw new Error(`[IA] Ferramenta em ${arquivo} não declara "${campo}".`);
        }
    }
    if (typeof ferramenta.handler !== 'function') {
        throw new Error(`[IA] Ferramenta "${ferramenta.name}" tem handler que não é função.`);
    }
    if (!Array.isArray(ferramenta.cargosPermitidos) || ferramenta.cargosPermitidos.length === 0) {
        throw new Error(`[IA] Ferramenta "${ferramenta.name}" precisa declarar ao menos um cargo.`);
    }
    // Uma ferramenta de escrita sem `confirmar` executaria no `handler`, ou
    // seja, sem confirmação nenhuma. Falhar no carregamento é o único momento
    // em que isso é barato de corrigir.
    if (ferramenta.mutates && typeof ferramenta.confirmar !== 'function') {
        throw new Error(`[IA] Ferramenta "${ferramenta.name}" declara mutates:true mas não implementa confirmar().`);
    }
    // Um parâmetro `escolaId` vindo do modelo seria um parâmetro vindo, em
    // última instância, do texto do usuário. O tenant NUNCA entra por aí.
    if (ferramenta.schema?.properties?.escolaId) {
        throw new Error(`[IA] Ferramenta "${ferramenta.name}" declara escolaId como parâmetro. O tenant vem sempre da sessão.`);
    }
}

/** Carrega tools/*.js uma vez, no primeiro uso. */
let catalogo = null;

function carregar() {
    if (catalogo) return catalogo;

    const mapa = new Map();
    let arquivos = [];
    try {
        arquivos = fs.readdirSync(DIRETORIO_FERRAMENTAS).filter(f => f.endsWith('.js'));
    } catch (e) {
        logger.warn('[IA] Diretório de ferramentas não encontrado — copiloto segue sem ferramentas.', {
            err: e, action: 'ia.registry'
        });
        catalogo = mapa;
        return catalogo;
    }

    for (const arquivo of arquivos) {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const ferramenta = require(path.join(DIRETORIO_FERRAMENTAS, arquivo));
        validarFerramenta(ferramenta, arquivo);
        if (mapa.has(ferramenta.name)) {
            throw new Error(`[IA] Ferramenta duplicada: "${ferramenta.name}".`);
        }
        mapa.set(ferramenta.name, ferramenta);
    }

    logger.info(`[IA] ${mapa.size} ferramentas registradas.`, { action: 'ia.registry' });
    catalogo = mapa;
    return catalogo;
}

/** true se o cargo pode usar a ferramenta. `admin` passa sempre. */
function cargoPode(ferramenta, perfil) {
    if (perfil === 'admin') return true;
    return ferramenta.cargosPermitidos.map(c => c.toLowerCase()).includes(perfil);
}

/**
 * Declarações que serão enviadas ao modelo, já filtradas por cargo.
 *
 * @param {string} perfil
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.incluirMutates=false] Fase 4 liga isto
 * @returns {Array<{name, description, schema}>|null} null quando não há nenhuma
 */
function declaracoesPara(perfil, { incluirMutates = false } = {}) {
    const p = String(perfil || '').toLowerCase();
    const lista = [...carregar().values()]
        .filter(f => incluirMutates || !f.mutates)
        .filter(f => cargoPode(f, p))
        .map(f => ({ name: f.name, description: f.description, schema: f.schema }));

    return lista.length > 0 ? lista : null;
}

/** Nomes disponíveis a um cargo — usado pela paleta de comandos (Fase 5). */
function nomesPara(perfil, opcoes) {
    return (declaracoesPara(perfil, opcoes) || []).map(f => f.name);
}

/**
 * Executa uma ferramenta pedida pelo modelo.
 *
 * NUNCA lança: o resultado sempre volta como dado para o modelo, inclusive nas
 * recusas. Uma exceção aqui abortaria o streaming inteiro e o usuário veria um
 * erro genérico em vez de "você não tem acesso a isso" — que é justamente a
 * "recusa educada" que o sistema deve dar.
 *
 * @returns {Promise<{ok: boolean, dados?: any, erro?: string}>}
 */
async function executar(nome, parametros, ctx) {
    const ferramenta = carregar().get(nome);

    if (!ferramenta) {
        // Modelo alucinou um nome de ferramenta.
        logger.warn(`[IA] Modelo pediu ferramenta inexistente: "${nome}"`, { action: 'ia.tool' });
        return { ok: false, erro: `A ferramenta "${nome}" não existe. Responda usando apenas o que você já sabe.` };
    }

    try {
        // SEGUNDA BARREIRA — revalida o cargo mesmo que a primeira já tenha
        // filtrado. É o que protege contra alucinação e contra um bug futuro
        // na montagem do catálogo.
        exigirCargo(ctx, ferramenta.cargosPermitidos, ferramenta.name);

        const dados = await ferramenta.handler(parametros || {}, ctx);

        // ── Escrita: o handler produziu só um PREVIEW ────────────────────────
        // Nada foi gravado. Emitimos um token e devolvemos o que SERÁ feito,
        // para o front renderizar o card de confirmação. A execução real só
        // acontece em POST /api/ia/confirmar.
        if (ferramenta.mutates) {
            const { confirmToken, expiraEm } = await ConfirmationStore.emitir(ctx, {
                ferramenta: nome,
                parametros: dados.parametros,
                resumo: dados.resumo
            });

            logger.info(`[IA] Ação "${nome}" aguardando confirmação.`, {
                action: 'ia.tool', ferramenta: nome, perfil: ctx.perfil
            });

            return {
                ok: true,
                dados: {
                    requerConfirmacao: true,
                    confirmToken,
                    acao: nome,
                    resumo: dados.resumo,
                    // O modelo recebe os dados para poder DESCREVER a ação em
                    // texto. Não são eles que serão executados — o servidor usa
                    // a cópia que guardou junto do token.
                    dados: dados.parametros,
                    expiraEm
                }
            };
        }

        logger.info(`[IA] Ferramenta "${nome}" executada.`, {
            action: 'ia.tool', ferramenta: nome, perfil: ctx.perfil
        });

        return { ok: true, dados };
    } catch (e) {
        if (e instanceof ErroPermissao || e.permissao) {
            logger.warn(`[IA] Ferramenta "${nome}" recusada por permissão.`, {
                action: 'ia.tool', ferramenta: nome, perfil: ctx.perfil
            });
            return { ok: false, erro: e.message };
        }

        // Falha real: o detalhe fica no log, o modelo recebe algo genérico.
        logger.error(`[IA] Falha ao executar a ferramenta "${nome}"`, {
            err: e, action: 'ia.tool', ferramenta: nome
        });
        return { ok: false, erro: 'Não consegui consultar essa informação agora. Avise a pessoa e sugira tentar novamente.' };
    }
}

/**
 * Executa de fato uma ação previamente confirmada.
 *
 * Chamado SÓ pelo endpoint de confirmação, depois de o ConfirmationStore ter
 * validado e consumido o token. Os `parametros` vêm do banco — não do cliente.
 *
 * @param {Object} acao  documento devolvido por ConfirmationStore.consumir
 * @param {Object} ctx   contexto de ferramenta desta requisição
 * @returns {Promise<{ok: boolean, dados?: any, erro?: string}>}
 */
async function executarConfirmada(acao, ctx) {
    const ferramenta = carregar().get(acao.ferramenta);

    if (!ferramenta || !ferramenta.mutates) {
        return { ok: false, erro: 'Esta ação não pode mais ser executada.' };
    }

    try {
        // TERCEIRA checagem de cargo (catálogo → preview → aqui). Entre o
        // pedido e a confirmação passam até 5 minutos, tempo de sobra para um
        // rebaixamento de privilégio entrar em vigor.
        exigirCargo(ctx, ferramenta.cargosPermitidos, ferramenta.name);

        const dados = await ferramenta.confirmar(acao.parametros, ctx);

        await AuditLogger.registrarAcao(ctx, {
            ferramenta: acao.ferramenta,
            parametros: acao.parametros,
            resumo: acao.resumo,
            sucesso: true,
            recursoId: dados?.recursoId
        });

        return { ok: true, dados };
    } catch (e) {
        const dePermissao = e instanceof ErroPermissao || e.permissao;

        // A tentativa FALHA também vai para a trilha: numa apuração de abuso é
        // justamente ela que interessa.
        await AuditLogger.registrarAcao(ctx, {
            ferramenta: acao.ferramenta,
            parametros: acao.parametros,
            resumo: acao.resumo,
            sucesso: false,
            erro: e.message
        });

        if (dePermissao) return { ok: false, erro: e.message };

        logger.error(`[IA] Falha ao executar a ação confirmada "${acao.ferramenta}"`, {
            err: e, action: 'ia.confirmar', ferramenta: acao.ferramenta
        });
        return { ok: false, erro: 'Não consegui concluir a ação. Nada foi alterado.' };
    }
}

/**
 * Monta o contexto entregue aos handlers.
 *
 * Tudo vem do SERVIDOR: `req.user` (JWT verificado), `req.escolaId`
 * (filtrarPorEscola) e `req.allowedTurmas` (horizontalFilter). O `req` viaja
 * junto porque `exigirAcessoAoAluno` delega ao guard de rota já existente.
 */
function construirContextoFerramenta(req) {
    return {
        req,
        usuarioId: String(req.user?.id || req.user?._id || ''),
        nome: req.user?.nome || '',
        email: req.user?.email || '',
        perfil: String(req.user?.perfil || '').toLowerCase(),
        escolaId: req.escolaId ? String(req.escolaId) : null,
        allowedTurmas: req.allowedTurmas || []
    };
}

/** Reinicia o catálogo — só para testes que registram ferramentas falsas. */
function _resetarCatalogo() {
    catalogo = null;
}

module.exports = {
    declaracoesPara,
    nomesPara,
    executar,
    executarConfirmada,
    construirContextoFerramenta,
    cargoPode,
    _resetarCatalogo
};
