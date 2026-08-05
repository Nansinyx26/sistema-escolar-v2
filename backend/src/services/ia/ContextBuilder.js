'use strict';

/**
 * ContextBuilder.js — monta o contexto do usuário logado para o copiloto.
 *
 * FONTE DA VERDADE (não negociável)
 * ---------------------------------
 * Tudo aqui vem de `req.user` (JWT verificado pelo middleware authJWT) e de
 * `req.escolaId` (resolvido pelo middleware filtrarPorEscola). **Nada** vem do
 * corpo da requisição. Um cliente que enviasse `{ escolaId, perfil }` no body
 * não afeta uma linha deste arquivo — é essa separação que impede o copiloto
 * de virar um caminho lateral para ler dados de outra escola ou operar com um
 * cargo que o usuário não tem.
 *
 * NOTA SOBRE A ARQUITETURA DESTE REPOSITÓRIO
 * ------------------------------------------
 * A especificação original falava em `req.session.usuario`. Neste sistema a
 * autenticação é JWT em cookie HttpOnly (`req.user`) e a sessão guarda apenas
 * `escolaAtivaId`, consumido pelo `filtrarPorEscola` para produzir
 * `req.escolaId`. A intenção — identidade e tenant vêm do servidor, nunca do
 * cliente — está preservada; só muda o nome do lugar de onde se lê.
 */

const Escola = require('../../models/Escola');
const Config = require('../../models/Config');
const logger = require('../../utils/logger');
const { PERSONA_PROMPT_PREFIX } = require('../assistantPersona');

/**
 * Módulos que cada perfil enxerga no sistema.
 *
 * Este mapa é DESCRITIVO — serve para o modelo saber do que pode falar e para
 * onde orientar o usuário. Ele **não autoriza nada**: a autorização real segue
 * sendo o middleware `authorize` nas rotas e, a partir da Fase 2, o
 * `PermissionGuard` dentro de cada ferramenta.
 */
const MODULOS_POR_PERFIL = {
    admin: ['alunos', 'professores', 'turmas', 'notas', 'frequência', 'comunicados', 'calendário', 'relatórios', 'auditoria', 'configurações'],
    diretor: ['alunos', 'professores', 'turmas', 'notas', 'frequência', 'comunicados', 'calendário', 'relatórios', 'auditoria'],
    secretaria: ['alunos', 'professores', 'turmas', 'frequência', 'comunicados', 'calendário', 'relatórios'],
    professor: ['minhas turmas', 'notas', 'frequência', 'comunicados', 'calendário', 'grade horária'],
    responsavel: ['boletim do meu filho', 'frequência do meu filho', 'comunicados', 'calendário']
};

/** Como o assistente se dirige a cada perfil. */
const TRATAMENTO = {
    admin: 'administrador do sistema',
    diretor: 'diretor(a) da escola',
    secretaria: 'profissional da secretaria',
    professor: 'professor(a)',
    responsavel: 'responsável por aluno(s) da escola'
};

const MODELOS_POR_PERFIL = {
    professor: () => require('../../models/Professor'),
    diretor: () => require('../../models/Diretor'),
    secretaria: () => require('../../models/Secretaria')
};

/**
 * Busca o documento de equipe (Professor/Diretor/Secretaria) do usuário logado.
 * Mesmo par de chaves usado por `filtrarPorEscola.vinculosDoUsuario`, para não
 * criar uma segunda convenção de vínculo no sistema.
 */
async function documentoDaEquipe(user) {
    const carregar = MODELOS_POR_PERFIL[user.perfil];
    if (!carregar) return null;
    try {
        const Model = carregar();
        return await Model.findOne({
            $or: [{ idUsuario: String(user.id || user._id) }, { email: user.email }]
        }).lean();
    } catch (e) {
        // Contexto enriquecido é conveniência, não requisito: sem ele o copiloto
        // ainda responde, só com menos detalhe. Nunca derruba a conversa.
        logger.warn('[IA] Não foi possível carregar o vínculo do usuário para o contexto', {
            err: e, action: 'ia.contexto'
        });
        return null;
    }
}

