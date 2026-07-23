const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

/**
 * Registra uma ação no log de auditoria
 */
async function logAction(req, acao, recurso, detalhes = {}) {
    try {
        const user = req.user || {};
        
        let uid = user.id || user._id;
        if (!uid && detalhes.recursoId) {
            uid = detalhes.recursoId; // Usa o ID do recurso modificado como fallback (ex: reset password)
        }

        await AuditLog.create({
            usuarioId: uid || null,
            usuarioNome: user.nome || detalhes.usuarioNome || 'Sistema/Anônimo',
            usuarioEmail: user.email || detalhes.usuarioEmail || 'Desconhecido',
            perfil: user.perfil || 'N/A',
            acao: acao,
            recurso: recurso,
            recursoId: detalhes.recursoId,
            // Escola do contexto (resolvida por filtrarPorEscola) ou explícita
            escolaId: req.escolaId ? String(req.escolaId) : (detalhes.escolaId || undefined),
            detalhes: {
                valorAnterior: detalhes.valorAnterior,
                valorNovo: detalhes.valorNovo,
                descricao: detalhes.descricao
            },
            ip: (() => {
                // Prioriza req.ip (Express trust proxy) e limpa possíveis vírgulas de proxy chains
                const rawIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0';
                const ip = rawIp.split(',')[0].trim();
                // Regex simples para validar IPv4 ou IPv6
                const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i;
                return ipRegex.test(ip) ? ip : 'invalid-ip';
            })(),
            userAgent: req.headers['user-agent'],
            dispositivo: req.headers['sec-ch-ua-platform'] || 'Desconhecido'
        });
    } catch (e) {
        logger.error('Falha ao gravar log de auditoria', { error: e.message, acao, recurso });
    }
}

module.exports = { logAction };
