'use strict';

const Aluno        = require('../models/Aluno');
const Nota         = require('../models/Nota');
const Falta        = require('../models/Falta');
const Professor    = require('../models/Professor');
const Comunicado   = require('../models/Comunicado');
const GradeHoraria = require('../models/GradeHoraria');
const ChatMensagem = require('../models/ChatMensagem');
const voiceService = require('../services/voiceService');
const logger       = require('../utils/logger');

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize text: remove accents (NFD decomposition) and lowercase.
 * Used for accent-insensitive name comparison (Layer 1, Rule 1).
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
    if (!text) return '';
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Validate buttons: every button must have a 1:1 correspondence with a DB query result.
 * Discards any button whose value does not match an _id from the matches array.
 * (Layer 1, Rule 3 — validation step)
 * @param {Array} buttons  Array of { label, value }
 * @param {Array} matches  Array of DB documents with _id
 * @returns {Array} Validated buttons only
 */
function validateButtons(buttons, matches) {
    if (!buttons || !matches) return [];
    const validIds = new Set(matches.map(m => String(m._id)));
    return buttons.filter(b => b.value && validIds.has(String(b.value)));
}

/**
 * Classify the user's intent from a normalised (lowercase) message.
 * @param {string} message
 * @returns {string} Intent token
 */
function classifyIntent(message) {
    const normalized = message.toLowerCase();

    // ── Data intents (require DB queries) ──────────────────────────────────
    const dataIntentMap = [
        { intent: 'NOTAS',        keywords: ['nota', 'média', 'boletim', 'tirou', 'rendimento', 'desempenho'] },
        { intent: 'FALTAS',       keywords: ['falta', 'presença', 'frequência', 'veio', 'presente', 'ausente'] },
        { intent: 'COMUNICADOS',  keywords: ['comunicado', 'aviso', 'reunião', 'mural'] },
        { intent: 'TURMA_GERAL',  keywords: ['turma', 'alunos', 'sala'] },
        { intent: 'HORARIO',      keywords: ['horário', 'aula', 'grade'] },
        { intent: 'PROFESSORES',  keywords: ['professor', 'leciona', 'ensina'] },
        { intent: 'RESUMO_GERAL', keywords: ['como está', 'resumo', 'situação'] },
    ];

    for (const { intent, keywords } of dataIntentMap) {
        for (const keyword of keywords) {
            if (normalized.includes(keyword)) {
                return intent;
            }
        }
    }

    // ── Conversational intents (no DB needed) ─────────────────────────────
    const conversationalIntentMap = [
        { intent: 'SAUDACAO',      keywords: ['olá', 'ola', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'e aí', 'eai', 'hey', 'hello', 'tudo bem'] },
        { intent: 'AGRADECIMENTO', keywords: ['obrigado', 'obrigada', 'valeu', 'agradeço', 'thanks', 'brigado', 'brigada'] },
        { intent: 'DESPEDIDA',     keywords: ['tchau', 'até mais', 'ate mais', 'até logo', 'adeus', 'bye', 'flw', 'falou'] },
        { intent: 'SOBRE_SISTEMA', keywords: ['o que você faz', 'o que voce faz', 'como funciona', 'me ajuda', 'ajuda', 'help', 'o que pode', 'quais funções', 'quais funcoes'] },
        { intent: 'ELOGIO',        keywords: ['parabéns', 'parabens', 'muito bom', 'excelente', 'adorei', 'amei', 'incrível', 'incrivel', 'top', 'maravilhoso'] },
        { intent: 'RECLAMACAO',    keywords: ['reclamação', 'reclamacao', 'não funciona', 'nao funciona', 'problema', 'erro', 'bug', 'ruim', 'péssimo', 'pessimo', 'horrível', 'horrivel'] },
    ];

    for (const { intent, keywords } of conversationalIntentMap) {
        for (const keyword of keywords) {
            if (normalized.includes(keyword)) {
                return intent;
            }
        }
    }

    // ── Catch-all ──────────────────────────────────────────────────────────
    return 'INDEFINIDA';
}

/**
 * Check if an intent is conversational (does NOT require DB queries).
 * @param {string} intent
 * @returns {boolean}
 */
function isConversationalIntent(intent) {
    const NO_DATA_INTENTS = [
        'SAUDACAO', 'AGRADECIMENTO', 'DESPEDIDA',
        'SOBRE_SISTEMA', 'ELOGIO', 'RECLAMACAO',
        'FORA_CONTEXTO', 'INDEFINIDA',
    ];
    return NO_DATA_INTENTS.includes(intent);
}

/**
 * Get a fixed fallback response for conversational intents when Gemini is unavailable.
 * @param {string} intent
 * @returns {string}
 */
