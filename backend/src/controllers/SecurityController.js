const SecurityConfig = require('../models/SecurityConfig');
const Usuario = require('../models/Usuario');
const { logAction } = require('../utils/auditHelper');
const { notificarRotacaoCodigo } = require('../utils/emailNotifications');
const { gerarCodigo, validarCodigoEscola } = require('../services/codigoEscolaService');

class SecurityController {
    /**
     * Gera um novo código de cadastro.
     *
     * A regra (inclusive a explicação do alfabeto sem caracteres especiais)
     * mora em `services/codigoEscolaService.js`. Aqui ficou só a fachada, para
     * não quebrar os callers que já chamavam `SecurityController.generateCode()`
     * — index.js, os métodos de rotação abaixo e o teste de sanitização.
     */
    generateCode(length = 10) {
        return gerarCodigo(length);
    }

    /**
     * ESCOPO DO CÓDIGO — por que diretor e admin veem coisas diferentes
     * ================================================================
     * `CONFIG_GERAL` é o código GLOBAL de transição: `validateCode` o aceita
     * para criar conta de diretor E de secretaria na escola ativa. Enquanto
     * getStatus/forceRotate operavam nele para qualquer perfil, o diretor de
     * QUALQUER escola lia e rotacionava a credencial que cria contas de nível
     * gestor — e a rotação afetava a rede inteira.
     *
     * Agora: admin continua no código global; diretor/secretaria operam no
     * `codigoSecreto` da PRÓPRIA escola (mesmo campo que o painel do admin
     * gerencia em /api/escolas/:id/codigo-secreto). O formato da resposta não
     * muda — o frontend segue lendo `data.codigo`.
     */
    async escolaDaSessao(req) {
        if (String(req.user?.perfil || '').toLowerCase() === 'admin') return null;
        if (!req.escolaId) return null;
        const Escola = require('../models/Escola');
        return Escola.findById(String(req.escolaId))
            .select('+codigoSecreto nome ativo')
            .catch(() => null);
    }

    /**
     * Retorna o código atual (Apenas Admin/Diretor)
     */
    async getStatus(req, res) {
        try {
            // Diretor/secretaria: código da própria escola.
            const escola = await this.escolaDaSessao(req);
            if (escola) {
                if (!escola.codigoSecreto) {
                    escola.codigoSecreto = this.generateCode();
                    await escola.save();
                }
                return res.json({
                    success: true,
                    data: {
                        codigo: escola.codigoSecreto,
                        escopo: 'escola',
                        escolaNome: escola.nome,
                        rotacaoAtiva: false,
                    },
                });
            }

            // Falha FECHADA, igual ao forceRotate: sem escola resolvida, um
            // não-admin não cai no código global. LER esse código já é o
            // suficiente para se cadastrar como diretor — é credencial, não
            // informação de status.
            if (String(req.user?.perfil || '').toLowerCase() !== 'admin') {
                return res.status(409).json({
                    success: false,
                    error: 'Não foi possível identificar sua escola. Faça login novamente para ver o código de cadastro.',
                });
            }

            let config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });

            if (!config) {
                config = await SecurityConfig.create({
                    codigoSecretoEscola: this.generateCode(),
                    dataUltimaRotacao: new Date(),
                });
            }

