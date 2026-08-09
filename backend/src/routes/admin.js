/**
 * admin.js — rotas administrativas de diagnóstico
 * ============================================================================
 * Montado em /api/admin com authJWT + authorize('admin') no api.js.
 *
 * O que entra aqui: ferramenta de operação que só o administrador usa para
 * descobrir POR QUE algo do sistema não está funcionando. O que NÃO entra:
 * qualquer coisa que devolva dado de aluno, nota ou frequência — isso tem
 * rota própria, com filtro de escola.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();

// Importado como MÓDULO, não desestruturado. A desestruturação captura a
// referência da função no momento do require, o que torna o envio impossível
// de substituir em teste — e, pior, fazia a suíte bater na API real do
// provedor: lenta, sujeita à rede e gastando cota a cada execução.
// Com acesso por propriedade, a resolução acontece na hora da chamada.
const EnvioEmail = require('../services/EnvioEmail');
const { mascarar } = EnvioEmail;
const logger = require('../utils/logger');

/**
 * GET /api/admin/diag/email
 *
 * Responde a pergunta "o e-mail está saindo?" com a mensagem REAL do provedor.
 * Antes essa informação não existia em lugar nenhum: os erros de envio caíam em
 * `.catch(console.error)` dentro de um fluxo fire-and-forget, e o único sintoma
 * visível era diretor e secretaria não conseguirem entrar.
 *
 * Duas etapas, reportadas separadamente:
 *   1. `verificacao` — a configuração está completa e a credencial é aceita?
 *   2. `envio`       — uma mensagem real chega a um destinatário real?
 *
 * `?para=` escolhe o destinatário do teste; sem ele, usa o e-mail do próprio
 * admin autenticado. Nunca aceita destinatário sem sessão de admin: seria um
 * relay aberto para spam sair do domínio da escola.
 *
 * `?enviar=false` roda só a etapa 1 — útil para checar configuração sem gastar
 * cota do provedor.
 */
router.get('/diag/email', async (req, res) => {
    const destinatario = (req.query.para && String(req.query.para)) || req.user?.email || '';
    const deveEnviar = String(req.query.enviar || 'true') !== 'false';

    logger.info('[diag] Diagnóstico de e-mail solicitado', {
        por: mascarar(req.user?.email || ''), destinatario: mascarar(destinatario),
        action: 'admin.diag.email',
    });

    const verificacao = await EnvioEmail.verificarEnvio();

    if (!verificacao.ok) {
        return res.status(503).json({
            ok: false,
            etapa: verificacao.etapa,
            transporte: verificacao.transporte,
            erro: verificacao.erro,
            // Dica acionável: o erro cru do provedor raramente diz o que fazer.
            sugestao: sugerir(verificacao),
        });
    }

    if (!deveEnviar) {
        return res.json({ ok: true, etapa: 'verificacao', transporte: verificacao.transporte, remetente: verificacao.remetente });
    }

    if (!destinatario.includes('@')) {
        return res.status(400).json({
            ok: false, etapa: 'configuracao',
            erro: 'Sem destinatário: informe ?para=alguem@dominio.com ou cadastre um e-mail na sua conta.',
        });
    }

    const envio = await EnvioEmail.enviarEmail(
        destinatario,
        'Teste de entrega — Sistema Escolar',
        `<div style="font-family:Arial,sans-serif;max-width:480px;padding:24px;">
            <h2 style="color:#1a56db;">Canal de e-mail funcionando</h2>
            <p>Esta mensagem foi disparada por <strong>GET /api/admin/diag/email</strong>.</p>
            <p style="color:#666;font-size:14px;">Se você recebeu isto, o envio de códigos 2FA também deve funcionar.</p>
        </div>`
    );

    return res.status(envio.ok ? 200 : 502).json({
        ok: envio.ok,
        etapa: envio.etapa,
        transporte: envio.transporte,
        remetente: verificacao.remetente,
        destinatario: mascarar(destinatario),
        messageId: envio.messageId,
        duracaoMs: envio.duracaoMs,
        erro: envio.erro,
        sugestao: envio.ok ? undefined : sugerir(envio),
    });
});

