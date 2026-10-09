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
const { sanitizeObject, removerOperadoresMongoProfundo } = require('../../utils/sanitize');

/**
 * Parâmetros de ferramenta vêm do MODELO, não do corpo da requisição: não
 * passam pelo filtro global de app.js. O texto que uma ferramenta grava
 * (título e conteúdo de comunicado, evento, atividade…) ia cru para o banco e
 * daí para o mural e o sino de toda a escola — e o modelo pode ser conduzido
 * por injeção de prompt. Mesmo tratamento do filtro global (Issue #647).
 */
function limparParametros(parametros) {
    const limpos = parametros && typeof parametros === 'object' ? parametros : {};
    sanitizeObject(limpos);
    removerOperadoresMongoProfundo(limpos);
    return limpos;
}
const AuditLogger = require('./AuditLogger');
const { ferramentaPorId } = require('../ferramentas/catalogo');
const { checkToolPermission } = require('../ferramentas/permissaoFerramenta');

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
        throw new Error(
            `[IA] Ferramenta "${ferramenta.name}" declara mutates:true mas não implementa confirmar().`
        );
    }
    // Ação que depende de autorização da direção (Issue #727): a chave precisa
    // existir no catálogo, senão nunca liberaria ninguém.
    if (ferramenta.ferramentaControlada && !ferramentaPorId(ferramenta.ferramentaControlada)) {
        throw new Error(
            `[IA] Ferramenta "${ferramenta.name}" aponta para "${ferramenta.ferramentaControlada}", que não está no catálogo de ferramentas.`
        );
    }
    // Um parâmetro `escolaId` vindo do modelo seria um parâmetro vindo, em
    // última instância, do texto do usuário. O tenant NUNCA entra por aí.
    if (ferramenta.schema?.properties?.escolaId) {
        throw new Error(
            `[IA] Ferramenta "${ferramenta.name}" declara escolaId como parâmetro. O tenant vem sempre da sessão.`
        );
    }
}

/** Carrega tools/*.js uma vez, no primeiro uso. */
let catalogo = null;

