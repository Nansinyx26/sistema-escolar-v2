/**
 * MeusDadosController.js
 * ============================================
 * IMPLEMENTAÇÍO: Portal do Titular de Dados — Roadmap #13
 * Sprint: Setembro–Outubro 2026 | LGPD Art. 18
 * ============================================
 * Garante ao usuário autenticado os direitos previstos na LGPD:
 *
 *   Art. 18, I   — Confirmação de existência de tratamento
 *   Art. 18, II  — Acesso aos dados
 *   Art. 18, IV  — Anonimização ou bloqueio de dados desnecessários
 *   Art. 18, VI  — Portabilidade dos dados (exportação)
 *
 * Rotas (adicionar em api.js):
 *   GET  /api/meus-dados              → exporta todos os dados do titular
 *   POST /api/meus-dados/solicitar-exclusao → solicita anonimização
 *
 * SEGURANÇA: Todas as rotas exigem authJWT.
 * Cada usuário só acessa seus próprios dados (req.user.id).
 */

const Usuario = require('../models/Usuario');
const Aluno = require('../models/Aluno');
const AuditLog = require('../models/AuditLog');
const ChatDireto = require('../models/ChatDireto');
const IaConversa = require('../models/IaConversa');
const PedidoTitular = require('../models/PedidoTitular');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const DocumentoResponsavel = require('../models/DocumentoResponsavel');
const JustificativaFalta = require('../models/JustificativaFalta');
const escapeRegex = require('../utils/escapeRegex');
const { logAction } = require('../utils/auditHelper');

// A identidade e a vigência dos dois consentimentos moram nos utils, e não
// aqui: esta tela é LEITORA da mesma regra que a página do Termo escreve
// (Issue #201). Enquanto a regra estava copiada, a cópia daqui procurava
// `termoId: 'TERMO_AUDIO_IMAGEM'` e o que era gravado era `'termo_audio_imagem'`
// — nenhum aceite casava, e "Meus Dados" dizia "Pendente" para quem tinha
// assinado.
const { TERMO_VERSAO, aceiteVigente } = require('../utils/termoAudioImagem');
const { CONSENTIMENTO_VERSAO, consentimentoVigente } = require('../utils/consentimentoLgpd');

// Teto do pacote de conversas. Uma exportação não pode virar um dump de
// centenas de MB que trava o processo (memoryStorage do Render é pequeno).
// Acima disso o titular é orientado a pedir o restante ao suporte.
const LIMITE_MENSAGENS_EXPORTACAO = 5000;

/**
 * Monta o histórico do chat interno do titular para a exportação.
 *
 * Inclui as mensagens que ele ENVIOU e as que RECEBEU — as duas pontas são
 * dado pessoal dele. O que ele apagou só para si fica de fora, coerente com o
 * que ele enxerga no portal.
 *
 * O conteúdo de mensagem apagada para todos NÃO é reexposto aqui: ela foi
 * removida da vista de ambos e o registro do que havia mora na trilha de
 * auditoria, que é acessível só à gestão.
 */