/**
 * GET /api/admin/diag/contas-2fa
 *
 * Contas que EXIGEM 2FA por e-mail mas não têm um e-mail utilizável. Um código
 * enviado para um endereço ausente ou malformado é recusado pelo provedor e,
 * no caminho antigo, a falha não aparecia em lugar nenhum — a conta
 * simplesmente não conseguia entrar.
 *
 * Devolve o e-mail MASCARADO. Uma rota de diagnóstico não precisa despejar a
 * lista de endereços da equipe para provar que existe um problema.
 */
router.get('/diag/contas-2fa', async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');

        // Mesmos perfis que o login trata como 2FA obrigatório.
        const contas = await Usuario.find({
            ativo: true,
            $or: [{ perfil: { $in: ['diretor', 'secretaria'] } }, { twoFactorEnabled: true }],
        }).select('email nome perfil').lean();

        const valido = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
        const problemas = contas
            .filter((c) => !valido(c.email))
            .map((c) => ({ id: String(c._id), perfil: c.perfil, email: mascarar(c.email || '') || '(vazio)' }));

        return res.json({
            ok: problemas.length === 0,
            totalContas2FA: contas.length,
            semEmailValido: problemas.length,
            contas: problemas,
            sugestao: problemas.length
                ? 'Estas contas não conseguem receber o código 2FA. Cadastre um e-mail válido antes de tentar o login.'
                : undefined,
        });
    } catch (e) {
        logger.error('[diag] Falha ao auditar contas 2FA', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao consultar contas.' });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// CÓDIGOS DE BACKUP DO 2FA
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/2fa/backup-codes/:usuarioId
 *
 * Gera 8 códigos de uso único para uma conta e os devolve EM TEXTO PURO —
 * a única vez em que eles existem legíveis. No banco vai apenas o hash scrypt;
 * nem o administrador consegue relê-los depois. Perdeu, gera outro lote.
 *
 * Existe para o caso em que o segundo fator por e-mail está indisponível: sem
 * isso, uma falha do provedor de e-mail tranca diretor e secretaria fora do
 * sistema sem nenhum caminho de volta.
 *
 * Gerar um lote INVALIDA o lote anterior por completo. Acumular lotes deixaria
 * códigos antigos — possivelmente impressos e esquecidos numa gaveta — valendo
 * para sempre.
 */
router.post('/2fa/backup-codes/:usuarioId', async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const { gerarLote, QUANTIDADE_PADRAO } = require('../utils/codigosBackup');
        const { logAction } = require('../utils/auditHelper');

        const usuario = await Usuario.findById(req.params.usuarioId).select('email nome perfil ativo').lean();
        if (!usuario) {
            return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });
        }

        const { codigos, registros } = await gerarLote(QUANTIDADE_PADRAO);

        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorBackupCodes: registros,
            twoFactorBackupGeradoEm: new Date(),
        });

        // Auditoria: quem gerou, para quem, quando. A geração de um segundo
        // fator alternativo é exatamente o tipo de evento que precisa ficar
        // registrado — inclusive para detectar um administrador comprometido
        // fabricando acesso a contas alheias.
        await logAction(req, 'BACKUP_CODES_GERADOS', 'Segurança', {
            recursoId: usuario._id,
            descricao: `${QUANTIDADE_PADRAO} códigos de backup gerados para ${mascarar(usuario.email)} (${usuario.perfil})`,
        });
        logger.warn('[2FA] Códigos de backup gerados', {
            alvo: mascarar(usuario.email), perfil: usuario.perfil,
            por: mascarar(req.user?.email || ''), action: 'admin.2fa.backupCodes',
        });

        return res.json({
            ok: true,
            usuario: { id: String(usuario._id), nome: usuario.nome, email: mascarar(usuario.email), perfil: usuario.perfil },
            codigos,
            aviso: 'Estes códigos aparecem UMA ÚNICA VEZ. Entregue-os por um canal '
                 + 'separado da senha (impresso, pessoalmente ou por telefone) e não '
                 + 'os envie no mesmo e-mail ou mensagem em que a senha foi enviada. '
                 + 'Cada código funciona uma vez só. Gerar um lote novo invalida este.',
        });
    } catch (e) {
        logger.error('[2FA] Falha ao gerar códigos de backup', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao gerar códigos de backup.' });
    }
});