function getConversationalFallback(intent) {
    const fallbacks = {
        SAUDACAO:      'Olá! 😊 Sou o assistente da escola. Posso ajudar com notas, faltas, horários, professores e comunicados. O que deseja saber?',
        AGRADECIMENTO: 'Por nada! Fico feliz em ajudar. Se precisar de mais alguma coisa, é só perguntar.',
        DESPEDIDA:     'Até mais! Se precisar, estarei por aqui. 👋',
        SOBRE_SISTEMA: 'Sou o assistente virtual da escola! Posso ajudar com: notas, faltas, horários, professores e comunicados. Tente por exemplo: "Notas do João Silva" ou "Comunicados".',
        ELOGIO:        'Muito obrigado! Fico feliz que esteja gostando. Se precisar de algo mais, estou à disposição!',
        RECLAMACAO:    'Peço desculpas pelo inconveniente. Posso tentar ajudar de outra forma. Tente me perguntar sobre notas, faltas, horários, professores ou comunicados.',
        FORA_CONTEXTO: 'Não encontrei uma resposta exata para essa pergunta, mas posso ajudar com informações relacionadas. Você pode tentar perguntar de outra forma ou escolher um dos temas abaixo:',
        INDEFINIDA:    'Não encontrei uma resposta exata para essa pergunta, mas posso ajudar com informações relacionadas. Você pode tentar perguntar de outra forma ou escolher um dos temas abaixo:',
    };
    return fallbacks[intent] || fallbacks.INDEFINIDA;
}

// Sugestões de navegação retornadas junto com fallback INDEFINIDA/FORA_CONTEXTO
const CONVERSATIONAL_SUGGESTIONS = [
    { label: '📝 Notas e desempenho', alunoId: null },
    { label: '📅 Faltas e frequência', alunoId: null },
    { label: '📢 Comunicados recentes', alunoId: null },
    { label: '🕐 Grade horária', alunoId: null },
    { label: '👨‍🏫 Professores da turma', alunoId: null },
];

/**
 * Build the Gemini prompt for conversational (non-DB) messages.
 * This is a dedicated system prompt for greetings, thanks, off-topic, etc.
 *
 * @param {Object} params
 * @param {string} params.perfil        User profile (diretor|coordenador|professor|responsavel|desconhecido)
 * @param {string} [params.nomeUsuario] User name (if available)
 * @param {string} params.message       Original user message
 * @returns {string} Formatted prompt
 */
function buildConversationalPrompt({ perfil, nomeUsuario, message }) {
    return `Você é o assistente virtual de uma escola, integrado a um sistema de gestão escolar.

CONTEXTO:
O usuário enviou uma mensagem que NÃO requer consulta ao banco de dados (não é sobre notas, 
faltas, horários, professores ou comunicados de um aluno/turma específico). Pode ser uma 
saudação, agradecimento, despedida, pergunta sobre o que você faz, um elogio, uma reclamação, 
uma pergunta fora do contexto escolar, ou uma mensagem que você não conseguiu classificar.

SEU PAPEL:
- Responder de forma humana, calorosa e natural, como um atendente simpático da escola.
- Manter respostas curtas (1 a 3 frases). Nada de parágrafos longos.
- Sempre que fizer sentido, lembrar o usuário do que você PODE ajudar: notas, faltas, 
  horários, professores e comunicados — adaptado ao perfil dele, se souber 
  (diretor/coordenador, professor ou responsável).
- Se a mensagem for sobre um assunto totalmente fora do escopo escolar (clima, piadas, 
  notícias, etc.), recuse com simpatia e redirecione para o que você pode ajudar.
- Se for uma reclamação ou confusão, peça desculpas brevemente e ofereça ajuda novamente.
- Nunca invente dados de aluno, nota, falta ou horário. Você não tem acesso ao banco de 
  dados nesta conversa — se o usuário pedir uma informação específica de aluno/turma, 
  oriente-o a perguntar de forma direta (ex: "Notas do João Silva") para que o sistema 
  busque os dados.
- Use emojis com moderação (0 a 1 por resposta), apenas quando o tom permitir.
- Nunca use o nome "Gemini" ou mencione que é uma IA do Google. Você é "o assistente da escola".

DADOS DISPONÍVEIS NESTA CHAMADA:
- Perfil do usuário: ${perfil}
- Nome do usuário (se houver): ${nomeUsuario || 'não informado'}
- Mensagem do usuário: ${message}

TAREFA:
Gere uma resposta curta, natural e adequada ao perfil do usuário, em português do Brasil.`;
}

/**
 * Detect bimestre number mentioned in the message.
 * @param {string} message
 * @returns {number|null}
 */
