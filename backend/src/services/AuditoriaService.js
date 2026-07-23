const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

class AuditoriaService {
    /**
     * Registra uma ação no sistema de auditoria (Melhorado para Roadmap #4)
     * @param {Object} data 
     */
    async log({ req, usuarioId, usuarioNome, usuarioEmail, perfil, acao, recurso, recursoId, detalhes, ip }) {
        try {
            // Se o objeto 'req' for passado, extrai informações automaticamente
            const uId = usuarioId || req?.user?.id || req?.user?._id;
            const uNome = usuarioNome || req?.user?.nome;
            const uEmail = usuarioEmail || req?.user?.email;
            const uPerfil = perfil || req?.user?.perfil;
            const clientIp = ip || req?.ip || req?.headers?.['x-forwarded-for'];

            const entry = new AuditLog({
                usuarioId: uId,
                usuarioNome: uNome,
                usuarioEmail: uEmail,
                perfil: uPerfil,
                acao,
                recurso,
                recursoId,
                detalhes: detalhes || {},
                ip: clientIp,
                userAgent: req?.headers?.['user-agent'],
                data: new Date()
            });

            await entry.save();
            return entry;
        } catch (error) {
            logger.error(`[Audit] Erro ao gravar log: ${error.message}`);
            return null;
        }
    }
}

module.exports = new AuditoriaService();