/**
 * GET /api/admin/2fa/backup-codes/:usuarioId
 *
 * Quantos códigos ainda restam. NÃO devolve os códigos — eles não existem mais
 * em texto puro em lugar nenhum. Serve para saber quando gerar um lote novo.
 */
router.get('/2fa/backup-codes/:usuarioId', async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const usuario = await Usuario.findById(req.params.usuarioId)
            .select('email perfil +twoFactorBackupCodes +twoFactorBackupGeradoEm')
            .lean();

        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        const lote = usuario.twoFactorBackupCodes || [];
        const disponiveis = lote.filter((c) => !c.usadoEm).length;

        return res.json({
            ok: true,
            usuario: { email: mascarar(usuario.email), perfil: usuario.perfil },
            total: lote.length,
            disponiveis,
            usados: lote.length - disponiveis,
            geradoEm: usuario.twoFactorBackupGeradoEm || null,
            sugestao: disponiveis === 0 && lote.length
                ? 'Todos os códigos foram usados. Gere um lote novo antes que a conta fique sem alternativa ao e-mail.'
                : undefined,
        });
    } catch (e) {
        logger.error('[2FA] Falha ao consultar códigos de backup', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao consultar códigos.' });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// CÓDIGO FIXO DE 2FA
// ────────────────────────────────────────────────────────────────────────────
// Alternativa MAIS FRACA que os códigos de backup, exposta aqui porque a
// operação pediu: enquanto o provedor de e-mail está bloqueado, um código
// reutilizável é mais simples de administrar do que reemitir lotes.
//
// A diferença, dita por extenso: um código de uso único queima ao ser usado;
// um código fixo é uma segunda senha permanente de 6 dígitos. Quem o vir uma
// vez entra sempre, até alguém trocá-lo. A interface diz isso na tela.
//
// Guardado como hash scrypt, como todo o resto — antes deste trabalho ele
// ficava em TEXTO PURO no banco e havia um valor escrito no código-fonte.

/**
 * POST /api/admin/2fa/codigo-fixo/:usuarioId
 * Body opcional: { codigo: '123456' } — sem ele, gera aleatório.
 * Devolve o código em texto puro UMA vez.
 */
router.post('/2fa/codigo-fixo/:usuarioId', async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const { hashSegredo } = require('../utils/codigosBackup');
        const { logAction } = require('../utils/auditHelper');
        const crypto = require('crypto');

        const usuario = await Usuario.findById(req.params.usuarioId).select('email nome perfil').lean();
        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        const informado = req.body && req.body.codigo != null ? String(req.body.codigo).trim() : '';
        if (informado && !/^\d{6}$/.test(informado)) {
            return res.status(400).json({ ok: false, erro: 'O código fixo precisa ter exatamente 6 dígitos.' });
        }

        // Aleatório por padrão: código escolhido à mão tende a ser data de
        // nascimento, sequência ou repetição — e este vale até ser trocado.
        const codigo = informado || String(crypto.randomInt(0, 1000000)).padStart(6, '0');

        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorFixedCode: await hashSegredo(codigo),
            twoFactorEnabled: true,
        });

        await logAction(req, 'CODIGO_FIXO_2FA_DEFINIDO', 'Segurança', {
            recursoId: usuario._id,
            descricao: `Código fixo de 2FA definido para ${mascarar(usuario.email)} (${usuario.perfil})`
                     + (informado ? ' — valor escolhido pelo administrador' : ' — valor aleatório'),
        });
        logger.warn('[2FA] Código fixo definido', {
            alvo: mascarar(usuario.email), perfil: usuario.perfil,
            por: mascarar(req.user?.email || ''), escolhido: Boolean(informado),
            action: 'admin.2fa.codigoFixo',
        });

        return res.json({
            ok: true,
            usuario: { nome: usuario.nome, perfil: usuario.perfil, email: mascarar(usuario.email) },
            codigo,
            aviso: 'Este código aparece UMA ÚNICA VEZ — no banco fica apenas o hash. '
                 + 'Ele é REUTILIZÁVEL: quem o vir uma vez entra sempre, até ser trocado. '
                 + 'Entregue por um canal separado da senha e remova assim que o e-mail voltar.',
        });
    } catch (e) {
        logger.error('[2FA] Falha ao definir código fixo', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao definir o código fixo.' });
    }
});