async function montarHistoricoChat(userId) {
    const id = String(userId);

    const mensagens = await ChatDireto.find({
        $or: [{ remetenteId: id }, { destinatarioId: id }],
        apagadaPara: { $ne: id },
    })
        .sort({ createdAt: -1 })
        .limit(LIMITE_MENSAGENS_EXPORTACAO + 1)
        .lean();

    const truncado = mensagens.length > LIMITE_MENSAGENS_EXPORTACAO;
    const lista = truncado ? mensagens.slice(0, LIMITE_MENSAGENS_EXPORTACAO) : mensagens;

    // Resolve os nomes dos interlocutores numa consulta só, para o pacote não
    // sair cheio de ObjectIds que não dizem nada ao titular.
    const outrosIds = [
        ...new Set(
            lista.map((m) =>
                String(m.remetenteId) === id ? String(m.destinatarioId) : String(m.remetenteId)
            )
        ),
    ];
    const pessoas = await Usuario.find({ _id: { $in: outrosIds } })
        .select('nome perfil')
        .lean();
    const nomePorId = new Map(pessoas.map((p) => [String(p._id), p.nome]));

    return {
        total: lista.length,
        truncado,
        observacao: truncado
            ? `Exportação limitada às ${LIMITE_MENSAGENS_EXPORTACAO} mensagens mais recentes. Para o histórico completo, solicite à secretaria da escola.`
            : undefined,
        mensagens: lista.map((m) => {
            const souRemetente = String(m.remetenteId) === id;
            const outroId = souRemetente ? String(m.destinatarioId) : String(m.remetenteId);
            return {
                data: m.createdAt,
                direcao: souRemetente ? 'enviada' : 'recebida',
                interlocutor: nomePorId.get(outroId) || 'Usuário removido',
                conteudo: m.apagadaParaTodos ? '[mensagem apagada]' : m.mensagem || '',
                anexo: m.anexo?.nome ? m.anexo.nome : undefined,
                audio: m.audio?.url ? `mensagem de voz (${m.audio.duracao || 0}s)` : undefined,
                editada: m.editada || false,
            };
        }),
    };
}

/**
 * Monta as conversas do titular com o copiloto para a exportação.
 *
 * Mesma razão do chat interno: é conversa do titular com a escola, dado pessoal
 * dele, e precisa sair no pacote de portabilidade.
 *
 * O `resumo` comprimido também entra — ele é derivado das mensagens dele e, do
 * ponto de vista do titular, é conteúdo que a escola guarda a respeito dele.
 */
async function montarConversasCopiloto(userId) {
    const conversas = await IaConversa.find({ usuarioId: String(userId) })
        .sort({ atualizadoEm: -1 })
        .lean();

    return {
        total: conversas.length,
        observacao:
            'Conversas com o assistente da escola. Expiram automaticamente após o período de retenção configurado.',
        conversas: conversas.map((c) => ({
            titulo: c.titulo,
            criadoEm: c.criadoEm,
            atualizadoEm: c.atualizadoEm,
            resumoDeTrechosAntigos: c.resumo || undefined,
            mensagens: (c.mensagens || []).map((m) => ({
                data: m.em,
                autor: m.papel === 'usuario' ? 'você' : 'assistente',
                conteudo: m.texto,
                // Só os nomes das consultas feitas — o retorno delas nunca é
                // persistido (ver o cabeçalho de models/IaConversa.js).
                consultasRealizadas: m.ferramentas,
            })),
        })),
    };
}

/**
 * Coleta os dados pessoais e escolares dos alunos sob responsabilidade do titular.
 * (LGPD Art. 14 — Melhores interesses da criança/adolescente e direito de acesso dos pais/responsáveis).
 */