function detectBimestre(message) {
    const regex = /(\d+|primeiro|segundo|terceiro|quarto|um|dois|tr[eê]s|quatro)[°º]?\s*bim(estre)?/i;
    const match = message.match(regex);
    if (!match) return null;

    const token = match[1].toLowerCase();
    const bimestreMap = {
        '1': 1, 'um': 1, 'primeiro': 1,
        '2': 2, 'dois': 2, 'segundo': 2,
        '3': 3, 'três': 3, 'tres': 3, 'terceiro': 3,
        '4': 4, 'quatro': 4, 'quarto': 4,
    };

    return bimestreMap[token] || null;
}

/**
 * Detect a school subject mentioned in the message.
 * @param {string} message
 * @returns {string|null}
 */
const MATERIAS_CONHECIDAS = [
    'matemática', 'português', 'história', 'geografia', 'ciências',
    'física', 'química', 'biologia', 'inglês', 'artes', 'educação física',
];

function detectMateria(message) {
    const normalized = message.toLowerCase();
    for (const materia of MATERIAS_CONHECIDAS) {
        if (normalized.includes(materia)) {
            return materia;
        }
    }
    return null;
}

/**
 * Build RBAC filter object for DB queries based on the authenticated user.
 * @param {Object} params
 * @param {string} params.perfil
 * @param {string} params.userId
 * @param {string} [params.userEmail]
 * @returns {Promise<{ alunoFilter: Object, turmasAutorizadas: string[]|null, professorDoc: Object|null, alunosVinculados?: Object[] }>}
 */
async function enforceRBAC({ perfil, userId, userEmail }) {
    if (perfil === 'responsavel') {
        const alunoFilter = {
            $or: [
                { responsavel: userEmail },
                { 'responsavelDados.email': userEmail },
            ],
        };
        const alunosVinculados = await Aluno.find(alunoFilter)
            .select('_id turma turmaId nome')
            .lean();
        const turmasAutorizadas = [...new Set(
            alunosVinculados.map(a => a.turma).filter(Boolean)
        )];
        return { alunoFilter, turmasAutorizadas, professorDoc: null, alunosVinculados };
    }

    if (perfil === 'professor') {
        const professorDoc = await Professor.findOne({ idUsuario: String(userId) }).lean();
        if (!professorDoc) {
            return { alunoFilter: {}, turmasAutorizadas: [], professorDoc: null };
        }
        const turmasAutorizadas = [
            professorDoc.salaPrincipal,
            ...(professorDoc.salasAdicionais || []),
        ].filter(Boolean);
        const alunoFilter = { turma: { $in: turmasAutorizadas } };
        return { alunoFilter, turmasAutorizadas, professorDoc };
    }

    // diretor, admin, coordenador, secretaria — acesso irrestrito
    return { alunoFilter: {}, turmasAutorizadas: null, professorDoc: null };
}

/**
 * Resolve the Aluno document that the query is about.
 * Layer 1, Rules 1-4: extract name, search DB with RBAC scope, disambiguate.
 *
 * @param {Object}      params
 * @param {string|null} params.alunoId   Pre-resolved ID (from button click)
 * @param {string}      params.message   User message
 * @param {Object}      params.alunoFilter RBAC filter
 * @returns {Promise<{ aluno: Object|null, alunoId: string|null }>
 */
async function resolveAlunoContext({ alunoId, message, alunoFilter }) {
    // Rule 4: click resolution — always use ID, never re-search by name
    if (alunoId != null) {
        const aluno = await Aluno.findOne({ _id: alunoId, ...alunoFilter })
            .select('_id nome turma turmaId')
            .lean();
        if (aluno) {
            return { aluno, alunoId: String(aluno._id) };
        }
        return { aluno: null, alunoId: null };
    }

    // Rule 1: Extract name tokens (stop-words normalized for accent-insensitive matching)
    const STOP_WORDS = new Set([
        'nota','notas','falta','faltas','media','boletim','turma','aluno','alunos',
        'frequencia','presenca','comunicado','horario',
        'professor','como','qual','quais','esta','dos','das','del','que','para',
        'por','com','sem','nao','sim','tem','seu','sua','meu','minha','filho',
        'filha','sobre','ver','quero','preciso','saber','informar','desempenho','rendimento',
    ]);

    const allTokens = message
        .split(/\s+/)
        .map(t => t.replace(/[^A-Za-záéíóúâêîôûãõàèìòùçÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙÇ]/g, ''))
        .filter(t => t.length >= 2 && !STOP_WORDS.has(normalizeText(t)));

    // Rule 2: Search DB progressively (longest match first)
    for (let size = allTokens.length; size >= 1; size--) {
        for (let start = 0; start <= allTokens.length - size; start++) {
            const trecho = allTokens.slice(start, start + size).join(' ');
            if (!trecho.trim()) continue;

            // Normalize the search term for accent-insensitive regex
            const normalizedTrecho = normalizeText(trecho);
            // Build regex that matches accent-insensitively
            const matches = await Aluno.find(
                { nome: new RegExp(trecho, 'i'), ...alunoFilter }
            ).select('_id nome turma turmaId').lean();

            // Rule 3 — Disambiguation
            if (matches.length === 1) {
                // 1 result → proceed directly, no buttons
                return { aluno: matches[0], alunoId: String(matches[0]._id) };
            }

            if (matches.length > 1) {
                // 2+ results → generate buttons { label: real_name, value: aluno_id }
                const rawButtons = matches.map(a => ({
                    label: `${a.nome} — Turma ${a.turma || '—'}`,
                    value: String(a._id),
                }));
                // Validation: every button must map 1:1 to a query result
                const validatedButtons = validateButtons(rawButtons, matches);
                return {
                    aluno: null,
                    alunoId: null,
                    ambiguous: true,
                    ambiguousMessage: `Encontrei ${validatedButtons.length} alunos com esse nome. Qual deles você quer consultar?`,
                    options: validatedButtons,
                };
            }
        }
    }

    // 0 results → no buttons
    return { aluno: null, alunoId: null };
}