/** GET — existe código fixo nesta conta? Nunca devolve o valor. */
router.get('/2fa/codigo-fixo/:usuarioId', async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const { ehFormatoLegado } = require('../utils/codigosBackup');

        const usuario = await Usuario.findById(req.params.usuarioId)
            .select('email perfil +twoFactorFixedCode').lean();
        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        const valor = usuario.twoFactorFixedCode;
        return res.json({
            ok: true,
            definido: Boolean(valor),
            // Valor de antes da migração: está em texto puro e o login o
            // RECUSA. Precisa ser regerado, senão a conta parece protegida e
            // não consegue entrar.
            legado: ehFormatoLegado(valor),
        });
    } catch (e) {
        logger.error('[2FA] Falha ao consultar código fixo', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao consultar.' });
    }
});

/** DELETE — remove o código fixo. A conta volta ao e-mail / códigos de backup. */
router.delete('/2fa/codigo-fixo/:usuarioId', async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const { logAction } = require('../utils/auditHelper');

        const usuario = await Usuario.findById(req.params.usuarioId).select('email perfil').lean();
        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        await Usuario.updateOne({ _id: usuario._id }, { $unset: { twoFactorFixedCode: '' } });

        await logAction(req, 'CODIGO_FIXO_2FA_REMOVIDO', 'Segurança', {
            recursoId: usuario._id,
            descricao: `Código fixo de 2FA removido de ${mascarar(usuario.email)} (${usuario.perfil})`,
        });

        return res.json({ ok: true, mensagem: 'Código fixo removido. A conta volta ao código por e-mail ou de backup.' });
    } catch (e) {
        logger.error('[2FA] Falha ao remover código fixo', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao remover.' });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// RECUPERAÇÃO DE SENHA DISPARADA PELO ADMIN
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/recuperacao-senha/:usuarioId
 *
 * Dispara o MESMO fluxo do "Esqueci minha senha" da tela de login, só que
 * iniciado pelo administrador — para quando a pessoa liga dizendo que não
 * consegue entrar e não sabe achar o link sozinha.
 *
 * O código vai para o e-mail DO USUÁRIO e não volta na resposta. Isso é
 * deliberado: se o administrador pudesse ler o código, ele trocaria a senha de
 * qualquer conta sem deixar de fora a pessoa dona dela — e a auditoria diria
 * apenas "senha alterada", sem distinguir uso legítimo de tomada de conta.
 * Mantendo a entrega no e-mail do titular, quem redefine é sempre quem tem
 * acesso à caixa dele.
 *
 * Reaproveita `UserController.forgotPassword` inteiro em vez de duplicar a
 * geração: um segundo caminho de recuperação divergiria do primeiro na próxima
 * correção de segurança, e o mais frouxo dos dois é o que valeria.
 */
router.post('/recuperacao-senha/:usuarioId', async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const { logAction } = require('../utils/auditHelper');

        const usuario = await Usuario.findById(req.params.usuarioId).select('email nome perfil ativo').lean();
        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        if (!usuario.email || !usuario.email.includes('@')) {
            return res.status(422).json({
                ok: false,
                erro: 'Esta conta não tem e-mail válido cadastrado — não há para onde enviar o código.',
            });
        }
        if (usuario.ativo === false) {
            return res.status(409).json({ ok: false, erro: 'Conta desativada. Reative antes de recuperar a senha.' });
        }

        await logAction(req, 'RECUPERACAO_SENHA_ADMIN', 'Segurança', {
            recursoId: usuario._id,
            descricao: `Recuperação de senha disparada pelo admin para ${mascarar(usuario.email)} (${usuario.perfil})`,
        });

        // Delega ao fluxo público. `forgotPassword` responde por conta própria
        // com a mensagem anti-enumeração; aqui trocamos por uma resposta útil,
        // já que o alvo foi escolhido por um admin autenticado e não há e-mail
        // a proteger de enumeração.
        // `forgotPassword` só lê `req.body.email` e escreve na resposta. Um
        // objeto mínimo basta e é mais robusto que clonar o `req` real — um
        // clone parcial de Request quebra em silêncio quando o handler passa a
        // usar um campo que o clone não copiou.
        const UserController = require('../controllers/UserController');
        let falhou = null;
        const respostaCapturada = {
            statusCode: 200,
            status(codigo) { this.statusCode = codigo; return this; },
            json(corpo) {
                if (this.statusCode >= 400 || (corpo && corpo.success === false)) {
                    falhou = (corpo && corpo.error) || `HTTP ${this.statusCode}`;
                }
                return this;
            },
        };

        await UserController.forgotPassword({ body: { email: usuario.email } }, respostaCapturada);

        if (falhou) {
            return res.status(502).json({ ok: false, erro: falhou });
        }

        return res.json({
            ok: true,
            destinatario: mascarar(usuario.email),
            validadeMinutos: 15,
            mensagem: `Código de recuperação enviado para ${mascarar(usuario.email)}. `
                    + 'Ele vale 15 minutos e chega apenas na caixa do próprio usuário — '
                    + 'oriente a pessoa a abrir o e-mail e usar a opção "Esqueci minha senha" na tela de login.',
        });
    } catch (e) {
        logger.error('[recuperacao] Falha ao disparar recuperação pelo admin', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao disparar a recuperação de senha.' });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// 2FA OBRIGATÓRIO — ativação com trava contra auto-trancamento
// ────────────────────────────────────────────────────────────────────────────
// Exigir segundo fator de uma conta administrativa é a operação com o pior
// modo de falha do sistema inteiro: se o canal de e-mail estiver quebrado e a
// conta não tiver códigos de backup, o próximo login falha e NÃO HÁ NINGUÉM
// dentro para desfazer. O conserto vira acesso direto ao banco de produção.
//
// Por isso a ativação não é um interruptor: é um procedimento com pré-voo.

/**
 * GET /api/admin/2fa/prontidao/:usuarioId
 *
 * Responde "posso exigir 2FA desta conta sem trancá-la para fora?".
 * Três condições, verificadas de verdade — não presumidas:
 *   1. a conta tem e-mail válido cadastrado;
 *   2. o canal de e-mail está operacional AGORA (não "estava no boot");
 *   3. existem códigos de backup disponíveis, caso (2) caia depois.
 */
router.get('/2fa/prontidao/:usuarioId', async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const politica = require('../utils/politica2FA');

        const usuario = await Usuario.findById(req.params.usuarioId)
            .select('email nome perfil ativo twoFactorEnabled +twoFactorBackupCodes +twoFactorFixedCode')
            .lean();
        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        const emailValido = typeof usuario.email === 'string'
            && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(usuario.email);

        // Checagem VIVA do canal, sem enviar mensagem. Confiar no resultado do
        // boot seria confiar num estado de horas atrás — e o provedor pode ter
        // bloqueado a conta nesse meio-tempo, que foi exatamente o que houve.
        const canal = await EnvioEmail.verificarEnvio();

        const disponiveis = (usuario.twoFactorBackupCodes || []).filter((c) => !c.usadoEm).length;

        // BLOQUEIO x AVISO — a distinção importa, e errar nela é perigoso.
        //
        // A ausência de códigos de backup NÃO bloqueia: a própria ativação gera
        // um lote novo. Tratá-la como bloqueio criava uma armadilha real — o
        // administrador ia à primeira aba, gerava um lote, IMPRIMIA, e então a
        // ativação gerava OUTRO lote, invalidando a folha que ele acabara de
        // guardar. Ficaria com um papel de códigos mortos, acreditando ter uma
        // rede de segurança que não existe mais.
        //
        // Bloqueio é só o que a ativação não consegue resolver sozinha: e-mail
        // ausente na conta e canal de entrega fora do ar.
        const bloqueios = [];
        if (!emailValido) bloqueios.push('A conta não tem e-mail válido cadastrado — o código não teria para onde ir.');
        if (!canal.ok) bloqueios.push(`O canal de e-mail não está operacional (${canal.etapa}): ${canal.erro}`);

        const avisos = [];
        if (!disponiveis) {
            avisos.push('Esta conta ainda não tem códigos de backup. A ativação vai gerar 8 — '
                      + 'não precisa gerar antes, ou a folha impressa seria invalidada pela ativação.');
        }

        return res.json({
            ok: bloqueios.length === 0,
            usuario: {
                id: String(usuario._id), nome: usuario.nome, perfil: usuario.perfil,
                email: mascarar(usuario.email || ''),
            },
            jaExige: politica.exigeSegundoFator(usuario),
            verificacoes: {
                emailValido,
                canalOperacional: canal.ok,
                codigosBackupDisponiveis: disponiveis,
                temCodigoFixo: Boolean(usuario.twoFactorFixedCode),
            },
            bloqueios,
            avisos,
            politicaVigente: {
                perfisObrigatorios: politica.perfisComObrigatoriedade(),
                perfisDispensados: politica.perfisDispensados(),
            },
        });
    } catch (e) {
        logger.error('[2FA] Falha na checagem de prontidão', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao verificar prontidão.' });
    }
});

/**
 * POST /api/admin/2fa/ativar/:usuarioId
 *
 * Liga o segundo fator NA CONTA (`twoFactorEnabled`) e devolve, na mesma
 * resposta, 8 códigos de backup recém-gerados — a única vez em que existem
 * legíveis. Ativar sem entregar a rede de segurança junto seria montar o
 * cenário de trancamento de propósito.
 *
 * RECUSA quando a prontidão falha. `?forcar=true` ignora a recusa, e existe
 * porque há um caso legítimo: ativar sabendo que o e-mail está fora, contando
 * apenas com os códigos de backup impressos. Mas tem de ser uma escolha
 * declarada, não o caminho de menor resistência.
 *
 * Isto é o ROLLOUT POR CONTA. Só depois de validar aqui é que o perfil inteiro
 * entra em PERFIS_2FA_OBRIGATORIO — ver docs/2FA-OBRIGATORIO.md.
 */
router.post('/2fa/ativar/:usuarioId', async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const { gerarLote, QUANTIDADE_PADRAO } = require('../utils/codigosBackup');
        const { logAction } = require('../utils/auditHelper');

        const forcar = String(req.query.forcar || '') === 'true';

        const usuario = await Usuario.findById(req.params.usuarioId).select('email nome perfil ativo').lean();
        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        const emailValido = typeof usuario.email === 'string'
            && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(usuario.email);
        const canal = await EnvioEmail.verificarEnvio();

        if (!forcar && (!emailValido || !canal.ok)) {
            return res.status(409).json({
                ok: false,
                erro: !emailValido
                    ? 'A conta não tem e-mail válido — ativar agora a trancaria fora do sistema.'
                    : `O canal de e-mail não está operacional (${canal.etapa}): ${canal.erro}`,
                sugestao: 'Corrija antes de ativar. Se quiser ativar mesmo assim, apoiado apenas nos '
                        + 'códigos de backup impressos, repita com ?forcar=true.',
            });
        }

        // Códigos ANTES de ligar a exigência: se a geração falhar, a conta
        // continua entrando como entrava. A ordem inversa deixaria uma janela
        // com 2FA exigido e nenhuma rede de segurança.
        const { codigos, registros } = await gerarLote(QUANTIDADE_PADRAO);

        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorBackupCodes: registros,
            twoFactorBackupGeradoEm: new Date(),
            twoFactorEnabled: true,
        });

        await logAction(req, 'TWOFACTOR_ATIVADO', 'Segurança', {
            recursoId: usuario._id,
            descricao: `2FA obrigatório ATIVADO para ${mascarar(usuario.email)} (${usuario.perfil})`
                     + `, com ${QUANTIDADE_PADRAO} códigos de backup`
                     + (forcar ? ' — ATIVAÇÃO FORÇADA, canal de e-mail não validado' : ''),
        });
        logger.warn('[2FA] Segundo fator ativado na conta', {
            alvo: mascarar(usuario.email), perfil: usuario.perfil,
            por: mascarar(req.user?.email || ''), forcado: forcar,
            action: 'admin.2fa.ativado',
        });

        return res.json({
            ok: true,
            usuario: { nome: usuario.nome, perfil: usuario.perfil, email: mascarar(usuario.email) },
            codigos,
            forcado: forcar,
            aviso: 'Segundo fator ATIVADO nesta conta. Guarde os códigos abaixo AGORA — '
                 + 'eles aparecem uma única vez e são a única forma de entrar se o e-mail falhar. '
                 + 'Imprima e guarde fora do computador.',
            proximoPasso: 'Saia, entre de novo com esta conta e confirme que o código chega. '
                        + 'Só depois disso acrescente o perfil em PERFIS_2FA_OBRIGATORIO.',
        });
    } catch (e) {
        logger.error('[2FA] Falha ao ativar segundo fator', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao ativar o segundo fator.' });
    }
});