async function montarDadosDependentes(usuario) {
    if (!usuario?.email) return [];
    const emailLimpo = String(usuario.email).trim().toLowerCase();
    const emailRegex = new RegExp(`^${escapeRegex(emailLimpo)}$`, 'i');

    const alunos = await Aluno.find({
        $or: [
            { responsavel: emailRegex },
            { 'responsavelDados.email': emailRegex },
            { 'responsaveis.email': emailRegex },
        ],
    }).lean();

    if (!alunos || alunos.length === 0) return [];

    const dependentes = [];
    for (const aluno of alunos) {
        const alunoIds = [String(aluno._id), aluno.id].filter(Boolean);
        const [notas, faltas, documentos, justificativas] = await Promise.all([
            Nota.find({ alunoId: { $in: alunoIds } }).lean(),
            Falta.find({
                $or: [{ alunoId: { $in: alunoIds } }, { aluno: { $in: alunoIds } }],
            }).lean(),
            DocumentoResponsavel.find({ alunoId: { $in: alunoIds } }).lean(),
            JustificativaFalta.find({ alunoId: { $in: alunoIds } }).lean(),
        ]);

        dependentes.push({
            id: aluno._id,
            nome: aluno.nome,
            sobrenome: aluno.sobrenome || '',
            matricula: aluno.matricula || '',
            raDigito: aluno.raDigito || '',
            raUf: aluno.raUf || 'SP',
            turma: aluno.turma || aluno.turmaId || '',
            nascimento: aluno.nascimento,
            situacao: aluno.situacao || 'ativo',
            codigoInep: aluno.codigoInep || '',
            pcd: aluno.pcd || false,
            deficiencia: aluno.deficiencia || '',
            transtornos: aluno.transtornos || [],
            guardaLegal: aluno.guardaLegal || '',
            autorizacoesEscolares: aluno.autorizacoesEscolares || null,
            pessoasAutorizadasRetirada: aluno.pessoasAutorizadasRetirada || [],
            alergiasAlimentos: aluno.alergiasAlimentos || '',
            alergiasRemedio: aluno.alergiasRemedio || '',
            planoSaude: aluno.planoSaude || '',
            observacoes: aluno.observacoes || '',
            notas: (notas || []).map((n) => ({
                materia: n.materia || n.materiaId || n.descricao || '',
                valor: n.valor != null ? n.valor : n.nota,
                bimestre: n.bimestre,
                tipo: n.tipo,
                anoLetivo: n.anoLetivo,
            })),
            faltas: (faltas || []).map((f) => ({
                data: f.data,
                motivo: f.motivo,
                presente: f.presente,
                materia: f.materia,
                justificada: f.justificada,
            })),
            documentos: (documentos || []).map((d) => ({
                tipo: d.tipo,
                nomeArquivo: d.nomeArquivo,
                status: d.status,
                criadoEm: d.createdAt,
            })),
            justificativasFalta: (justificativas || []).map((j) => ({
                dataInicio: j.dataInicio,
                dataFim: j.dataFim,
                motivo: j.motivo,
                status: j.status,
            })),
        });
    }

    return dependentes;
}

