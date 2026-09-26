/**
 * controllers/ResponsavelController.js
 * Controller dedicado ao Portal do Responsável.
 * Expõe endpoints para o responsável consultar dados do aluno vinculado
 * ao e-mail cadastrado no campo `responsavel` do modelo Aluno.
 *
 * Rotas criadas:
 *   GET /api/responsavel/aluno          → dados do aluno vinculado ao e-mail do responsável
 *   GET /api/responsavel/notas/:alunoId → boletim completo (matérias × bimestres)
 *   GET /api/responsavel/frequencia/:alunoId → resumo de frequência
 */

const mongoose = require('mongoose');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const FrequenciaProfessor = require('../models/FrequenciaProfessor');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');
const urlFotoAluno = require('../utils/urlFotoAluno');
const { projetarAluno } = require('../utils/projecaoAluno');
const assertAcessoAoAluno = require('../middleware/assertAcessoAoAluno');
const vinculos = require('../services/vinculosResponsavel');
const { logAction } = require('../utils/auditHelper');
const { limparCamposSemFinalidade } = require('../utils/camposSemFinalidade');
const { mascarar } = require('../services/vinculosResponsavel');
const { escolaMatch } = require('../middleware/filtrarPorEscola');

// Trava por conta contra varredura do código secreto do aluno
const MAX_TENTATIVAS_VINCULO = 5;
const BLOQUEIO_VINCULO_MS = 60 * 60 * 1000; // 1 hora

/**
 * Regex ancorada e escapada para casar e-mail exato.
 *
 * `new RegExp(email, 'i')` sem escape era um buraco real: updateProfile deixa
 * o responsável trocar o próprio e-mail e a validação aceita metacaracteres,
 * então um e-mail como `a.*@x.com` casava com os alunos de outras famílias.
 */