/**
 * Fetch grades (notas) for a given aluno context.
 * @param {Object}      params
 * @param {string}      params.alunoContexto   Aluno ID string
 * @param {number|null} params.bimestre         Bimestre filter (1–4) or null
 * @param {string|null} params.materia          Subject name or null
 * @returns {Promise<{ notas: Object[], media: number|null, bimestre: number|null, materia: string|null }>}
 */
async function fetchNotas({ alunoContexto, bimestre, materia }) {
    const query = { alunoId: String(alunoContexto) };
    if (bimestre) query.bimestre = bimestre;
    if (materia)  query.materiaId = new RegExp(materia, 'i');

    const notas = await Nota.find(query).lean();
    if (!notas.length) {
        return { notas: [], media: null, bimestre: bimestre || null, materia: materia || null };
    }
    const soma = notas.reduce((s, n) => s + (parseFloat(n.nota) || 0), 0);
    const media = soma / notas.length;
    return { notas, media, bimestre: bimestre || null, materia: materia || null };
}

/**
 * Fetch attendance (faltas) for a given aluno context.
 * @param {Object} params
 * @param {string} params.alunoContexto   Aluno ID string
 * @returns {Promise<{ faltas: Object[], total: number, presentes: number, frequencia: number|null, alertaCritico: boolean, alertaObservacao: boolean }>}
 */
async function fetchFaltas({ alunoContexto }) {
    const faltas = await Falta.find({ aluno: String(alunoContexto) }).lean();
    const total = faltas.length;
    if (total === 0) {
        return { faltas: [], total: 0, presentes: 0, frequencia: null, alertaCritico: false, alertaObservacao: false };
    }
    const presentes = faltas.filter(f => f.presente).length;
    const frequencia = (presentes / total) * 100;
    const alertaCritico = frequencia < 75;
    const alertaObservacao = frequencia >= 75 && frequencia < 85;
    return { faltas, total, presentes, frequencia, alertaCritico, alertaObservacao };
}

/**
 * Fetch active comunicados for the authenticated profile.
 * @param {Object} params
 * @param {string} params.perfil       Authenticated user profile
 * @param {string} [params.turmaAluno] Turma of the selected aluno (used for responsavel filter)
 * @returns {Promise<Object[]>}
 */
async function fetchComunicados({ perfil, turmaAluno }) {
    const query = { ativo: true };

    if (perfil === 'responsavel') {
        query.destinatarios = { $in: ['todos', 'responsaveis', turmaAluno].filter(Boolean) };
    } else if (perfil === 'professor') {
        query.destinatarios = { $in: ['todos', 'professores'] };
    }
    // admin, diretor, coordenador, secretaria: sem filtro de destinatários

    const comunicados = await Comunicado.find(query)
        .sort({ dataCriacao: -1 })
        .limit(5)
        .lean();

    return comunicados;
}

/**
 * Fetch grade horária for a given turma.
 * @param {Object} params
 * @returns {Promise<Object[]>}
 */
async function fetchGradeHoraria({ turmaId }) {
    if (!turmaId) return [];
    const grade = await GradeHoraria.find({ turmaId })
        .sort({ diaSemana: 1, horaInicio: 1 })
        .lean();
    return grade;
}

/**
 * Fetch professores for a given turma.
 * @param {Object} params
 * @param {string} params.turma  Turma identifier
 * @returns {Promise<Object[]>}
 */
