'use strict';

/**
 * PermissionGuard.js — SEGUNDA barreira de autorização das ferramentas.
 *
 * POR QUE DUAS BARREIRAS
 * ----------------------
 * A primeira é o `ToolRegistry`, que só declara ao modelo as ferramentas
 * permitidas ao cargo. Ela evita que o modelo sequer saiba que `listarProfessores`
 * existe quando fala com um responsável.
 *
 * Mas isso é uma barreira de INTENÇÃO, não de execução: um modelo pode alucinar
 * uma chamada para uma ferramenta que não lhe foi oferecida, e um bug futuro na
 * montagem do registro pode declarar demais. Por isso todo handler revalida
 * cargo + escola AQUI, imediatamente antes de tocar no banco. Se a primeira
 * barreira falhar, esta segura.
 *
 * REUSO, NÃO DUPLICAÇÃO
 * ---------------------
 * A regra de "quem pode ver qual aluno" já existe e é sofisticada
 * (`middleware/assertAcessoAoAluno`), assim como o filtro de tenant
 * (`middleware/filtrarPorEscola.escolaMatch`) e o de turmas do professor
 * (`middleware/horizontalFilter` → `req.allowedTurmas`). Este arquivo não
 * reimplementa nenhuma delas: só as aplica no contexto das ferramentas.
 */

const { escolaMatch } = require('../../middleware/filtrarPorEscola');
const { assertAcessoAoAluno } = require('../../middleware/assertAcessoAoAluno');

/**
 * Erro de autorização dentro de uma ferramenta.
 *
 * A `mensagem` é escrita para ser LIDA PELO MODELO e repassada ao usuário, por
 * isso é cordial e explica o limite sem detalhar a regra interna. O modelo é
 * instruído a não contornar a recusa.
 */
class ErroPermissao extends Error {
    constructor(mensagem) {
        super(mensagem);
        this.name = 'ErroPermissao';
        this.permissao = true;
    }
}

/** Perfis com visão administrativa da escola inteira. */
const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

/**
 * Confere se o cargo do usuário está na lista da ferramenta.
 * `admin` passa sempre — mesma convenção do middleware `authorize`.
 */
function exigirCargo(ctx, cargosPermitidos, nomeFerramenta) {
    const perfil = ctx.perfil;
    if (perfil === 'admin') return;

    const permitidos = (cargosPermitidos || []).map(c => String(c).toLowerCase());
    if (permitidos.includes(perfil)) return;

    throw new ErroPermissao(
        `O perfil "${perfil}" não tem acesso a esta informação (${nomeFerramenta}). ` +
        'Explique isso à pessoa com cordialidade e ofereça ajuda com o que ela pode ver.'
    );
}

/**
 * Garante que existe uma escola resolvida e devolve o filtro Mongo dela.
 *
 * FALHA FECHADA de propósito: sem `escolaId` NÃO devolvemos filtro vazio.
 * Um filtro vazio faria a consulta varrer a rede inteira — exatamente o
 * vazamento entre escolas que o sistema inteiro trabalha para evitar.
 *
 * @returns {Object} filtro Mongo já escopado à escola da sessão
 */
function filtroDaEscola(ctx) {
    if (!ctx.escolaId) {
        throw new ErroPermissao(
            'A escola desta sessão não está definida, então não posso consultar dados. ' +
            'Peça que a pessoa selecione a escola no sistema e tente de novo.'
        );
    }
    return escolaMatch(ctx.escolaId);
}

/**
 * Turmas que um professor pode enxergar (vem do `horizontalFilter`).
 * Para gestão devolve `null`, que significa "sem restrição de turma".
 */
function turmasPermitidas(ctx) {
    if (PERFIS_GESTAO.includes(ctx.perfil)) return null;

    if (ctx.perfil === 'professor') {
        const turmas = ctx.allowedTurmas || [];
        if (turmas.length === 0) {
            throw new ErroPermissao(
                'Não encontrei turmas atribuídas a este professor no sistema. ' +
                'Sugira que ele procure a direção para verificar a atribuição.'
            );
        }
        return turmas;
    }

    throw new ErroPermissao(
        `O perfil "${ctx.perfil}" não tem acesso a dados de turma.`
    );
}

/**
 * Aplica o recorte de turma ao filtro, quando o perfil exigir.
 * `campo` cobre os dois nomes usados no banco (`turma` em Falta/Aluno,
 * `turmaId` em Nota).
 */
function restringirPorTurma(filtro, ctx, campos = ['turma', 'turmaId']) {
    const permitidas = turmasPermitidas(ctx);
    if (permitidas === null) return filtro;

    return {
        ...filtro,
        $and: [
            ...(filtro.$and || []),
            { $or: campos.map(c => ({ [c]: { $in: permitidas } })) }
        ]
    };
}

/**
 * Revalida o acesso a um aluno específico delegando ao guard já existente do
 * sistema — o MESMO usado pelas rotas HTTP. Assim o copiloto não pode virar
 * uma porta lateral mais frouxa que a porta da frente.
 *
 * @returns {Promise<Object>} documento do aluno autorizado
 */
async function exigirAcessoAoAluno(ctx, alunoId) {
    const resultado = await assertAcessoAoAluno(ctx.req, alunoId);
    if (!resultado.ok) {
        throw new ErroPermissao(
            `${resultado.error} Explique o limite à pessoa com cordialidade e não tente outra consulta sobre este aluno.`
        );
    }
    return resultado.aluno;
}

/** Um responsável só enxerga os próprios filhos. */
function ehResponsavel(ctx) {
    return ctx.perfil === 'responsavel';
}

function ehGestao(ctx) {
    return PERFIS_GESTAO.includes(ctx.perfil);
}

module.exports = {
    ErroPermissao,
    PERFIS_GESTAO,
    exigirCargo,
    filtroDaEscola,
    turmasPermitidas,
    restringirPorTurma,
    exigirAcessoAoAluno,
    ehResponsavel,
    ehGestao
};
