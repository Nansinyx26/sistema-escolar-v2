const SecurityConfig = require('../models/SecurityConfig');
const Usuario = require('../models/Usuario');
const crypto = require('crypto');
const { logAction } = require('../utils/auditHelper');
const { notificarRotacaoCodigo } = require('../utils/emailNotifications');

class SecurityController {
    /**
     * Gera um novo código aleatório de 6 caracteres
     */
    generateCode() {
        return crypto.randomBytes(3).toString('hex').toUpperCase();
    }

    /**
     * Retorna o código atual (Apenas Admin/Diretor)
     */
    async getStatus(req, res) {
        try {
            let config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
            
            if (!config) {
                config = await SecurityConfig.create({
                    codigoSecretoEscola: this.generateCode(),
                    dataUltimaRotacao: new Date()
                });
            }

            // Verifica se precisa de rotação automática (meia-noite passou?)
            const hoje = new Date().setHours(0, 0, 0, 0);
            const ultima = new Date(config.dataUltimaRotacao).setHours(0, 0, 0, 0);

            if (config.rotacaoAutomatica && hoje > ultima) {
                await this.rotateCodeInternal(config, 'SISTEMA (Auto)');
            }

            res.json({
                success: true,
                data: {
                    codigo: config.codigoSecretoEscola,
                    ultimaRotacao: config.dataUltimaRotacao,
                    proximaRotacao: new Date(hoje + 86400000),
                    rotacaoAtiva: config.rotacaoAutomatica
                }
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * Força a rotação do código (Apenas Admin)
     */
    async forceRotate(req, res) {
        try {
            const config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
            await this.rotateCodeInternal(config, req.user.nome);
            
            await logAction(req, 'ROTATE_SECRET_CODE', 'Segurança', {
                descricao: 'Código secreto da escola foi alterado manualmente'
            });

            res.json({ success: true, message: 'Novo código gerado com sucesso' });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * Lógica interna de rotação
     */
    async rotateCodeInternal(config, autor) {
        const novoCodigo = this.generateCode();
        config.historicoCodigos.push({
            codigo: config.codigoSecretoEscola,
            data: config.dataUltimaRotacao
        });
        config.codigoSecretoEscola = novoCodigo;
        config.dataUltimaRotacao = new Date();
        await config.save();
        console.log(`🔐 [SECURITY] Código rotacionado por ${autor}. Novo: ${novoCodigo}`);

        // Notifica admins
        try {
            const admins = await Usuario.find({ perfil: 'admin', ativo: true }).select('email').lean();
            const adminEmails = admins.map(a => a.email);
            await notificarRotacaoCodigo(adminEmails, novoCodigo, autor);
        } catch (err) {
            console.error('[SECURITY] Erro ao notificar admins sobre rotação:', err.message);
        }
    }

    /**
     * Valida um código (Usado no cadastro)
     */
    async validateCode(code) {
        const config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
        if (!config) return false;
        return config.codigoSecretoEscola === String(code).toUpperCase();
    }

    /**
     * Valida o código enviado via POST público
     */
    async validateCodePublic(req, res) {
        try {
            const { codigo } = req.body;
            if (!codigo) {
                return res.status(400).json({ success: false, error: 'Código não fornecido.' });
            }
            const isValid = await this.validateCode(codigo);
            res.json({ success: true, valid: isValid });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }
}

module.exports = new SecurityController();