async function fetchProfessores({ turma }) {
    if (!turma) return [];
    const professores = await Professor.find({
        $or: [
            { salaPrincipal: turma },
            { salasAdicionais: turma },
        ],
    }).select('nome materias disciplina').lean();
    return professores;
}

/**
 * Fetch general turma overview (grouped student list and notes).
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function fetchTurmaGeral({ alunoFilter }) {
    const alunos = await Aluno.find(alunoFilter || {}).select('nome turma').lean();
    const porTurma = Object.values(
        alunos.reduce((acc, aluno) => {
            const turma = aluno.turma || 'Sem turma';
            if (!acc[turma]) acc[turma] = { turma, total: 0 };
            acc[turma].total += 1;
            return acc;
        }, {})
    );
    return { alunos, porTurma };
}

/**
 * Fetch school-wide summary (admin/diretor/coordenador only).
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function fetchResumoGeral() {
    const [notaAgg, totalFaltas, totalAulas, totalComunicadosAtivos] = await Promise.all([
        Nota.aggregate([{ $group: { _id: null, media: { $avg: { $toDouble: '$nota' } } } }]),
        Falta.countDocuments({ presente: false }),
        Falta.countDocuments(),
        Comunicado.countDocuments({ ativo: true }),
    ]);

    const mediaEscola = notaAgg.length > 0 ? notaAgg[0].media : null;
    const frequenciaGlobal = totalAulas > 0
        ? ((totalAulas - totalFaltas) / totalAulas) * 100
        : 100;

    return { mediaEscola, frequenciaGlobal, totalComunicadosAtivos };
}

/**
 * Fetch recent conversation history for the user.
 * @param {string} userId
 * @returns {Promise<Object[]>}
 */
async function fetchHistorico(userId) {
    try {
        const historico = await ChatMensagem.find({ usuarioId: String(userId) })
            .sort({ criadoEm: -1 })
            .limit(5)
            .lean();
        return historico;
    } catch (err) {
        // Req 14.3: fail silently — never interrupt the main flow
        return [];
    }
}

/**
 * Formata a resposta diretamente dos dados do banco, sem IA.
 */