/**
 * DELETE /api/admin/2fa/ativar/:usuarioId
 *
 * Desliga o `twoFactorEnabled` da conta. NÃO afeta a obrigatoriedade por
 * perfil: se o perfil está em PERFIS_2FA_OBRIGATORIO, a conta continua
 * exigindo segundo fator — e a resposta diz isso, em vez de deixar o
 * administrador achar que desligou e descobrir o contrário no próximo login.
 */
router.delete('/2fa/ativar/:usuarioId', async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const politica = require('../utils/politica2FA');
        const { logAction } = require('../utils/auditHelper');

        const usuario = await Usuario.findById(req.params.usuarioId).select('email perfil').lean();
        if (!usuario) return res.status(404).json({ ok: false, erro: 'Usuário não encontrado.' });

        await Usuario.updateOne({ _id: usuario._id }, { $set: { twoFactorEnabled: false } });

        await logAction(req, 'TWOFACTOR_DESATIVADO', 'Segurança', {
            recursoId: usuario._id,
            descricao: `2FA desativado na conta ${mascarar(usuario.email)} (${usuario.perfil})`,
        });

        const aindaExige = politica.exigeSegundoFator({ perfil: usuario.perfil, twoFactorEnabled: false });

        return res.json({
            ok: true,
            aindaExigePorPerfil: aindaExige,
            mensagem: aindaExige
                ? `Desativado na conta, mas o perfil "${usuario.perfil}" está em PERFIS_2FA_OBRIGATORIO — `
                  + 'a conta CONTINUA exigindo segundo fator. Para dispensá-la de fato, ajuste a variável de ambiente.'
                : 'Segundo fator desativado nesta conta.',
        });
    } catch (e) {
        logger.error('[2FA] Falha ao desativar segundo fator', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao desativar.' });
    }
});