// --------------------------------------------------
// GET /api/meus-dados
// Retorna todos os dados pessoais do usuário autenticado.
// Exportação completa para portabilidade (LGPD Art. 18, II e VI).
// --------------------------------------------------
exports.exportarMeusDados = async (req, res) => {
    try {
        const userId = req.user.id;

        // Busca dados do usuário (sem campos de segurança internos)
        const usuario = await Usuario.findById(userId)
            .select(
                '-senha -resetToken -resetTokenExpiry -twoFactorSecret -twoFactorPendingToken -emailVerificacaoToken'
            )
            .lean();

        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        // Busca logs de auditoria relacionados a este usuário (histórico de ações)
        const logsDoUsuario = await AuditLog.find({ usuarioId: userId })
            .select('acao recurso detalhes data')
            .sort({ data: -1 })
            .limit(100)
            .lean();

        const consentimentoDoTitular = consentimentoVigente(usuario);

        // Monta o pacote de dados completo
        const pacoteDados = {
            exportadoEm: new Date().toISOString(),
            referencia: 'LGPD — Lei 13.709/2018, Art. 18',
            titular: {
                id: usuario._id,
                nome: usuario.nome,
                email: usuario.email,
                cpf: usuario.cpf,
                telefone: usuario.telefone,
                perfil: usuario.perfil,
                escola: usuario.escola,
                disciplina: usuario.disciplina,
                ativo: usuario.ativo,
                criadoEm: usuario.criadoEm || usuario.createdAt,
                ultimoLogin: usuario.ultimoLogin,
                emailVerificado: usuario.emailVerificado,
                twoFactorAtivo: usuario.twoFactorEnabled || false,
                // Mesma regra da tela de status: o consentimento pode estar no
                // campo (contas antigas) ou no histórico imutável, e o pacote
                // do titular não pode dizer "nunca consentiu" por olhar só um
                // dos dois. Ver utils/consentimentoLgpd.js.
                consentimento: {
                    aceiteEm: consentimentoDoTitular.aceitoEm,
                    versao: consentimentoDoTitular.versao,
                },
                anonimizadoEm: usuario.anonimizadoEm,
                foto: usuario.foto || '',
                fotoGoogle: usuario.fotoGoogle || '',
            },
            historicoAcoes: logsDoUsuario.map((log) => ({
                acao: log.acao,
                recurso: log.recurso,
                descricao: log.detalhes?.descricao,
                data: log.data,
            })),
            // As conversas do chat interno são dado pessoal do titular e
            // faltavam no pacote: ele recebia tudo menos o que efetivamente
            // conversou com a escola.
            chatInterno: await montarHistoricoChat(userId),
            // Mesma razão do chat interno: conversa do titular com a escola é
            // dado pessoal dele e precisa sair no pacote de portabilidade.
            assistenteEscola: await montarConversasCopiloto(userId),
        };

        // Se o titular for responsável por alunos, inclui os dados do(s) filho(s)
        const dependentes = await montarDadosDependentes(usuario);
        if (dependentes.length > 0) {
            pacoteDados.dependentes = dependentes;
            pacoteDados.referencia =
                'LGPD — Lei 13.709/2018, Art. 18 (Direitos do Titular) e Art. 14 (Tratamento de Dados de Crianças e Adolescentes)';
        }

        // Registra a exportação no audit log
        await logAction(req, 'LGPD_EXPORT_DADOS', 'MeusDados', {
            recursoId: userId,
            descricao: `Titular ${usuario._id} exportou seus dados pessoais (LGPD Art. 18).${dependentes.length ? ` Inclui ${dependentes.length} dependente(s).` : ''}`,
        });

        // Retorna como JSON com header de download (portabilidade)
        res.setHeader('Content-Type', 'application/json');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="meus-dados-${Date.now()}.json"`
        );

        return res.json(pacoteDados);
    } catch (err) {
        console.error('[MeusDados] Erro na exportação:', err);
        return res.status(500).json({ success: false, error: 'Erro ao exportar dados.' });
    }
};

// --------------------------------------------------
// POST /api/meus-dados/solicitar-exclusao
// O titular solicita a anonimização/exclusão de seus dados.
// Não executa imediatamente — cria uma solicitação para análise.
// (Para exclusão imediata, admin usa /api/usuarios/:id/anonymize)
// --------------------------------------------------
exports.solicitarExclusao = async (req, res) => {
    try {
        const userId = req.user.id;
        const { motivo } = req.body;

        const usuario = await Usuario.findById(userId).select('email nome perfil escola');
        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        // Quantas conversas serão afetadas — o admin precisa saber o alcance
        // antes de executar, e o titular tem direito de saber o que some.
        const mensagensDoTitular = await ChatDireto.countDocuments({
            remetenteId: String(userId),
            apagadaParaTodos: { $ne: true },
        });
        const conversasDoTitular = await IaConversa.countDocuments({ usuarioId: String(userId) });

        const protocolo = `LGPD-${Date.now()}-${userId.toString().slice(-6).toUpperCase()}`;
        const prazoAtendimento = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 dias corridos (LGPD Art. 19, II)

        // Registra formalmente na coleção de pedidos do titular (Issue #413)
        const pedido = await PedidoTitular.create({
            protocolo,
            usuarioId: String(userId),
            usuarioEmail: usuario.email.toLowerCase(),
            usuarioNome: usuario.nome,
            perfil: usuario.perfil,
            escolaId: usuario.escola ? String(usuario.escola) : undefined,
            tipo: 'exclusao',
            motivo: motivo ? String(motivo).trim() : '',
            status: 'pendente',
            prazoAtendimento,
            detalhes: {
                mensagensDoChat: mensagensDoTitular,
                conversasAssistente: conversasDoTitular,
            },
            historico: [
                {
                    status: 'pendente',
                    alteradoEm: new Date(),
                    alteradoPor: String(userId),
                    observacao: 'Solicitação registrada pelo titular no Portal de Privacidade.',
                },
            ],
        });

        // Registra a solicitação no audit log para o admin processar
        await logAction(req, 'LGPD_SOLICITAR_EXCLUSAO', 'MeusDados', {
            recursoId: userId,
            protocolo,
            descricao:
                `SOLICITAÇÃO DE EXCLUSÃO LGPD [${protocolo}] — Titular: ${usuario.email}${motivo ? ` | Motivo: ${motivo}` : ''}. ` +
                `Inclui ${mensagensDoTitular} mensagem(ns) do chat interno ` +
                `e ${conversasDoTitular} conversa(s) com o assistente (estas serão excluídas). ` +
                `Registrado na coleção pedidos_titular para despacho pela administração.`,
        });

        console.log(
            `⚠️  [LGPD] Solicitação de exclusão recebida de: ${usuario.email} [${protocolo}]`
        );

        return res.json({
            success: true,
            message:
                'Sua solicitação foi recebida e será processada em até 15 dias, conforme previsto na LGPD.',
            protocolo,
            status: pedido.status,
            prazo: prazoAtendimento,
            abrangencia: {
                mensagensDoChat: mensagensDoTitular,
                observacao:
                    'O conteúdo das suas mensagens será removido. O registro da conversa permanece ' +
                    'sem conteúdo, porque também é dado do outro participante e registro da escola.',
            },
        });
    } catch (err) {
        console.error('[MeusDados] Erro na solicitação:', err);
        return res.status(500).json({ success: false, error: 'Erro ao processar solicitação.' });
    }
};

// --------------------------------------------------
// GET /api/meus-dados/pedidos
// Retorna a lista de pedidos LGPD protocolados pelo titular autenticado.
// --------------------------------------------------
exports.listarMeusPedidos = async (req, res) => {
    try {
        const userId = req.user.id;
        const pedidos = await PedidoTitular.find({ usuarioId: String(userId) })
            .sort({ createdAt: -1 })
            .lean();

        return res.json({
            success: true,
            data: pedidos.map((p) => ({
                id: String(p._id),
                protocolo: p.protocolo,
                tipo: p.tipo,
                status: p.status,
                prazoAtendimento: p.prazoAtendimento,
                criadoEm: p.createdAt,
                decididoEm: p.decididoEm,
                respostaAdmin: p.respostaAdmin,
                motivo: p.motivo,
                historico: p.historico,
            })),
        });
    } catch (err) {
        console.error('[MeusDados] Erro ao listar pedidos do titular:', err);
        return res.status(500).json({ success: false, error: 'Erro ao consultar pedidos.' });
    }
};

// --------------------------------------------------
// GET /api/meus-dados/status-consentimento
// Retorna histórico de consentimentos do titular.
// --------------------------------------------------
exports.statusConsentimento = async (req, res) => {
    try {
        const usuario = await Usuario.findById(req.user.id)
            .select(
                'consentimentoAceiteEm consentimentoVersao emailVerificado twoFactorEnabled lgpdHistory'
            )
            .lean();

        const termoAudio = aceiteVigente(usuario?.lgpdHistory);
        const consentimento = consentimentoVigente(usuario);

        return res.json({
            success: true,
            consentimento: {
                aceiteEm: consentimento.aceitoEm,
                versao:
                    consentimento.versao || (consentimento.aceito ? CONSENTIMENTO_VERSAO : null),
                emailVerificado: usuario?.emailVerificado || false,
                twoFactorAtivo: usuario?.twoFactorEnabled || false,
                termoAudioImagem: termoAudio
                    ? {
                          aceito: true,
                          aceitoEm: termoAudio.aceitoEm,
                          versao: termoAudio.versao || TERMO_VERSAO,
                      }
                    : null,
            },
        });
    } catch (_err) {
        return res.status(500).json({ success: false, error: 'Erro ao consultar consentimento.' });
    }
};