function formatarResposta({ intencao, dados, aluno, perfil }) {
    const nomeAluno = aluno ? aluno.nome : null;
    const perfilAdmin = ['diretor', 'admin', 'coordenador', 'secretaria'].includes(perfil);

    switch (intencao) {

        case 'NOTAS': {
            if (!nomeAluno) {
                if (perfilAdmin) {
                    return 'Informe o nome do aluno que deseja consultar as notas. Ex: "Notas do João Silva"';
                }
                return 'Para consultar as notas, informe o nome do aluno.';
            }
            if (!dados.notas || dados.notas.length === 0) {
                const filtro = dados.bimestre ? ` no ${dados.bimestre}º bimestre` : '';
                const mat = dados.materia ? ` de ${dados.materia}` : '';
                return `Não encontrei notas${mat}${filtro} para ${nomeAluno}.`;
            }
            const linhas = dados.notas.map(n => {
                const mat = n.materiaId || n.materia || 'Matéria';
                const val = n.nota !== undefined ? n.nota : '—';
                const bim = n.bimestre ? ` (${n.bimestre}º bim.)` : '';
                return `• ${mat}${bim}: ${val}`;
            });
            const mediaTexto = dados.media !== null ? `\nMédia geral: ${Number(dados.media).toFixed(1)}` : '';
            const filtroTexto = dados.bimestre ? ` — ${dados.bimestre}º bimestre` : '';
            return `Notas de ${nomeAluno}${filtroTexto}:\n${linhas.join('\n')}${mediaTexto}`;
        }

        case 'FALTAS': {
            if (!nomeAluno) {
                if (perfilAdmin) {
                    return 'Informe o nome do aluno que deseja consultar a frequência. Ex: "Faltas do João Silva"';
                }
                return 'Para consultar as faltas, informe o nome do aluno.';
            }
            if (dados.total === 0) {
                return `Não há registros de frequência para ${nomeAluno}.`;
            }
            const freq = dados.frequencia !== null ? `${Number(dados.frequencia).toFixed(1)}%` : '—';
            let alerta = '';
            if (dados.alertaCritico) {
                alerta = '\nAtencao: Frequencia critica (abaixo de 75%). Risco de reprovacao por falta.';
            } else if (dados.alertaObservacao) {
                alerta = '\nAviso: Frequencia em observacao (entre 75% e 85%).';
            }
            return `Frequencia de ${nomeAluno}:\n• Total de registros: ${dados.total}\n• Presencas: ${dados.presentes}\n• Faltas: ${dados.total - dados.presentes}\n• Frequencia: ${freq}${alerta}`;
        }

        case 'COMUNICADOS': {
            if (!dados || dados.length === 0) {
                return 'Não há comunicados ativos no momento.';
            }
            const linhas = dados.map((c, i) => {
                const urgente = c.prioridade === 'Urgente' ? ' [URGENTE]' : '';
                const data = c.dataCriacao ? new Date(c.dataCriacao).toLocaleDateString('pt-BR') : '';
                return `${i + 1}. ${c.titulo}${urgente}${data ? ` (${data})` : ''}\n   ${c.conteudo ? c.conteudo.substring(0, 120) : ''}`;
            });
            return `Comunicados recentes:\n${linhas.join('\n')}`;
        }

        case 'HORARIO': {
            if (!dados || dados.length === 0) {
                if (!aluno && perfilAdmin) {
                    return 'Informe a turma para consultar o horário. Ex: "Horário da turma 3A"';
                }
                return 'A grade horária desta turma não está disponível no sistema.';
            }
            const porDia = dados.reduce((acc, h) => {
                const dia = DIAS_SEMANA[h.diaSemana] || `Dia ${h.diaSemana}`;
                if (!acc[dia]) acc[dia] = [];
                acc[dia].push(`  ${h.horaInicio}–${h.horaFim}: ${h.disciplina || h.materia || '—'}`);
                return acc;
            }, {});
            const linhas = Object.entries(porDia).map(([dia, aulas]) => `${dia}:\n${aulas.join('\n')}`);
            return `Grade horária${nomeAluno ? ` — ${aluno.turma || nomeAluno}` : ''}:\n${linhas.join('\n')}`;
        }

        case 'PROFESSORES': {
            if (!dados || dados.length === 0) {
                if (!aluno && perfilAdmin) {
                    return 'Informe a turma para ver os professores. Ex: "Professores da turma 3A"';
                }
                return 'Não foram encontrados professores vinculados a esta turma.';
            }
            const linhas = dados.map(p => {
                const mats = (p.materias && p.materias.length > 0)
                    ? p.materias.join(', ')
                    : (p.disciplina || '—');
                const sala = p.salaPrincipal ? ` [${p.salaPrincipal}]` : '';
                return `• ${p.nome}${sala} — ${mats}`;
            });
            const turmaLabel = aluno ? ` da turma ${aluno.turma}` : '';
            return `Professores${turmaLabel}:\n${linhas.join('\n')}`;
        }

        case 'TURMA_GERAL': {
            if (!dados || !dados.porTurma || dados.porTurma.length === 0) {
                return 'Não há dados de turmas disponíveis.';
            }
            const linhas = dados.porTurma
                .sort((a, b) => a.turma.localeCompare(b.turma))
                .map(t => `• Turma ${t.turma}: ${t.total} aluno(s)`);
            return `Resumo por turma:\n${linhas.join('\n')}\nTotal geral: ${dados.alunos.length} aluno(s)`;
        }

        case 'RESUMO_GERAL': {
            const media = dados.mediaEscola !== null ? Number(dados.mediaEscola).toFixed(1) : '—';
            const freq  = `${Number(dados.frequenciaGlobal).toFixed(1)}%`;
            return `Resumo da escola:\n• Media geral de notas: ${media}\n• Frequencia global: ${freq}\n• Comunicados ativos: ${dados.totalComunicadosAtivos}`;
        }

        case 'INDEFINIDA':
        default:
            return 'Posso ajudar com: notas, faltas, comunicados, horários, professores e resumo geral. Tente por exemplo: "Notas do João Silva" ou "Comunicados".';
    }
}

/**
 * Build the prompt string for Gemini humanization (Layer 3).
 * Strict rules: Gemini must ONLY rewrite the provided data in natural language.
 * It must NEVER generate buttons, invent names, or fabricate data.
 *
 * @param {Object} params
 * @param {string} params.perfil        User profile
 * @param {string} params.intencao      Classified intent
 * @param {string} params.message       Original user message
 * @param {Object} params.dados         Raw data from DB
 * @param {Array}  [params.historico]    Conversation history
 * @returns {string} Formatted prompt
 */
