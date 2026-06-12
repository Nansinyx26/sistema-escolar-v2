const SecurityConfig = require('../models/SecurityConfig');
const Usuario = require('../models/Usuario');
const crypto = require('crypto');
const { logAction } = require('../utils/auditHelper');
const { notificarRotacaoCodigo } = require('../utils/emailNotifications');

class SecurityController {
    /**
     * Gera um novo código aleatório de 10 caracteres
     * Contém: maiúsculas, minúsculas, números e caracteres especiais
     */
    generateCode(length = 10) {
        const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const lower = 'abcdefghijklmnopqrstuvwxyz';
        const digits = '0123456789';
        const special = '!@#$%&*_+-=';
        const all = upper + lower + digits + special;

        // Garante pelo menos 1 de cada tipo
        let code = '';
        code += upper[crypto.randomInt(upper.length)];
        code += lower[crypto.randomInt(lower.length)];
        code += digits[crypto.randomInt(digits.length)];
        code += special[crypto.randomInt(special.length)];

        // Preenche o restante aleatoriamente
        for (let i = code.length; i < length; i++) {
            code += all[crypto.randomInt(all.length)];
        }

        // Embaralha para não ter padrão previsível (Fisher-Yates)
        const arr = code.split('');
        for (let i = arr.length - 1; i > 0; i--) {
            const j = crypto.randomInt(i + 1);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr.join('');
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

            // Verifica se precisa de rotação automática (meia-noite de Brasília passou?)
            const agora = new Date();
            const hojeBR = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
            hojeBR.setHours(0, 0, 0, 0);
            const ultimaBR = new Date(new Date(config.dataUltimaRotacao).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
            ultimaBR.setHours(0, 0, 0, 0);

            if (config.rotacaoAutomatica && hojeBR > ultimaBR) {
                await this.rotateCodeInternal(config, 'SISTEMA (Auto-MeiaNoite-BR)');
            }

            res.json({
                success: true,
                data: {
                    codigo: config.codigoSecretoEscola,
                    ultimaRotacao: config.dataUltimaRotacao,
                    proximaRotacao: new Date(hojeBR.getTime() + 86400000),
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

            res.json({ 
                success: true, 
                message: 'Novo código gerado com sucesso',
                data: {
                    codigo: config.codigoSecretoEscola
                }
            });
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

    async validateCode(code) {
        let config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
        if (!config) {
            // Cria código seguro com caracteres mistos
            const novoCodigo = this.generateCode();
            config = await SecurityConfig.create({
                codigoSecretoEscola: novoCodigo,
                dataUltimaRotacao: new Date(),
                rotacaoAutomatica: true
            });
            console.log(`🔑 [SECURITY] Código secreto criado: ${novoCodigo}`);
        }
        // Comparação case-sensitive (o código tem maiúsculas e minúsculas)
        return config.codigoSecretoEscola === String(code);
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

    // --------------------------------------------------
    // Diretor: gerar código personalizado para cadastro de professores
    // --------------------------------------------------
    async generateDirectorCode(req, res) {
        try {
            // Apenas diretores autenticados podem acessar (middleware garante)
            const { length = 8 } = req.body; // opcional, tamanho do código
            const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
            let code = '';
            for (let i = 0; i < length; i++) {
                const randomIdx = crypto.randomInt(charset.length);
                code += charset[randomIdx];
            }
            // Atualiza a configuração geral com o novo código
            let config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
            if (!config) {
                config = await SecurityConfig.create({
                    codigoSecretoEscola: code,
                    dataUltimaRotacao: new Date(),
                    rotacaoAutomatica: false
                });
            } else {
                config.codigoSecretoEscola = code;
                config.dataUltimaRotacao = new Date();
                config.rotacaoAutomatica = false;
                await config.save();
            }
            console.log(`🔐 [SECURITY] Diretor gerou código personalizado: ${code}`);
            // Notifica admins sobre a geração do código
            const admins = await Usuario.find({ perfil: 'admin', ativo: true }).select('email').lean();
            const adminEmails = admins.map(a => a.email);
            await notificarRotacaoCodigo(adminEmails, code, req.user.nome || 'Diretor');
            res.json({ success: true, codigo: code, mensagem: 'Código gerado com sucesso.' });
        } catch (e) {
            console.error('[SECURITY] Erro ao gerar código pelo diretor:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    }
}

module.exports = new SecurityController();