function carregar() {
    if (catalogo) return catalogo;

    const mapa = new Map();
    let arquivos = [];
    try {
        arquivos = fs.readdirSync(DIRETORIO_FERRAMENTAS).filter((f) => f.endsWith('.js'));
    } catch (e) {
        logger.warn(
            '[IA] Diretório de ferramentas não encontrado — copiloto segue sem ferramentas.',
            {
                err: e,
                action: 'ia.registry',
            }
        );
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
    return ferramenta.cargosPermitidos.map((c) => c.toLowerCase()).includes(perfil);
}

/**
 * Declarações que serão enviadas ao modelo, já filtradas por cargo.
 *
 * @param {string} perfil
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.incluirMutates=false] Fase 4 liga isto
 * @param {Set<string>} [opcoes.bloqueadas] ferramentas do catálogo que a
 *   direção não autorizou para esta pessoa (ver `controladasBloqueadas`)
 * @returns {Array<{name, description, schema}>|null} null quando não há nenhuma
 */
function declaracoesPara(perfil, { incluirMutates = false, bloqueadas = null } = {}) {
    const p = String(perfil || '').toLowerCase();
    const lista = [...carregar().values()]
        .filter((f) => incluirMutates || !f.mutates)
        .filter((f) => cargoPode(f, p))
        .filter((f) => !(f.ferramentaControlada && bloqueadas?.has(f.ferramentaControlada)))
        .map((f) => ({ name: f.name, description: f.description, schema: f.schema }));

    return lista.length > 0 ? lista : null;
}

function usuarioDoContexto(ctx) {
    return { id: ctx.usuarioId, perfil: ctx.perfil };
}

/**
 * Ferramentas do catálogo de autorização (Issue #727) usadas por alguma ação
 * do assistente e que a direção NÃO liberou para quem está na sessão. Vai em
 * `declaracoesPara(..., { bloqueadas })`: o modelo nem recebe a ação.
 *
 * @returns {Promise<Set<string>>}
 */
async function controladasBloqueadas(ctx) {
    const controladas = new Set(
        [...carregar().values()].map((f) => f.ferramentaControlada).filter(Boolean)
    );
    const bloqueadas = new Set();
    for (const id of controladas) {
        const { liberado } = await checkToolPermission(usuarioDoContexto(ctx), ctx.escolaId, id);
        if (!liberado) bloqueadas.add(id);
    }
    return bloqueadas;
}

/** Barreira de autorização da direção para uma ação do assistente. */
async function exigirAutorizacao(ferramenta, ctx) {
    if (!ferramenta.ferramentaControlada) return;
    const { liberado } = await checkToolPermission(
        usuarioDoContexto(ctx),
        ctx.escolaId,
        ferramenta.ferramentaControlada
    );
    if (!liberado) {
        const nome = ferramentaPorId(ferramenta.ferramentaControlada).nome;
        throw new ErroPermissao(
            `A ferramenta "${nome}" precisa de autorização da direção para esta conta.`
        );
    }
}

/** Nomes disponíveis a um cargo — usado pela paleta de comandos (Fase 5). */
function nomesPara(perfil, opcoes) {
    return (declaracoesPara(perfil, opcoes) || []).map((f) => f.name);
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
async function executar(ferramentaNome, parametros, ctx) {
    const ferramenta = carregar().get(ferramentaNome);

    if (!ferramenta) {
        // Modelo alucinou um nome de ferramenta.
        logger.warn(`[IA] Modelo pediu ferramenta inexistente: "${ferramentaNome}"`, {
            action: 'ia.tool',
        });
        return {
            ok: false,
            erro: `A ferramenta "${ferramentaNome}" não existe. Responda usando apenas o que você já sabe.`,
        };
    }

    try {
        // SEGUNDA BARREIRA — revalida o cargo mesmo que a primeira já tenha
        // filtrado. É o que protege contra alucinação e contra um bug futuro
        // na montagem do catálogo.
        exigirCargo(ctx, ferramenta.cargosPermitidos, ferramenta.name);
        await exigirAutorizacao(ferramenta, ctx);

        const dados = await ferramenta.handler(limparParametros(parametros), ctx);

        // ── Escrita: o handler produziu só um PREVIEW ────────────────────────
        // Nada foi gravado. Emitimos um token e devolvemos o que SERÁ feito,
        // para o front renderizar o card de confirmação. A execução real só
        // acontece em POST /api/ia/confirmar.
        if (ferramenta.mutates) {
            const { confirmToken, expiraEm } = await ConfirmationStore.emitir(ctx, {
                ferramenta: ferramentaNome,
                parametros: dados.parametros,
                resumo: dados.resumo,
            });

            logger.info(`[IA] Ação "${ferramentaNome}" aguardando confirmação.`, {
                action: 'ia.tool',
                ferramenta: ferramentaNome,
                perfil: ctx.perfil,
            });

            return {
                ok: true,
                dados: {
                    requerConfirmacao: true,
                    confirmToken,
                    acao: ferramentaNome,
                    resumo: dados.resumo,
                    // O modelo recebe os dados para poder DESCREVER a ação em
                    // texto. Não são eles que serão executados — o servidor usa
                    // a cópia que guardou junto do token.
                    dados: dados.parametros,
                    expiraEm,
                },
            };
        }

        logger.info(`[IA] Ferramenta "${ferramentaNome}" executada.`, {
            action: 'ia.tool',
            ferramenta: ferramentaNome,
            perfil: ctx.perfil,
        });

        return { ok: true, dados };
    } catch (e) {
        if (e instanceof ErroPermissao || e.permissao) {
            logger.warn(`[IA] Ferramenta "${ferramentaNome}" recusada por permissão.`, {
                action: 'ia.tool',
                ferramenta: ferramentaNome,
                perfil: ctx.perfil,
            });
            return { ok: false, erro: e.message };
        }

        // Falha real: o detalhe fica no log, o modelo recebe algo genérico.
        logger.error(`[IA] Falha ao executar a ferramenta "${ferramentaNome}"`, {
            err: e,
            action: 'ia.tool',
            ferramenta: ferramentaNome,
        });
        return {
            ok: false,
            erro: 'Não consegui consultar essa informação agora. Avise a pessoa e sugira tentar novamente.',
        };
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
        // A direção pode revogar entre o preview e a confirmação.
        await exigirAutorizacao(ferramenta, ctx);

        // O preview já saiu de parâmetros limpos; limpa de novo porque o que
        // o handler devolve em `parametros` é o que fica guardado e executa.
        const dados = await ferramenta.confirmar(limparParametros(acao.parametros), ctx);

        await AuditLogger.registrarAcao(ctx, {
            ferramenta: acao.ferramenta,
            parametros: acao.parametros,
            resumo: acao.resumo,
            sucesso: true,
            recursoId: dados?.recursoId,
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
            erro: e.message,
        });

        if (dePermissao) return { ok: false, erro: e.message };

        logger.error(`[IA] Falha ao executar a ação confirmada "${acao.ferramenta}"`, {
            err: e,
            action: 'ia.confirmar',
            ferramenta: acao.ferramenta,
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
        allowedTurmas: req.allowedTurmas || [],
    };
}

/** Reinicia o catálogo — só para testes que registram ferramentas falsas. */
function _resetarCatalogo() {
    catalogo = null;
}

module.exports = {
    declaracoesPara,
    controladasBloqueadas,
    nomesPara,
    executar,
    executarConfirmada,
    construirContextoFerramenta,
    cargoPode,
    _resetarCatalogo,
};