/** Nome da escola ativa. Falha silenciosa: o contexto degrada, não quebra. */
async function dadosDaEscola(escolaId) {
    if (!escolaId) return null;
    try {
        const escola = await Escola.findById(escolaId).select('nome tipo municipio').lean();
        if (!escola) return null;
        return {
            id: String(escola._id),
            nome: escola.nome,
            tipo: escola.tipo,
            municipio: escola.municipio
        };
    } catch (e) {
        logger.warn('[IA] Não foi possível carregar a escola do contexto', {
            err: e, action: 'ia.contexto'
        });
        return null;
    }
}

/** Ano letivo e matérias configuradas — dão precisão às respostas pedagógicas. */
async function configuracaoAcademica() {
    try {
        const cfg = await Config.findOne().select('anoLetivo materias mediaAprovacao frequenciaMinima').lean();
        if (!cfg) return null;
        return {
            anoLetivo: cfg.anoLetivo,
            materias: (cfg.materias || []).map(m => m.nome).filter(Boolean),
            mediaAprovacao: cfg.mediaAprovacao,
            frequenciaMinima: cfg.frequenciaMinima
        };
    } catch (e) {
        logger.warn('[IA] Não foi possível carregar a configuração acadêmica', {
            err: e, action: 'ia.contexto'
        });
        return null;
    }
}

/**
 * Monta o contexto completo do usuário para esta requisição.
 *
 * @param {import('express').Request} req  requisição JÁ passada por authJWT + filtrarPorEscola
 * @returns {Promise<Object>} contexto neutro, seguro para virar prompt
 */
async function construirContexto(req) {
    const user = req.user || {};
    // ÚNICA origem do tenant. Repetido aqui de propósito: é o invariante que
    // sustenta todo o isolamento multi-escola do copiloto.
    const escolaId = req.escolaId ? String(req.escolaId) : null;

    const perfil = String(user.perfil || '').toLowerCase();

    const [escola, equipe, academico] = await Promise.all([
        dadosDaEscola(escolaId),
        documentoDaEquipe({ ...user, perfil }),
        configuracaoAcademica()
    ]);

    // Turmas do professor: `turmas` é o campo unificado; salaPrincipal +
    // salasAdicionais são a origem histórica e cobrem registros antigos.
    let turmas = [];
    let disciplinas = [];
    if (perfil === 'professor' && equipe) {
        const brutas = [
            ...(equipe.turmas || []),
            equipe.salaPrincipal,
            ...(equipe.salasAdicionais || [])
        ].filter(Boolean).map(String);
        turmas = [...new Set(brutas)];
        disciplinas = [...new Set([...(equipe.materias || []), equipe.disciplina].filter(Boolean))];
    }

    return {
        usuario: {
            id: String(user.id || user._id || ''),
            nome: user.nome || 'usuário',
            email: user.email || null,
            perfil,
            tratamento: TRATAMENTO[perfil] || 'usuário do sistema'
        },
        escola,
        escolaId,
        turmas,
        disciplinas,
        academico,
        modulos: MODULOS_POR_PERFIL[perfil] || [],
        agora: new Date().toISOString(),
        // Preenchido pelo controller: muda as instruções entre "consulte os
        // dados" e "você não tem acesso a dados".
        temFerramentas: false
    };
}