            // Verifica se precisa de rotação automática (meia-noite de Brasília passou?)
            const agora = new Date();
            const hojeBR = new Date(
                agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
            );
            hojeBR.setHours(0, 0, 0, 0);
            const ultimaBR = new Date(
                new Date(config.dataUltimaRotacao).toLocaleString('en-US', {
                    timeZone: 'America/Sao_Paulo',
                })
            );
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
                    rotacaoAtiva: config.rotacaoAutomatica,
                },
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }

    /**
     * Força a rotação do código.
     * Admin → código global (CONFIG_GERAL). Diretor/secretaria → código da
     * própria escola. Ver a nota de escopo em `escolaDaSessao`.
     */
    async forceRotate(req, res) {
        try {
            // Diretor/secretaria: rotaciona SOMENTE a própria escola.
            const escola = await this.escolaDaSessao(req);
            if (escola) {
                escola.codigoSecreto = this.generateCode();
                await escola.save();

                await logAction(req, 'ROTATE_SECRET_CODE', 'Segurança', {
                    recursoId: String(escola._id),
                    descricao: `Código secreto da escola "${escola.nome}" foi alterado manualmente.`,
                });

                return res.json({
                    success: true,
                    message: `Novo código gerado para ${escola.nome}.`,
                    data: {
                        codigo: escola.codigoSecreto,
                        escopo: 'escola',
                        escolaNome: escola.nome,
                    },
                });
            }

            // Sem contexto de escola resolvido e não sendo admin: falha fechada.
            // Cair no código global aqui era exatamente o furo — um diretor sem
            // tenant resolvido rotacionava a credencial de cadastro da rede.
            if (String(req.user?.perfil || '').toLowerCase() !== 'admin') {
                return res.status(409).json({
                    success: false,
                    error: 'Não foi possível identificar sua escola. Faça login novamente antes de gerar um novo código.',
                });
            }

            let config = await SecurityConfig.findOne({ chave: 'CONFIG_GERAL' });
            if (!config) {
                config = await SecurityConfig.create({
                    codigoSecretoEscola: this.generateCode(),
                    dataUltimaRotacao: new Date(),
                    rotacaoAutomatica: true,
                });
            }
            await this.rotateCodeInternal(config, req.user.nome);

            await logAction(req, 'ROTATE_SECRET_CODE', 'Segurança', {
                descricao: 'Código secreto GLOBAL foi alterado manualmente',
            });

            res.json({
                success: true,
                message: 'Novo código gerado com sucesso',
                data: {
                    codigo: config.codigoSecretoEscola,
                },
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
            data: config.dataUltimaRotacao,
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
                await Escola.updateOne(
                    { _id: ativas[0]._id },
                    { $set: { codigoSecreto: novoCodigo } }
                );
            }
        } catch (e) {
            console.error('[SECURITY] Falha ao sincronizar código com a escola ativa:', e.message);
        }

        // Notifica admins
        try {
            const admins = await Usuario.find({ perfil: 'admin', ativo: true })
                .select('email')
                .lean();
            const adminEmails = admins.map((a) => a.email);
            await notificarRotacaoCodigo(adminEmails, novoCodigo, autor);
        } catch (err) {
            console.error('[SECURITY] Erro ao notificar admins sobre rotação:', err.message);
        }
    }

    /**
     * Valida o código secreto de cadastro.
     *
     * A regra mora em `services/codigoEscolaService.js` — inclusive a
     * explicação do comportamento multi-escola e do modo legado. Este método é
     * a fachada para os callers HTTP (UserController, routes/escolas.js) e
     * mantém o contrato de retorno intacto: `false` quando inválido, `{ escola }`
     * quando válido.
     */
    async validateCode(code, escolaId = null) {
        return validarCodigoEscola(code, escolaId);
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
                escolaNome: (result && result.escola && result.escola.nome) || null,
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    }

    // NOTA: `generateDirectorCode` foi REMOVIDO.
    //
    // Era um handler nunca roteado (nenhuma rota, nenhum caller no backend nem
    // no frontend) que sobrescrevia o código GLOBAL de cadastro e ainda desligava
    // a rotação automática (`rotacaoAutomatica: false`), deixando o código
    // congelado indefinidamente. Handler privilegiado e órfão é só um convite
    // a ser religado sem revisão. Quem precisa gerar código por escola usa
    // `forceRotate` (escopado acima) ou, como admin,
    // POST /api/escolas/:escolaId/codigo-secreto.
}

module.exports = new SecurityController();