/** Traduz as falhas mais comuns em uma ação concreta. */
function sugerir(resultado) {
    const texto = String(resultado.erro || '').toLowerCase();

    if (texto.includes('email_from')) {
        return 'Defina EMAIL_FROM no Render com um endereço de domínio verificado no provedor.';
    }
    if (texto.includes('domain') || texto.includes('not verified') || texto.includes('verify a domain')) {
        return 'O domínio do EMAIL_FROM não está verificado no provedor. Verifique o domínio ou use o remetente de teste do provedor.';
    }
    if (texto.includes('api key') || texto.includes('unauthorized') || texto.includes('401') || texto.includes('403')) {
        return 'Credencial recusada: confira EMAIL_PASS (chave de API) no Render.';
    }
    if (texto.includes('tempo esgotado') || texto.includes('timeout') || texto.includes('econn')) {
        return resultado.transporte === 'smtp'
            ? 'Conexão SMTP bloqueada — típico de hospedagem. Use uma chave de API (Resend "re_..." ou Brevo "xkeysib-...") em EMAIL_PASS para enviar por HTTPS.'
            : 'O provedor não respondeu a tempo. Tente de novo; se persistir, verifique o status do provedor.';
    }
    if (resultado.transporte === 'nenhum') {
        return 'Nenhum transporte configurado. Defina EMAIL_PASS (chave de API) e EMAIL_FROM no Render.';
    }
    return undefined;
}

module.exports = router;