function emailRegexExato(email) {
    return new RegExp(`^${escapeRegex(String(email || ''))}$`, 'i');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Monta um filtro para localizar uma notificação por `_id` OU pelo campo `id`.
 * Só inclui a condição `_id` quando o valor for um ObjectId válido — caso
 * contrário o Mongoose lança CastError (500) e a ação (marcar lida/ocultar)
 * falha silenciosamente no portal.
 */
function buildNotifQuery(id) {
    const or = [{ id: id }];
    if (mongoose.Types.ObjectId.isValid(id)) {
        or.push({ _id: id });
    }
    return { $or: or };
}

/**
 * Todos os valores de `destinatarios` que alcançam este aluno.
 *
 * O campo é gravado ora como string, ora como número, ora como `turma:X` —
 * daí a lista em vez de uma comparação só. Extraído de `getNotificacoes` para
 * que a LEITURA e as ESCRITAS (marcar lida / ocultar) usem exatamente o mesmo
 * critério de "esta notificação é deste aluno".
 */
function destinatariosDoAluno(aluno, alunoId) {
    const turmaId = aluno.turma || aluno.turmaId;
    const lista = ['todos', 'responsaveis', turmaId, `turma:${turmaId}`].filter(Boolean);

    const acrescentar = (valor) => {
        if (valor === undefined || valor === null || valor === '') return;
        lista.push(String(valor));
        if (!Number.isNaN(Number(valor))) lista.push(Number(valor));
    };

    acrescentar(alunoId);
    if (aluno._id) lista.push(String(aluno._id));
    acrescentar(aluno.id);

    return lista;
}

/**
 * Carrega uma notificação garantindo que ela seja MESMO endereçada ao aluno.
 *
 * `verifyOwnership` só responde "este aluno é seu?". As rotas de marcar-lida e
 * ocultar paravam aí e buscavam a notificação apenas pelo `:id` da URL: com um
 * aluno legítimo no corpo, um responsável escrevia em QUALQUER notificação do
 * sistema — inclusive as de `paraResponsavel: false` (avisos internos de
 * staff), que ele nem pode ler. O efeito é limitado (empurra um id para `lido`
 * ou `ocultadoPor`), mas é escrita em documento fora do seu escopo, e o
 * `ocultadoPor` é o mesmo array que a leitura usa para filtrar.
 *
 * Devolve `null` quando a notificação não existe OU não alcança este aluno —
 * a rota responde 404 nos dois casos, sem revelar qual foi.
 */
/**
 * O que alcança este aluno: o público da família (`paraResponsavel: true`) na
 * escola do aluno, ou o que foi endereçado ao próprio responsável pelo nome
 * (`usuario:<id>`). Sem o recorte de escola, um `todos` de outra escola da rede
 * aparecia no portal.
 */
function filtroNotificacoesDoAluno(aluno, alunoId, userId) {
    const alcance = [
        { paraResponsavel: true, destinatarios: { $in: destinatariosDoAluno(aluno, alunoId) } },
    ];
    if (userId) alcance.push({ destinatarios: `usuario:${userId}` });

    const partes = [{ $or: alcance }];
    const escola = escolaMatch(aluno.escolaId);
    if (Object.keys(escola).length) partes.push(escola);
    return { $and: partes };
}

function usuarioDaSessao(req) {
    const id = req.user?._id || req.user?.id;
    return id ? String(id) : null;
}

async function carregarNotificacaoDoAluno(id, alunoId, userId) {
    const Notificacao = require('../models/Notificacao');

    // `_id` só entra no $or se for ObjectId válido — senão o Mongoose lança
    // CastError e a ação vira 500 em vez de 404.
    const orAluno = [{ id: alunoId }];
    if (mongoose.Types.ObjectId.isValid(alunoId)) orAluno.push({ _id: alunoId });

    const aluno = await Aluno.findOne({ $or: orAluno }).lean();
    if (!aluno) return null;

    return Notificacao.findOne({
        $and: [buildNotifQuery(id), filtroNotificacoesDoAluno(aluno, alunoId, userId)],
    });
}

/**
 * Encontra o aluno vinculado ao e-mail do responsável.
 * O campo `responsavel` no modelo Aluno armazena o nome ou e-mail do responsável.
 * Também aceita busca por matrícula passada como query param.
 */
async function _findAlunoByResponsavel(email, matricula) {
    const query = matricula
        ? { matricula: String(matricula) }
        : { responsavel: emailRegexExato(email) };

    return Aluno.findOne(query).lean();
}

/**
 * Middleware de segurança (IDOR protection):
 * Verifica se o aluno solicitado realmente pertence ao responsável logado.
 */
async function verifyOwnership(alunoId, email) {
    if (!email) return false;
    const emailRegex = emailRegexExato(email);
    const aluno = await Aluno.findOne({
        $and: [
            { $or: [{ _id: alunoId }, { id: alunoId }] },
            {
                $or: [
                    { responsavel: emailRegex },
                    { 'responsavelDados.email': emailRegex },
                    { 'responsaveis.email': emailRegex },
                ],
            },
        ],
    }).lean();
    return !!aluno;
}

// ─── GET /api/responsavel/alunos ──────────────────────────────────────────────
exports.getAlunos = async (req, res) => {
    try {
        const email = req.user?.email || req.query.email;

        if (!email) {
            return res.status(400).json({ success: false, error: 'E-mail obrigatório.' });
        }

        const emailRegex = emailRegexExato(email);
        const query = {
            $or: [
                { responsavel: emailRegex },
                { 'responsavelDados.email': emailRegex },
                { 'responsaveis.email': emailRegex },
            ],
        };
        const alunos = await Aluno.find(query).lean();

        // Resolve o nome da escola de cada aluno (multi-escola).
        // Legados sem escolaId caem no rótulo padrão "Escola Jaguari".
        const escolaIds = [
            ...new Set(
                alunos
                    .map((a) => a.escolaId)
                    .filter(Boolean)
                    .map(String)
            ),
        ];
        const escolaNomePorId = {};
        if (escolaIds.length) {
            try {
                const Escola = require('../models/Escola');
                const escolas = await Escola.find({ _id: { $in: escolaIds } })
                    .select('nome')
                    .lean();
                escolas.forEach((e) => {
                    escolaNomePorId[String(e._id)] = e.nome;
                });
            } catch (e) {
                // Segue com fallback (nome da escola em branco), mas registra:
                // o responsável veria a tela sem saber que ela está incompleta.
                logger.warn('Falha ao resolver nomes das escolas (portal do responsável)', {
                    err: e,
                    escolaIds: escolaIds.length,
                    action: 'responsavel.listarAlunos',
                });
            }
        }

        // Retorna todos os dados para o frontend usar (dados pessoais, médicos, etc)
        const safeAlunos = alunos.map((aluno) => {
            const safe = {
                // Ficha do próprio filho, pela lista fechada do perfil responsável
                // (utils/projecaoAluno.js) — nunca o documento cru do banco.
                ...projetarAluno(aluno, 'responsavel'),
                id: aluno._id,
                nome: aluno.nome,
                sobrenome: aluno.sobrenome || '',
                matricula: aluno.matricula,
                turma: aluno.turma || aluno.turmaId,
                dataNascimento: aluno.nascimento,
                ativo: aluno.ativo,
                foto: aluno.foto || null,
                cpfAluno: aluno.cpfAluno || '',
                telefone: aluno.telefone || '',
                endereco: aluno.endereco || null,
                nacionalidade: aluno.nacionalidade || '',
                etnia: aluno.etnia || '',
                responsavelDados: aluno.responsavelDados || null,
                responsaveis: aluno.responsaveis || [],
                guardaLegal: aluno.guardaLegal || '',
                pessoasAutorizadasRetirada: aluno.pessoasAutorizadasRetirada || [],
                autorizacoesEscolares: aluno.autorizacoesEscolares || null,
                fichaDocumentoStatus: aluno.fichaDocumentoStatus || 'pendente',
                alergiasAlimentos: aluno.alergiasAlimentos || '',
                alergiasRemedio: aluno.alergiasRemedio || '',
                planoSaude: aluno.planoSaude || '',
                deficiencia: aluno.deficiencia || '',
                pcd: aluno.pcd || false,
                nivel: aluno.nivel || '',
                condicao: aluno.condicao || '',
                observacoes: aluno.observacoes || '',
                documentos: aluno.documentos || [],
                lgpdConsentimento: aluno.lgpdConsentimento || null,
                escolaNome:
                    (aluno.escolaId && escolaNomePorId[String(aluno.escolaId)]) || 'Escola Jaguari',
            };
            safe.foto = urlFotoAluno(safe.foto);
            return safe;
        });

        res.json({ success: true, data: safeAlunos });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── GET /api/responsavel/buscar-aluno/:codigo ───────────────────────────────
// Permite ao responsável conferir os dados básicos do aluno antes de vincular.
exports.buscarAluno = async (req, res) => {
    try {
        const { codigo } = req.params;
        if (!codigo) {
            return res.status(400).json({ success: false, error: 'Código secreto não fornecido.' });
        }

        const sanitizedCode = codigo.trim().toUpperCase();

        if (!/^[A-Z0-9]{4,16}$/.test(sanitizedCode)) {
            return res.status(400).json({
                success: false,
                error: 'Código secreto inválido. Use o código fornecido pela escola.',
            });
        }

        // O código não vai para o log — ele é a credencial de vínculo
        console.log(`🔍 [LINK-STUDENT] Consulta de aluno por código secreto.`);

        // Busca aluno pelo código secreto (deve ser único conforme o model)
        const aluno = await Aluno.findOne({
            codigoSecreto: sanitizedCode,
            ativo: { $ne: false },
        })
            .select('nome sobrenome turma turmaId matricula responsavel')
            .lean();

        if (!aluno) {
            console.warn(`❌ [LINK-STUDENT] Código inválido ou aluno inativo: ${sanitizedCode}`);
            return res.status(404).json({
                success: false,
                error: 'Estudante não encontrado com este código secreto. Verifique se o código está correto ou se o aluno está ativo.',
            });
        }

        // Se já tem um responsável vinculado, avisa (mas permite se o usuário quiser sobrescrever ou se for o mesmo)
        const vinculado = !!aluno.responsavel;

        res.json({
            success: true,
            data: {
                id: aluno._id,
                nome: `${aluno.nome}${aluno.sobrenome ? ` ${aluno.sobrenome}` : ''}`,
                turma: aluno.turma || aluno.turmaId || 'N/D',
                matricula: aluno.matricula || 'N/D',
                jaVinculado: vinculado,
            },
        });
    } catch (err) {
        console.error(`❌ [LINK-STUDENT] Erro na busca por código:`, err.message);
        res.status(500).json({ success: false, error: 'Erro interno ao buscar aluno.' });
    }
};

// ─── POST /api/responsavel/vincular ──────────────────────────────────────────
// Permite vincular um aluno à conta logada do responsável usando o código secreto de forma segura.
exports.vincularAluno = async (req, res) => {
    try {
        const { codigoSecreto } = req.body;
        const email = req.user?.email;
        const usuarioId = req.user?.id || req.user?._id;

        if (!email || !usuarioId) {
            return res.status(401).json({ success: false, error: 'Usuário não autenticado.' });
        }

        if (!codigoSecreto) {
            return res
                .status(400)
                .json({ success: false, error: 'O código secreto é obrigatório.' });
        }

        const sanitizedCode = codigoSecreto.trim().toUpperCase();

        if (!/^[A-Z0-9]{4,16}$/.test(sanitizedCode)) {
            return res.status(400).json({
                success: false,
                error: 'Código secreto inválido. Use o código fornecido pela escola.',
            });
        }

        // ── Trava por conta contra varredura de códigos ──────────────────────
        // O rate limit por IP (app.js) é a primeira camada; esta impede que a
        // mesma conta varra códigos trocando de IP.
        const Usuario = require('../models/Usuario');
        const conta = await Usuario.findById(usuarioId).select(
            '+vinculoAttempts +vinculoLockUntil'
        );
        const agora = new Date();
        if (conta?.vinculoLockUntil && conta.vinculoLockUntil > agora) {
            const minutos = Math.ceil((conta.vinculoLockUntil - agora) / 60000);
            return res.status(429).json({
                success: false,
                error: `Muitas tentativas de vínculo. Tente novamente em ${minutos} minuto(s) ou procure a secretaria.`,
            });
        }

        // Buscar aluno pelo código secreto
        const aluno = await Aluno.findOne({
            codigoSecreto: sanitizedCode,
            ativo: { $ne: false },
        });

        if (!aluno) {
            const tentativas = (conta?.vinculoAttempts || 0) + 1;
            const update = { vinculoAttempts: tentativas };
            if (tentativas >= MAX_TENTATIVAS_VINCULO) {
                update.vinculoLockUntil = new Date(Date.now() + BLOQUEIO_VINCULO_MS);
                update.vinculoAttempts = 0;
            }
            await Usuario.updateOne({ _id: usuarioId }, { $set: update });

            await logAction(req, 'LINK_STUDENT_FAILED', 'Alunos', {
                descricao: `Tentativa de vínculo com código inválido por ${mascarar(email)} (${tentativas}/${MAX_TENTATIVAS_VINCULO}).`,
            });

            console.warn(`❌ [LINK-STUDENT] Código inválido informado por ${email}.`);
            return res.status(404).json({
                success: false,
                error: 'Código secreto inválido ou aluno inativo. Por favor, confirme o código com a secretaria.',
            });
        }

        const targetEmail = email.toLowerCase();

        // SEGURANÇA: um aluno JÁ VINCULADO não é reatribuído por quem apresenta
        // o código. Antes o vínculo era sobrescrito com um simples warning no
        // log — o responsável legítimo era desvinculado e o atacante passava a
        // ler notas/frequência e a editar quem pode retirar a criança da escola.
        if (aluno.responsavel && String(aluno.responsavel).toLowerCase() !== targetEmail) {
            await logAction(req, 'LINK_STUDENT_BLOCKED', 'Alunos', {
                recursoId: aluno._id,
                descricao: `Tentativa de vínculo por ${mascarar(targetEmail)} em aluno já vinculado a outro responsável.`,
            });
            return res.status(409).json({
                success: false,
                error: 'Este aluno já possui um responsável vinculado. Procure a secretaria da escola para transferir o vínculo.',
            });
        }

        // Vínculo bem-sucedido zera o contador de tentativas.
        // Multi-escola: contas criadas via Google (SSO) nascem sem escolaId — o
        // registerResponsavel herda a escola do aluno, mas o onboarding por
        // código não fazia isso, deixando a conta sem escola. Herdamos aqui a
        // escola do aluno quando a conta ainda não tem uma definida.
        const updateConta = { vinculoAttempts: 0, vinculoLockUntil: null };
        if (aluno.escolaId && !conta?.escolaId) {
            updateConta.escolaId = aluno.escolaId;
        }
        await Usuario.updateOne({ _id: usuarioId }, { $set: updateConta });
        aluno.responsavel = targetEmail;

        // Atualiza responsavelDados se necessário
        if (!aluno.responsavelDados) {
            aluno.responsavelDados = {};
        }
        aluno.responsavelDados.email = targetEmail;

        await Aluno.updateOne(
            { _id: aluno._id },
            {
                $set: {
                    responsavel: targetEmail,
                    responsavelDados: aluno.responsavelDados,
                },
            }
        );

        // O código secreto NUNCA vai para o log de auditoria — ele continua
        // válido depois do vínculo e dá acesso à conta do aluno.
        await logAction(req, 'LINK_STUDENT_VIA_CODE', 'Alunos', {
            recursoId: aluno._id,
            valorNovo: { email: targetEmail },
            descricao: `Vínculo realizado: ${mascarar(targetEmail)} vinculou o aluno ${aluno._id} via código secreto.`,
        });

        console.log(`✅ [LINK-STUDENT] Sucesso: Aluno ${aluno.nome} vinculado a ${targetEmail}`);

        res.json({
            success: true,
            message: 'Aluno vinculado com sucesso!',
            data: {
                id: aluno._id,
                nome: aluno.nome,
                matricula: aluno.matricula,
                turma: aluno.turma || aluno.turmaId,
            },
        });
    } catch (e) {
        console.error(`❌ [LINK-STUDENT] Erro no vínculo:`, e.message);
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── GET /api/responsavel/notas/:alunoId ─────────────────────────────────────
exports.getNotas = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const email = req.user?.email;

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) {
            return res
                .status(403)
                .json({ success: false, error: 'Acesso negado. Aluno não vinculado à sua conta.' });
        }

        const aluno = await Aluno.findOne({ $or: [{ _id: alunoId }, { id: alunoId }] }).lean();
        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        const notas = await Nota.find({
            $or: [
                { alunoId: String(aluno._id) },
                { alunoId: aluno._id },
                { alunoId: aluno.id },
                { matriculaId: aluno.matricula },
            ],
        })
            .sort({ materiaId: 1, bimestre: 1 })
            .lean();

        if (!notas.length) {
            return res.json({ success: true, data: [] });
        }

        // Estrutura: agrupa por matéria → array de média por bimestre
        const porMateria = {};

        notas.forEach((n) => {
            const materia = n.materiaId || n.descricao || 'Geral';
            const bimestre = n.bimestre || 0;

            if (!porMateria[materia]) {
                porMateria[materia] = {
                    disciplina: materia,
                    professor: n.professor || null,
                    porBimestre: {},
                };
            }

            const bKey = String(bimestre);
            if (!porMateria[materia].porBimestre[bKey]) {
                porMateria[materia].porBimestre[bKey] = { soma: 0, count: 0 };
            }

            if (n.nota !== undefined && n.nota !== null) {
                porMateria[materia].porBimestre[bKey].soma += parseFloat(n.nota);
                porMateria[materia].porBimestre[bKey].count += 1;
            }
        });

        // Converte para o formato esperado pelo frontend:
        // { disciplina, professor, bimestres: [b1, b2, b3, b4] }
        const resultado = Object.values(porMateria).map((m, idx) => {
            // Bimestre sem nota lançada => null (ausência de nota), NUNCA 0.
            // Retornar 0 fazia o boletim exibir "0,0" e derrubava a média do aluno.
            const bimestres = [1, 2, 3, 4].map((b) => {
                const entry = m.porBimestre[String(b)];
                if (!entry || entry.count === 0) return null;
                return Math.round((entry.soma / entry.count) * 10) / 10;
            });

            return {
                id: `grade-${idx}`,
                disciplina: m.disciplina,
                professor: m.professor,
                bimestres,
            };
        });

        res.json({ success: true, data: resultado });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── GET /api/responsavel/frequencia/:alunoId ────────────────────────────────
exports.getFrequencia = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const email = req.user?.email;
        // Permite passar dataAtual via query param para testes determinísticos
        const dataReferencia = req.query.dataAtual ? new Date(req.query.dataAtual) : new Date();

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) {
            return res
                .status(403)
                .json({ success: false, error: 'Acesso negado. Aluno não vinculado à sua conta.' });
        }

        const aluno = await Aluno.findOne({ $or: [{ _id: alunoId }, { id: alunoId }] }).lean();
        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        // Buscar registros na coleção de faltas
        const queryFaltas = {
            $or: [
                { aluno: String(aluno._id) },
                { aluno: aluno._id },
                { aluno: aluno.id },
                { alunoId: String(aluno._id) },
                { alunoId: aluno._id },
                { alunoId: aluno.id },
                { matriculaId: aluno.matricula },
            ],
        };
        const faltas = await Falta.find(queryFaltas).lean();

        // 1. Filtrar ausências efetivas (presente === false ou ausente no sistema legacy sem o campo 'presente')
        const faltasEfetivas = faltas.filter(
            (f) => f.presente === false || f.presente === undefined
        );
        let ausencia = faltasEfetivas.filter((f) => !f.justificada).length;
        const atraso = faltasEfetivas.filter((f) => f.justificada).length;

        // Se o professor lançou faltas manualmente no boletim/cadastro do aluno (faltasBimestre),
        // isso deve ser considerado (geralmente como o total de ausências do aluno).
        if (aluno.faltasBimestre) {
            const values =
                aluno.faltasBimestre instanceof Map
                    ? Array.from(aluno.faltasBimestre.values())
                    : Object.values(aluno.faltasBimestre || {});

            const manualAbsences = values.reduce((sum, val) => sum + (Number(val) || 0), 0);
            if (manualAbsences > ausencia) {
                ausencia = manualAbsences;
            }
        }

        // 2. Calcular dias letivos decorridos em 2026 até a data de referência
        const getElapsedSchoolDays = (dateObj) => {
            // Normaliza tudo em UTC para evitar distorções de fuso horário local
            const todayUTC = Date.UTC(
                dateObj.getUTCFullYear(),
                dateObj.getUTCMonth(),
                dateObj.getUTCDate()
            );
            const startUTC = Date.UTC(2026, 1, 9); // 09/02/2026 (fevereiro é 1)

            if (todayUTC < startUTC) return 0;

            let count = 0;
            const temp = new Date(startUTC);
            while (temp.getTime() <= todayUTC) {
                const day = temp.getUTCDay();
                if (day !== 0 && day !== 6) {
                    // Ignora Sábado e Domingo
                    count++;
                }
                temp.setUTCDate(temp.getUTCDate() + 1);
            }

            // Feriados e recessos nacionais em dias de semana ocorridos em 2026 (em UTC)
            const holidays = [
                Date.UTC(2026, 1, 16), // Carnaval Segunda-feira
                Date.UTC(2026, 1, 17), // Carnaval Terça-feira
                Date.UTC(2026, 3, 3), // Sexta-feira Santa
                Date.UTC(2026, 3, 21), // Tiradentes
                Date.UTC(2026, 4, 1), // Dia do Trabalho
            ];

            holidays.forEach((hTime) => {
                if (hTime >= startUTC && hTime <= todayUTC) {
                    const hDate = new Date(hTime);
                    const day = hDate.getUTCDay();
                    if (day !== 0 && day !== 6) {
                        count--;
                    }
                }
            });

            return Math.min(count, 200);
        };

        const elapsedDays = getElapsedSchoolDays(dataReferencia);

        // 3. Determinar a quantidade total de aulas/dias letivos a serem considerados
        const turmasBusca = [aluno.turma, aluno.turmaId].filter(Boolean);
        const aulasProfessor = await FrequenciaProfessor.find({
            classe: { $in: turmasBusca },
        }).lean();

        let totalAulas = 0;
        if (aulasProfessor.length > 0) {
            totalAulas = aulasProfessor.reduce((sum, aula) => sum + (aula.quantidadeAulas || 1), 0);
        } else {
            // Caso não tenha registros em FrequenciaProfessor, tenta pegar dias distintos de chamadas da turma
            const totalDiasDistintos = await Falta.distinct('data', {
                turma: { $in: turmasBusca },
            });
            totalAulas = totalDiasDistintos.length;
        }

        // Conta as presenças reais/efetivas no sistema (chamadas diárias onde presente === true)
        const presencasEfetivas = faltas.filter((f) => f.presente === true).length;

        // Garante que o total de aulas é pelo menos o maior valor entre:
        // - Dias letivos decorridos até hoje no calendário de 2026
        // - Aulas registradas em banco pelos professores
        // - Soma das ausências (manuais ou calculadas), atrasos e presenças reais.
        const totalRegistrosDoAluno = faltas.length;
        const minAulas = ausencia + atraso + presencasEfetivas;

        if (totalAulas < elapsedDays) {
            totalAulas = elapsedDays;
        }
        if (totalAulas < totalRegistrosDoAluno) {
            totalAulas = totalRegistrosDoAluno;
        }
        if (totalAulas < minAulas) {
            totalAulas = minAulas;
        }

        // Se total de aulas ainda for zero, usa um padrão seguro
        if (totalAulas === 0) {
            totalAulas = 50;
        }

        // A presença do aluno é o total de aulas ministradas menos suas ausências e atrasos
        let presenca = totalAulas - ausencia - atraso;
        if (presenca < 0) presenca = 0;

        const percentual = totalAulas > 0 ? Math.round((presenca / totalAulas) * 100) : 100;

        res.json({
            success: true,
            data: { presenca, ausencia, atraso, percentual },
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── GET /api/responsavel/notificacoes/:alunoId ─────────────────────────────
exports.getNotificacoes = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const email = req.user?.email;

        // Proteção IDOR: Garante que o responsável logado seja dono deste aluno
        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) {
            return res
                .status(403)
                .json({ success: false, error: 'Acesso negado. Aluno não vinculado à sua conta.' });
        }

        const Notificacao = require('../models/Notificacao');
        const aluno = await Aluno.findOne({
            $or: [{ _id: alunoId }, { id: alunoId }],
        }).lean();

        if (!aluno) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado' });
        }

        // Mesmo filtro usado por `carregarNotificacaoDoAluno` nas rotas de
        // escrita — ler e escrever precisam concordar sobre o que é "deste
        // aluno", senão o escopo de uma some sem a outra perceber.
        const ocultadosList = [String(alunoId)];
        if (aluno._id) ocultadosList.push(String(aluno._id));
        if (aluno.id) ocultadosList.push(String(aluno.id));

        // Buscando notificações onde destinatarios é 'todos', ou turmaId, ou alunoId
        // Adicionado paraResponsavel: true para isolar completamente e impedir que avisos de staff apareçam para pais
        const notificacoes = await Notificacao.find({
            $and: [
                filtroNotificacoesDoAluno(aluno, alunoId, usuarioDaSessao(req)),
                { ocultadoPor: { $nin: ocultadosList } },
            ],
        })
            .sort({ dataCriacao: -1 })
            .lean();

        const iconMap = {
            info: '📢',
            aviso: '⚠️',
            evento: '🎉',
            financeiro: '💰',
            academico: '📚',
            saude: '🏥',
            falta: '📋',
        };

        // Agrupar IDs de remetentes exclusivos para busca otimizada
        const remetenteIds = [
            ...new Set(notificacoes.map((n) => n.criadoPor).filter((id) => id && id.length > 10)),
        ];
        const usuarios = await require('../models/Usuario')
            .find({ _id: { $in: remetenteIds } })
            .select('nome')
            .lean();
        const userMap = {};
        usuarios.forEach((u) => {
            userMap[String(u._id)] = u.nome;
        });

        const formatted = notificacoes.map((n) => {
            const nId = n.id || String(n._id);
            const isRead = n.lido
                ? n.lido.includes(String(alunoId)) ||
                  (aluno.id && n.lido.includes(String(aluno.id))) ||
                  (aluno._id && n.lido.includes(String(aluno._id)))
                : false;

            return {
                id: nId,
                tipo: n.tipo,
                titulo: n.titulo,
                mensagem: n.mensagem,
                prioridade: n.prioridade,
                corpoHtml: n.corpoHtml,
                comunicadoId: n.comunicadoId ? String(n.comunicadoId) : undefined,
                notificacaoId: nId, // Adicionado para suporte a comentários genéricos
                dataCriacao: n.dataCriacao,
                lido: isRead,
                destinatarios: n.destinatarios,
                criadoPor:
                    userMap[String(n.criadoPor)] || n.criadoByNome || n.criadoPor || 'Direção',
                icon: iconMap[n.tipo] || '🔔',
            };
        });

        res.json({ success: true, data: formatted });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── PUT /api/responsavel/notificacoes/:id/ler ──────────────────────────────
exports.marcarComoLida = async (req, res) => {
    try {
        const { id } = req.params;
        const { alunoId } = req.body;
        const email = req.user?.email;

        if (!alunoId) {
            return res.status(400).json({ success: false, error: 'ID do aluno obrigatório.' });
        }

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) {
            return res
                .status(403)
                .json({ success: false, error: 'Acesso negado. Aluno não vinculado à sua conta.' });
        }

        // Escopo: só notificação endereçada a ESTE aluno. Sem isto, `:id` era
        // livre — bastava um aluno próprio no corpo para escrever em qualquer
        // notificação do banco.
        const notificacao = await carregarNotificacaoDoAluno(id, alunoId, usuarioDaSessao(req));
        if (!notificacao) {
            return res.status(404).json({ success: false, error: 'Notificação não encontrada.' });
        }

        // Adiciona o alunoId ao array lido se não estiver lá
        if (!Array.isArray(notificacao.lido)) notificacao.lido = [];
        const currentAluId = String(alunoId);
        if (!notificacao.lido.includes(currentAluId)) {
            notificacao.lido.push(currentAluId);
            await notificacao.save();
        }

        res.json({ success: true, message: 'Notificação marcada como lida.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── PUT /api/responsavel/notificacoes/:id/ocultar ──────────────────────────
exports.ocultarNotificacao = async (req, res) => {
    try {
        const { id } = req.params;
        const { alunoId } = req.body;
        const email = req.user?.email;

        if (!alunoId) {
            return res.status(400).json({ success: false, error: 'ID do aluno obrigatório.' });
        }

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) {
            return res
                .status(403)
                .json({ success: false, error: 'Acesso negado. Aluno não vinculado à sua conta.' });
        }

        // Mesmo escopo do marcar-como-lida: `ocultadoPor` é o array que a
        // LEITURA usa para filtrar, então escrever nele fora do próprio escopo
        // mexe no que outras pessoas veem.
        const notificacao = await carregarNotificacaoDoAluno(id, alunoId, usuarioDaSessao(req));
        if (!notificacao) {
            return res.status(404).json({ success: false, error: 'Notificação não encontrada.' });
        }

        // Adiciona o alunoId ao array ocultadoPor se não estiver lá
        if (!notificacao.ocultadoPor) {
            notificacao.ocultadoPor = [];
        }
        if (!notificacao.ocultadoPor.includes(alunoId)) {
            notificacao.ocultadoPor.push(alunoId);
            await notificacao.save();
        }

        res.json({ success: true, message: 'Notificação ocultada para o usuário.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── PUT /api/responsavel/aluno/:alunoId/dados ───────────────────────────────
exports.updateAlunoDados = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const email = req.user?.email;
        if (!email) return res.status(401).json({ success: false, error: 'Não autenticado.' });

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) return res.status(403).json({ success: false, error: 'Acesso negado.' });

        const allowed = [
            'responsaveis',
            'guardaLegal',
            'pessoasAutorizadasRetirada',
            'autorizacoesEscolares',
            'responsavelDados',
        ];
        const update = {};
        allowed.forEach((k) => {
            if (req.body[k] !== undefined) update[k] = req.body[k];
        });
        limparCamposSemFinalidade(update);

        if (update.responsaveis && update.responsaveis.length > 2) {
            return res
                .status(400)
                .json({ success: false, error: 'Máximo de 2 responsáveis por aluno.' });
        }

        // ============================================
        // O RESPONSÁVEL NÃO REVOGA O ACESSO DE OUTRO
        // ============================================
        // `responsaveis[].email` e `responsavelDados.email` são exatamente os
        // campos que `verifyOwnership` consulta para decidir quem pode ver a
        // ficha do aluno. Como esta rota deixava o responsável reescrevê-los à
        // vontade, ele podia sobrescrever a lista e DERRUBAR o acesso do outro
        // responsável à ficha do próprio filho — sem passar pela escola.
        // Num sistema que modela `guardaLegal`, isso é munição para disputa de
        // guarda, não um detalhe teórico.
        //
        // Regra: pode adicionar e editar dados, não pode fazer um e-mail já
        // cadastrado DESAPARECER. Remoção é ato da secretaria/direção, pelas
        // rotas de /api/alunos.
        if (update.responsaveis !== undefined || update.responsavelDados !== undefined) {
            const atual = await Aluno.findOne({ $or: [{ _id: alunoId }, { id: alunoId }] })
                .select('responsaveis responsavelDados')
                .lean();

            const emailsDe = (doc) => {
                const lista = Array.isArray(doc?.responsaveis) ? doc.responsaveis : [];
                const emails = lista
                    .map((r) => String(r?.email || '').toLowerCase())
                    .filter(Boolean);
                const principal = String(doc?.responsavelDados?.email || '').toLowerCase();
                if (principal) emails.push(principal);
                return emails;
            };

            const antes = new Set(emailsDe(atual));
            const depois = new Set(
                emailsDe({
                    responsaveis:
                        update.responsaveis !== undefined
                            ? update.responsaveis
                            : atual?.responsaveis,
                    responsavelDados:
                        update.responsavelDados !== undefined
                            ? update.responsavelDados
                            : atual?.responsavelDados,
                })
            );

            const removidos = [...antes].filter((e) => !depois.has(e));
            if (removidos.length > 0) {
                return res.status(403).json({
                    success: false,
                    error: 'Não é possível remover um responsável já cadastrado. Solicite a alteração à secretaria da escola.',
                });
            }
        }

        // ── Inclusão de responsável vira PEDIDO (Issue #398) ────────────────
        //
        // O e-mail que consta na ficha é o que dá acesso aos dados da criança.
        // Um e-mail NOVO, portanto, não entra aqui: vira pedido pendente, e a
        // secretaria decide. Editar dados de quem já está na ficha continua
        // valendo, e remover continua bloqueado (regra acima).
        const antesDoUpdate = await Aluno.findOne({ $or: [{ _id: alunoId }, { id: alunoId }] })
            .select(
                'responsaveis responsavelDados guardaLegal pessoasAutorizadasRetirada autorizacoesEscolares escolaId nome sobrenome'
            )
            .lean();
        if (!antesDoUpdate) {
            return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        }

        let pedidos = [];
        if (Array.isArray(update.responsaveis)) {
            const { conhecidos, novos } = vinculos.separarNovos(antesDoUpdate, update.responsaveis);
            if (novos.length > 0) {
                pedidos = await vinculos.registrarPedidos({
                    aluno: antesDoUpdate,
                    novos,
                    solicitante: req.user,
                });
                await logAction(req, 'VINCULO_RESPONSAVEL_SOLICITADO', 'Alunos', {
                    recursoId: String(antesDoUpdate._id),
                    valorNovo: { pedidos: pedidos.map((p) => vinculos.mascarar(p.email)) },
                    descricao: `Responsável pediu inclusão de ${pedidos.length} e-mail(s) no aluno ${antesDoUpdate._id}.`,
                });
            }
            update.responsaveis = conhecidos;
        }
        // `responsavelDados.email` é outra porta para o mesmo efeito: só é
        // aceito quando repete um e-mail que já está na ficha.
        if (update.responsavelDados?.email) {
            const jaNaFicha = vinculos.emailsDaFicha(antesDoUpdate);
            if (!jaNaFicha.has(String(update.responsavelDados.email).trim().toLowerCase())) {
                return res.status(403).json({
                    success: false,
                    codigo: 'INCLUSAO_DEPENDE_DA_SECRETARIA',
                    error: 'Para incluir outro responsável, faça o pedido pela lista de responsáveis; a secretaria confirma a inclusão.',
                });
            }
        }

        const aluno = await Aluno.findOneAndUpdate(
            { $or: [{ _id: alunoId }, { id: alunoId }] },
            { $set: update },
            { new: true }
        ).lean();

        // Sincroniza autorizações escolares com o modelo Autorizacao
        if (update.autorizacoesEscolares && aluno?.escolaId) {
            try {
                const Autorizacao = require('../models/Autorizacao');
                const authData = update.autorizacoesEscolares;
                const respNome =
                    req.user?.nome ||
                    aluno.responsavelDados?.nome ||
                    aluno.responsaveis?.[0]?.nome ||
                    '';
                const respEmail = req.user?.email || email;
                const respId = req.user?.id || req.user?._id;
                const agora = new Date();

                const syncPromessas = Autorizacao.TIPOS_AUTORIZACAO.map(async (tipo) => {
                    const valor = authData[tipo];
                    if (valor === undefined) return;

                    let detalhes;
                    if (
                        tipo === 'conducaoEscolar' &&
                        (authData.motoristaNome || authData.motoristaTelefone)
                    ) {
                        detalhes = {
                            motoristaNome: authData.motoristaNome || '',
                            motoristaTelefone: authData.motoristaTelefone || '',
                        };
                    } else if (
                        tipo === 'antitermico' &&
                        (authData.medicamentoNome || authData.medicamentoDose)
                    ) {
                        detalhes = {
                            medicamentoNome: authData.medicamentoNome || '',
                            medicamentoDose: authData.medicamentoDose || '',
                        };
                    }

                    const meta = Autorizacao.METADADOS_AUTORIZACOES[tipo] || {};

                    const respostaNova = valor === true ? true : valor === false ? false : null;
                    await Autorizacao.findOneAndUpdate(
                        {
                            escolaId: aluno.escolaId,
                            alunoId: aluno._id,
                            tipoAutorizacao: tipo,
                        },
                        {
                            // Cada resposta entra no histórico; a anterior fica.
                            $push: {
                                historico: {
                                    aceita: respostaNova,
                                    detalhes,
                                    respondidoPor: String(respId || ''),
                                    em: agora,
                                },
                            },
                            $set: {
                                escolaId: aluno.escolaId,
                                alunoId: aluno._id,
                                responsavelId: respId,
                                responsavelNome: respNome,
                                responsavelEmail: respEmail,
                                tipoAutorizacao: tipo,
                                titulo: meta.titulo,
                                descricao: meta.descricao,
                                aceita: respostaNova,
                                detalhes,
                                dataResposta: agora,
                                atualizadoEm: agora,
                            },
                        },
                        { upsert: true, new: true }
                    );
                });

                await Promise.all(syncPromessas);
            } catch (syncErr) {
                logger.error('Erro ao sincronizar Autorizacao no updateAlunoDados', {
                    error: syncErr.message,
                });
            }
        }

        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        // Trilha do que decide guarda e segurança da criança. Só contagem e
        // e-mail mascarado: a trilha prova o que mudou sem virar mais um lugar
        // onde o dado pessoal fica guardado.
        const sensiveis = ['guardaLegal', 'pessoasAutorizadasRetirada', 'autorizacoesEscolares'];
        const alterados = sensiveis.filter((c) => update[c] !== undefined);
        if (alterados.length > 0) {
            const medir = (doc) => ({
                guardaLegal: doc?.guardaLegal || null,
                pessoasAutorizadasRetirada: (doc?.pessoasAutorizadasRetirada || []).length,
                autorizacoesEscolares: doc?.autorizacoesEscolares ? 'definidas' : null,
            });
            await logAction(req, 'FICHA_ALUNO_ALTERADA_PELO_RESPONSAVEL', 'Alunos', {
                recursoId: String(aluno._id),
                valorAnterior: medir(antesDoUpdate),
                valorNovo: medir(aluno),
                descricao: `Responsável alterou ${alterados.join(', ')} do aluno ${aluno._id}.`,
            });
        }

        res.json({
            success: true,
            data: projetarAluno(aluno, 'responsavel'),
            ...(pedidos.length
                ? {
                      pedidosDeInclusao: pedidos,
                      message:
                          'O pedido de inclusão de responsável foi enviado à secretaria. O acesso começa depois da aprovação.',
                  }
                : {}),
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── POST /api/responsavel/aluno/:alunoId/documentos ─────────────────────────
exports.uploadDocumentos = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const email = req.user?.email;
        if (!email) return res.status(401).json({ success: false, error: 'Não autenticado.' });

        const isOwner = await verifyOwnership(alunoId, email);
        if (!isOwner) return res.status(403).json({ success: false, error: 'Acesso negado.' });

        const { arquivos } = req.body;
        if (!arquivos || !Array.isArray(arquivos) || arquivos.length === 0) {
            return res.status(400).json({ success: false, error: 'Nenhum arquivo informado.' });
        }

        // Só entra na ficha o arquivo que ESTE usuário acabou de enviar
        // (Issue #399). Antes, o corpo trazia um identificador qualquer do
        // bucket, e dava para pendurar na ficha da criança um arquivo de
        // outra conversa.
        const { findFileDoc } = require('./FileController');
        const meuId = String(req.user?.id || req.user?._id || '');
        for (const a of arquivos) {
            const referencia = a?.gridfsId || a?.id;
            const noBucket = referencia ? await findFileDoc(String(referencia)) : null;
            const dono = String(noBucket?.metadata?.usuarioId || '');
            if (!noBucket || dono !== meuId) {
                return res.status(403).json({
                    success: false,
                    codigo: 'ARQUIVO_NAO_E_SEU',
                    error: 'Envie o arquivo pelo próprio formulário antes de registrá-lo na ficha.',
                });
            }
        }

        const novosArquivos = arquivos.map((a) => ({
            id: a.id || require('node:crypto').randomBytes(8).toString('hex'),
            nome: a.nome,
            tipo: a.tipo,
            gridfsId: a.gridfsId,
            enviadoEm: new Date(),
        }));

        const aluno = await Aluno.findOne({ $or: [{ _id: alunoId }, { id: alunoId }] });
        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        const docsAtuais =
            aluno.documentos?.arquivos || (Array.isArray(aluno.documentos) ? aluno.documentos : []);
        const todosArquivos = [...docsAtuais, ...novosArquivos];

        aluno.documentos = {
            arquivos: todosArquivos,
            ultimoEnvio: new Date(),
        };
        aluno.fichaDocumentoStatus = 'enviado';
        await aluno.save();

        res.json({
            success: true,
            data: {
                documentos: aluno.documentos,
                fichaDocumentoStatus: aluno.fichaDocumentoStatus,
            },
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// ─── PUT /api/responsavel/aluno/:alunoId/documento-status (admin/secretaria) ─
exports.updateDocumentoStatus = async (req, res) => {
    try {
        const perfil = req.user?.perfil;
        if (!['admin', 'diretor', 'secretaria'].includes(perfil)) {
            return res.status(403).json({
                success: false,
                error: 'Apenas secretaria/admin pode conferir documentos.',
            });
        }

        const { alunoId } = req.params;
        const { status } = req.body;
        if (!['pendente', 'enviado', 'conferido'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Status inválido.' });
        }

        // Escola e vínculo (Issue #397): antes, gestão de uma escola alterava —
        // e recebia de volta — a ficha de aluno de outra.
        const acesso = await assertAcessoAoAluno(req, alunoId);
        if (!acesso.ok) {
            return res.status(acesso.status).json({ success: false, error: acesso.error });
        }

        const update = { fichaDocumentoStatus: status };
        if (status === 'conferido') {
            update['documentos.conferidoEm'] = new Date();
            update['documentos.conferidoPor'] = req.user.email;
        }

        const aluno = await Aluno.findOneAndUpdate(
            { $or: [{ _id: alunoId }, { id: alunoId }] },
            { $set: update },
            { new: true }
        ).lean();

        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado.' });

        await logAction(req, 'DOCUMENTO_ALUNO_STATUS', 'Alunos', {
            recursoId: String(aluno._id),
            valorNovo: { fichaDocumentoStatus: status },
            descricao: `Status da ficha de documentos do aluno ${aluno._id}: ${status}.`,
        });

        // Resposta mínima: a tela só precisa saber que o status mudou.
        res.json({ success: true, data: { id: String(aluno._id), status } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};
