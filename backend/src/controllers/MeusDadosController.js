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
const { logAction } = require('../utils/auditHelper');

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
                anexo: m.anexo && m.anexo.nome ? m.anexo.nome : undefined,
                audio:
                    m.audio && m.audio.url
                        ? `mensagem de voz (${m.audio.duracao || 0}s)`
                        : undefined,
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
                consentimento: {
                    aceiteEm: usuario.consentimentoAceiteEm,
                    versao: usuario.consentimentoVersao,
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

        // Registra a exportação no audit log
        await logAction(req, 'LGPD_EXPORT_DADOS', 'MeusDados', {
            recursoId: userId,
            descricao: `Titular ${usuario.email} exportou seus dados pessoais (LGPD Art. 18).`,
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

        const usuario = await Usuario.findById(userId).select('email nome perfil');
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

        // Registra a solicitação no audit log para o admin processar
        await logAction(req, 'LGPD_SOLICITAR_EXCLUSAO', 'MeusDados', {
            recursoId: userId,
            descricao:
                `SOLICITAÇÃO DE EXCLUSÃO LGPD — Titular: ${usuario.email}${motivo ? ` | Motivo: ${motivo}` : ''}. ` +
                `Inclui ${mensagensDoTitular} mensagem(ns) do chat interno ` +
                `e ${conversasDoTitular} conversa(s) com o assistente (estas serão excluídas). ` +
                `Admin deve processar manualmente em /api/usuarios/${userId}/anonymize.`,
        });

        console.log(`⚠️  [LGPD] Solicitação de exclusão recebida de: ${usuario.email}`);

        return res.json({
            success: true,
            message:
                'Sua solicitação foi recebida e será processada em até 15 dias úteis, conforme previsto na LGPD.',
            protocolo: `LGPD-${Date.now()}-${userId.toString().slice(-6)}`,
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

        const TERMO_AUDIO_ID = 'TERMO_AUDIO_IMAGEM';
        const TERMO_AUDIO_VERSAO = '1.0';
        const termoAudio = Array.isArray(usuario?.lgpdHistory)
            ? usuario.lgpdHistory
                  .filter((h) => h.termoId === TERMO_AUDIO_ID && h.versao === TERMO_AUDIO_VERSAO)
                  .sort((a, b) => new Date(b.aceitoEm) - new Date(a.aceitoEm))[0]
            : null;

        return res.json({
            success: true,
            consentimento: {
                aceiteEm: usuario?.consentimentoAceiteEm || null,
                versao: usuario?.consentimentoVersao || null,
                emailVerificado: usuario?.emailVerificado || false,
                twoFactorAtivo: usuario?.twoFactorEnabled || false,
                termoAudioImagem: termoAudio
                    ? {
                          aceito: true,
                          aceitoEm: termoAudio.aceitoEm,
                          versao: termoAudio.versao,
                      }
                    : null,
            },
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: 'Erro ao consultar consentimento.' });
    }
};
