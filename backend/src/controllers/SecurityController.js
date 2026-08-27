const SecurityConfig = require('../models/SecurityConfig');
const Usuario = require('../models/Usuario');
const crypto = require('crypto');
const { logAction } = require('../utils/auditHelper');
const { notificarRotacaoCodigo } = require('../utils/emailNotifications');

class SecurityController {
    /**
     * Gera um novo código de cadastro.
     *
     * O ALFABETO NÃO TEM CARACTERES ESPECIAIS — de propósito.
     * ======================================================
     * A versão anterior sorteava de `!@#$%&*_+-=`. Como o código sempre chega
     * ao servidor DENTRO DO CORPO da requisição (validate-code,
     * register-diretor, register-secretaria, escolas/mudar), ele passa antes
     * pela sanitização global do app.js, que roda `sanitize-html` em toda
     * string do body. E ali:
     *     'aB3&xY9'  →  'aB3&amp;xY9'      (reescrito)
     *     'k#7$mQ<w' →  'k#7$mQ'           (truncado!)
     * O valor comparado em `validateCode` nunca batia com o gravado no banco.
     * Com `&` no alfabeto de 73 chars e 10 posições, ~13% dos códigos gerados
     * nasciam INUTILIZÁVEIS — o cadastro rejeitava um código correto e não
     * havia sintoma que apontasse para a causa.
     *
     * Este é o mesmo alfabeto de `gerarCodigoEscola` (routes/escolas.js) e do
     * seed: sem caracteres ambíguos (0/O, 1/I/l), porque o código é ditado por
     * telefone e transcrito à mão. 53^10 ≈ 2^57 de espaço — entropia de sobra
     * para um segredo rotacionável.
     */
    generateCode(length = 10) {
        const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let code = '';
        for (let i = 0; i < length; i++) {
            code += ALFABETO[crypto.randomInt(ALFABETO.length)];
        }
        return code;
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
                rotacaoAutomatica: true,
            });
            console.log('🔑 [SECURITY] Código secreto global criado.');
        }
        const matchGlobal = config.codigoSecretoEscola === codeStr;

        // 1. Escola pré-selecionada (clique no modal): código deve ser DELA
        if (escolaId) {
            const escola = await Escola.findById(escolaId)
                .select('+codigoSecreto nome ativo')
                .catch(() => null);
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
        const escolaPorCodigo = await Escola.findOne({
            codigoSecreto: codeStr,
            ativo: true,
        }).select('+codigoSecreto nome ativo');
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
