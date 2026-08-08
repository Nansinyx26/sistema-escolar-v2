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

const { enviarEmail, verificarEnvio, mascarar } = require('../services/EnvioEmail');
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

    const verificacao = await verificarEnvio();

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

    const envio = await enviarEmail(
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
