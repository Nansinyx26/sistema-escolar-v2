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
const { logAction } = require('../utils/auditHelper');

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
            .select('-senha -resetToken -resetTokenExpiry -twoFactorSecret -twoFactorPendingToken -emailVerificacaoToken')
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
                    versao: usuario.consentimentoVersao
                },
                anonimizadoEm: usuario.anonimizadoEm,
                foto: usuario.foto || '',
                fotoGoogle: usuario.fotoGoogle || ''
            },
            historicoAcoes: logsDoUsuario.map(log => ({
                acao: log.acao,
                recurso: log.recurso,
                descricao: log.detalhes?.descricao,
                data: log.data
            }))
        };

        // Registra a exportação no audit log
        await logAction(req, 'LGPD_EXPORT_DADOS', 'MeusDados', {
            recursoId: userId,
            descricao: `Titular ${usuario.email} exportou seus dados pessoais (LGPD Art. 18).`
        });

        // Retorna como JSON com header de download (portabilidade)
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="meus-dados-${Date.now()}.json"`);

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

        // Registra a solicitação no audit log para o admin processar
        await logAction(req, 'LGPD_SOLICITAR_EXCLUSAO', 'MeusDados', {
            recursoId: userId,
            descricao: `SOLICITAÇÍO DE EXCLUSÍO LGPD — Titular: ${usuario.email}${motivo ? ` | Motivo: ${motivo}` : ''}. Admin deve processar manualmente em /api/usuarios/${userId}/anonymize.`
        });

        console.log(`⚠️  [LGPD] Solicitação de exclusão recebida de: ${usuario.email}`);

        return res.json({
            success: true,
            message: 'Sua solicitação foi recebida e será processada em até 15 dias úteis, conforme previsto na LGPD.',
            protocolo: `LGPD-${Date.now()}-${userId.toString().slice(-6)}`
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
            .select('consentimentoAceiteEm consentimentoVersao emailVerificado twoFactorEnabled')
            .lean();

        return res.json({
            success: true,
            consentimento: {
                aceiteEm: usuario?.consentimentoAceiteEm || null,
                versao: usuario?.consentimentoVersao || null,
                emailVerificado: usuario?.emailVerificado || false,
                twoFactorAtivo: usuario?.twoFactorEnabled || false
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: 'Erro ao consultar consentimento.' });
    }
};