function buildPrompt({ perfil, intencao, message, dados, historico }) {
    const historicoTexto = (historico && historico.length > 0)
        ? historico.slice().reverse()
            .map(h => `[Usuário]: ${h.pergunta}\n[Assistente]: ${h.resposta}`)
            .join('\n')
        : '(sem histórico)';

    const dadosSerialized = JSON.stringify(dados, null, 2);

    return `Você é o assistente de comunicação do chatbot escolar. Você NUNCA decide quais alunos existem, nunca escolhe nomes, e nunca cria botões — isso já foi resolvido pelo backend antes de você ser chamado.

Sua única função: reescrever os dados recebidos em linguagem natural, acolhedora e objetiva, em Português-BR.

Regras obrigatórias:
- Use SOMENTE os dados literais fornecidos abaixo. Não invente nomes, notas, datas, turmas ou qualquer valor não presente nos dados.
- Se algum campo vier nulo ou vazio, diga que a informação não está disponível — nunca complete com um valor plausível.
- NÃO retorne JSON bruto. NÃO use markdown.
- NÃO gere botões, listas de opções ou sugestões de nomes de alunos.
- Tom: natural, empático e humanizado, breve, sem jargão técnico, sem mencionar "banco de dados", "query" ou "JSON".
- Se a intenção for INDEFINIDA e não houver dados de banco associados, responda de forma simpática e contextual, orientando o usuário sobre os tipos de pergunta suportados (notas, faltas, comunicados, horários, professores, resumo geral).

Perfil do usuário: ${perfil}
Intenção identificada: ${intencao}
Pergunta original: ${message}

[Histórico recente]
${historicoTexto}

[Dados consultados do banco]
${dadosSerialized}

Responda de forma natural e amigável baseada nesses dados.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main entry point — orchestrates the full chatbot pipeline.
 *
 * @param {Object}  params
 * @param {string}  params.message       User message (already truncated)
 * @param {string}  [params.alunoId]     Aluno ID from the previous turn (context)
 * @param {string}  params.perfil        Authenticated user profile (lowercase)
 * @param {string}  params.userId        Authenticated user ID
 * @param {string}  params.nomeUsuario   Authenticated user name
 * @param {string}  [params.userEmail]   Authenticated user email (needed for responsavel)
 *
 * @returns {Promise<{ response: string, alunoId: string|null }>}
 */
async function process({ message, alunoId, perfil, userId, nomeUsuario, userEmail }) {
    // 1. Normalise message
    const normalizedMessage = message.toLowerCase();

    // 2. Classify intent
    const intencao = classifyIntent(normalizedMessage);

    // ─── CONVERSATIONAL INTENT SHORTCUT ───────────────────────────────────
    // Intents that do NOT need DB queries (greetings, thanks, off-topic, etc.)
    // go straight to Gemini with a dedicated conversational prompt, or fall
    // back to a fixed dictionary response if Gemini is unavailable.
    if (isConversationalIntent(intencao)) {
        const googleApiKey = process.env.GOOGLE_TTS_API_KEY;
        const showSuggestions = (intencao === 'INDEFINIDA' || intencao === 'FORA_CONTEXTO');

        if (!googleApiKey) {
            return {
                response: getConversationalFallback(intencao),
                alunoId: null,
                options: showSuggestions ? CONVERSATIONAL_SUGGESTIONS : undefined,
            };
        }
        const conversationalPrompt = buildConversationalPrompt({ perfil, nomeUsuario, message });
        let response;
        try {
            response = await voiceService.generateInsightText(conversationalPrompt);
            response = (response || '').replace(/[*_~`#]/g, '').trim();
        } catch (err) {
            logger.warn(`[ChatbotService] Gemini error (conversational): ${err.message} — usando fallback.`);
            response = getConversationalFallback(intencao);
        }
        return {
            response,
            alunoId: null,
            options: showSuggestions ? CONVERSATIONAL_SUGGESTIONS : undefined,
        };
    }

    // ─── DATA INTENT PIPELINE ──────────────────────────────────────────────
    // 3. Enforce RBAC
    const { alunoFilter, turmasAutorizadas, professorDoc, alunosVinculados } =
        await enforceRBAC({ perfil, userId, userEmail });

    // 4. Resolve aluno context
    const { aluno, alunoId: resolvedAlunoId, ambiguous, ambiguousMessage, options: alunoOptions } =
        await resolveAlunoContext({ alunoId, message, alunoFilter });

    // 4a. Múltiplos alunos com mesmo nome — retorna botões de opção
    // Golden Rule: buttons come ONLY from Layer 1 DB query — skip Gemini entirely
    if (ambiguous) {
        logger.warn(`[ChatbotService] Ambiguous: ${ambiguousMessage} | options: ${JSON.stringify(alunoOptions)}`);
        return { response: ambiguousMessage, alunoId: null, options: alunoOptions };
    }

    // 5. Special-case access checks
    // 5a. responsavel with multiple children and no aluno context resolved
    // Golden Rule: buttons { label, value } from DB only — skip Gemini
    if (
        perfil === 'responsavel' &&
        alunosVinculados &&
        alunosVinculados.length > 1 &&
        !resolvedAlunoId &&
        (intencao === 'NOTAS' || intencao === 'FALTAS')
    ) {
        const childButtons = alunosVinculados.map(a => ({
            label: `${a.nome} — Turma ${a.turma || '—'}`,
            value: String(a._id),
        }));
        const validatedChildButtons = validateButtons(childButtons, alunosVinculados);
        return {
            response: 'Encontrei mais de um aluno vinculado à sua conta. Sobre qual deles você gostaria de saber?',
            alunoId: null,
            options: validatedChildButtons,
        };
    }

    // 5b. responsavel provided an alunoId but access was denied
    if (perfil === 'responsavel' && alunoId != null && !resolvedAlunoId) {
        return {
            response: 'Não encontrei informações para este aluno na sua conta.',
            alunoId: null,
        };
    }

    // 5c. professor attempting to access an unauthorised turma
    if (
        perfil === 'professor' &&
        turmasAutorizadas !== null &&
        turmasAutorizadas.length === 0
    ) {
        return {
            response: 'Você não tem permissão para acessar dados desta turma.',
            alunoId: null,
        };
    }

    // 6. Fetch conversation history (mantido para registro, não usado na resposta)
    await fetchHistorico(userId);

    // 7 & 8. Route to correct fetchData
    let dados = null;

    switch (intencao) {
        case 'NOTAS':
            dados = resolvedAlunoId
                ? await fetchNotas({
                      alunoContexto: resolvedAlunoId,
                      bimestre: detectBimestre(normalizedMessage),
                      materia: detectMateria(normalizedMessage),
                  })
                : { notas: [], media: null };
            break;

        case 'FALTAS':
            dados = resolvedAlunoId
                ? await fetchFaltas({ alunoContexto: resolvedAlunoId })
                : { faltas: [], total: 0, presentes: 0, frequencia: null, alertaCritico: false, alertaObservacao: false };
            break;

        case 'COMUNICADOS':
            dados = await fetchComunicados({
                perfil,
                turmaAluno: aluno ? aluno.turma : null,
            });
            break;

        case 'HORARIO': {
            let turmaId = aluno ? (aluno.turmaId || aluno.turma) : null;
            if (!turmaId && turmasAutorizadas && turmasAutorizadas.length > 0) {
                turmaId = turmasAutorizadas[0];
            }
            dados = await fetchGradeHoraria({ turmaId });
            break;
        }

        case 'PROFESSORES': {
            let turma = aluno ? aluno.turma : null;
            if (!turma && turmasAutorizadas && turmasAutorizadas.length > 0) {
                turma = turmasAutorizadas[0];
            }
            // diretor/admin/coordenador sem turma especificada → lista todos
            if (!turma && turmasAutorizadas === null) {
                dados = await Professor.find({}).select('nome materias disciplina salaPrincipal').lean();
            } else {
                dados = await fetchProfessores({ turma });
            }
            break;
        }

        case 'TURMA_GERAL':
            dados = await fetchTurmaGeral({ alunoFilter });
            break;

        case 'RESUMO_GERAL':
            dados = await fetchResumoGeral();
            break;

        default:
            dados = {};
    }

    // ─── LAYER 2: Deterministic fallback response (always computed) ────────
    const respostaDireta = formatarResposta({ intencao, dados, aluno, perfil });

    // ─── LAYER 3: Gemini humanization with DB data (optional) ─────────────
    const googleApiKey = process.env.GOOGLE_TTS_API_KEY;
    if (!googleApiKey) {
        // No API key → Layer 2 fallback only
        return { response: respostaDireta, alunoId: resolvedAlunoId };
    }

    // Build strict Layer 3 prompt (data intent — humanize DB results)
    const historico = await fetchHistorico(userId);
    const prompt = buildPrompt({ perfil, intencao, message, dados, historico });

    let response;
    try {
        response = await voiceService.generateInsightText(prompt);
        response = (response || '').replace(/[*_~`#]/g, '').trim();
    } catch (err) {
        if (err.quotaExceeded) {
            logger.warn('[ChatbotService] Quota Gemini excedida — usando resposta direta do banco.');
        } else {
            logger.warn(`[ChatbotService] Gemini error: ${err.message} — usando resposta direta.`);
        }
        response = respostaDireta;
    }

    // Golden Rule: Gemini NEVER alters the options array.
    // Options (if any) were already returned in step 4a/5a above.
    return { response, alunoId: resolvedAlunoId };
}

module.exports = {
    process,
    // Exported for unit-testing individual helpers
    classifyIntent,
    isConversationalIntent,
    detectBimestre,
    detectMateria,
    normalizeText,
    validateButtons,
    enforceRBAC,
    resolveAlunoContext,
    fetchNotas,
    fetchFaltas,
    fetchComunicados,
    fetchGradeHoraria,
    fetchProfessores,
    fetchTurmaGeral,
    fetchResumoGeral,
    fetchHistorico,
    formatarResposta,
    buildPrompt,
    buildConversationalPrompt,
    getConversationalFallback,
};