/** "2026-07-28" → "28 de julho de 2026" */
function dataPorExtenso(iso) {
    const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
        'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

/**
 * Transforma o contexto no `system prompt` enviado ao modelo.
 *
 * O prefixo de persona vem de `assistantPersona.js`, o mesmo usado pelo chatbot
 * legado e pelo modo offline — assim o copiloto não inventa um segundo tom de
 * voz para a mesma escola. As instruções de comprimento da persona (1 a 3
 * frases) são deliberadamente relaxadas aqui: o copiloto responde em Markdown
 * estruturado, não em bolha curta de chat.
 *
 * @param {Object} ctx  saída de `construirContexto`
 * @returns {string}
 */
function montarSystemPrompt(ctx) {
    const linhas = [];

    linhas.push(PERSONA_PROMPT_PREFIX);
    linhas.push('');
    linhas.push('CONTEXTO DESTA CONVERSA (dados verificados pelo servidor — confie neles):');
    linhas.push(`- Você está falando com ${ctx.usuario.nome}, ${ctx.usuario.tratamento}.`);

    if (ctx.escola) {
        const local = ctx.escola.municipio ? `, em ${ctx.escola.municipio}` : '';
        linhas.push(`- Escola: ${ctx.escola.nome}${ctx.escola.tipo ? ` (${ctx.escola.tipo})` : ''}${local}.`);
    } else {
        linhas.push('- A escola desta sessão ainda não está definida. Se a pergunta depender de dados da escola, peça que a pessoa selecione a escola no sistema.');
    }

    linhas.push(`- Data de hoje: ${dataPorExtenso(ctx.agora)}.`);

    if (ctx.academico?.anoLetivo) {
        linhas.push(`- Ano letivo em curso: ${ctx.academico.anoLetivo}.`);
    }
    if (ctx.academico?.mediaAprovacao != null) {
        linhas.push(`- Média para aprovação: ${ctx.academico.mediaAprovacao}. Frequência mínima: ${ctx.academico.frequenciaMinima ?? '—'}%.`);
    }
    if (ctx.turmas.length > 0) {
        linhas.push(`- Turmas sob responsabilidade desta pessoa: ${ctx.turmas.join(', ')}.`);
    }
    if (ctx.disciplinas.length > 0) {
        linhas.push(`- Disciplinas que leciona: ${ctx.disciplinas.join(', ')}.`);
    }
    if (ctx.modulos.length > 0) {
        linhas.push(`- Módulos do sistema disponíveis para este perfil: ${ctx.modulos.join(', ')}.`);
    }

    linhas.push('');
    linhas.push('COMO RESPONDER:');
    linhas.push('- Trate a pessoa pelo primeiro nome quando fizer sentido; você já sabe quem ela é, não pergunte.');
    linhas.push('- Use Markdown: títulos, listas, tabelas e blocos de código quando ajudarem a leitura. Prefira uma tabela a um parágrafo com muitos números.');
    linhas.push('- Respostas objetivas. Sem introduções longas nem repetir a pergunta.');
    linhas.push('- Você também responde perguntas gerais de educação, pedagogia e tecnologia, mesmo que não sejam sobre esta escola.');
    linhas.push('');

    if (ctx.temFerramentas) {
        linhas.push('CONSULTA DE DADOS (ferramentas):');
        linhas.push('- Você tem ferramentas para consultar os dados REAIS desta escola. Sempre que a pergunta envolver um número, nome, data ou lista concreta, CHAME a ferramenta correspondente em vez de responder de memória.');
        linhas.push('- Para qualquer consulta sobre um aluno citado pelo nome, chame `buscarAluno` primeiro para obter o `alunoId`, e só então a ferramenta de notas ou frequência.');
        linhas.push('- Se uma ferramenta devolver `ok: false`, o campo `erro` explica o motivo. Repasse esse motivo à pessoa com cordialidade e NÃO tente contornar a recusa por outro caminho.');
        linhas.push('- Responda usando SOMENTE o que a ferramenta devolveu. Se o dado não veio, diga que não encontrou — nunca preencha a lacuna com uma estimativa.');
        linhas.push('- Dados estruturados (listas de alunos, turmas, notas) ficam melhor como tabela Markdown.');
    } else {
        linhas.push('LIMITE DE DADOS:');
        linhas.push('- Você NÃO tem acesso aos dados do banco desta escola neste momento. Se pedirem números concretos, diga com franqueza que essa consulta não está disponível e oriente o caminho no sistema. NUNCA invente um número, nome ou data.');
    }

    linhas.push('');
    linhas.push('LIMITES (obrigatórios):');
    linhas.push(`- Fale apenas da escola desta sessão${ctx.escola ? ` (${ctx.escola.nome})` : ''}. Se pedirem dados de outra escola, recuse com cordialidade.`);
    linhas.push('- Nunca invente nomes, notas, faltas, datas ou turmas.');

    if (ctx.usuario.perfil === 'responsavel') {
        linhas.push('- Esta pessoa é responsável por aluno(s). Ela pode falar apenas sobre os próprios filhos — nunca sobre outros alunos, turmas inteiras, professores ou gestão da escola.');
    }
    if (ctx.usuario.perfil === 'professor') {
        linhas.push('- Esta pessoa é docente. Ela acessa as próprias turmas e disciplinas — nunca dados administrativos da rede nem de turmas de outros professores.');
    }

    return linhas.join('\n');
}

module.exports = {
    construirContexto,
    montarSystemPrompt,
    MODULOS_POR_PERFIL,
    // exportados para teste
    dataPorExtenso
};
