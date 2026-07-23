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
        console.log(`🔐 [SECURITY] Código rotacionado por ${autor}.`);

        // Multi-escola (transição): mantém o código da escola ativa única em
        // sincronia com o código global, para os dois continuarem válidos.
        try {
            const Escola = require('../models/Escola');
            const ativas = await Escola.find({ ativo: true }).select('_id').limit(2);
            if (ativas.length === 1) {
                await Escola.updateOne({ _id: ativas[0]._id }, { $set: { codigoSecreto: novoCodigo } });
            }
        } catch (e) {
            console.error('[SECURITY] Falha ao sincronizar código com a escola ativa:', e.message);
        }

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
     * Valida o código secreto de cadastro.
     *
     * Multi-escola:
     * - Com `escolaId`: o código deve bater com o codigoSecreto DAQUELA escola
     *   (evita inconsistência entre a escola clicada no modal e o código digitado).
     * - Sem `escolaId`: o código identifica a escola automaticamente
     *   (busca Escola por codigoSecreto).
     * - Transição/legado: o código global (CONFIG_GERAL, rotação diária)
     *   continua aceito e resolve para a escola ativa única (Jaguari).
     *
     * Retorno: `false` se inválido; senão um objeto `{ escola }` onde
     * `escola` é o doc da Escola resolvida (ou `null` no modo legado puro,
     * quando ainda não há escolas cadastradas). Truthy = válido, preservando
     * os callers que fazem `if (!isValidCode)`.
     */
    async validateCode(code, escolaId = null) {
        const Escola = require('../models/Escola');
        const codeStr = String(code);

        // Código global legado (rotacionado diariamente)
        let config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
        if (!config) {
            const novoCodigo = this.generateCode();
            config = await SecurityConfig.create({
                codigoSecretoEscola: novoCodigo,
                dataUltimaRotacao: new Date(),
                rotacaoAutomatica: true
            });
            console.log('🔑 [SECURITY] Código secreto global criado.');
        }
        const matchGlobal = config.codigoSecretoEscola === codeStr;

        // 1. Escola pré-selecionada (clique no modal): código deve ser DELA
        if (escolaId) {
            const escola = await Escola.findById(escolaId).select('+codigoSecreto nome ativo').catch(() => null);
            if (!escola || !escola.ativo) return false;
            if (escola.codigoSecreto === codeStr) return { escola };
            // Transição: código global vale para a escola ativa única
            if (matchGlobal) {
                const ativas = await Escola.countDocuments({ ativo: true });
                if (ativas === 1) return { escola };
            }
            return false;
        }

        // 2. Sem escola pré-selecionada: o código identifica a escola
        const escolaPorCodigo = await Escola.findOne({ codigoSecreto: codeStr, ativo: true }).select('+codigoSecreto nome ativo');
        if (escolaPorCodigo) return { escola: escolaPorCodigo };

        // 3. Legado: código global → escola ativa única (ou nenhuma escola cadastrada)
        if (matchGlobal) {
            const ativas = await Escola.find({ ativo: true }).select('nome').limit(2);
            if (ativas.length === 1) return { escola: ativas[0] };
            if (ativas.length === 0) return { escola: null }; // pré-migração
        }
        return false;
    }

    /**
     * Valida o código enviado via POST público
     */
    async validateCodePublic(req, res) {
        try {
            const { codigo, escolaId } = req.body;
            if (!codigo) {
                return res.status(400).json({ success: false, error: 'Código não fornecido.' });
            }
            const result = await this.validateCode(codigo, escolaId || null);
            res.json({
                success: true,
                valid: !!result,
                // Nome da escola identificada pelo código (para feedback no cadastro)
                escolaNome: (result && result.escola && result.escola.nome) || null
            });
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
