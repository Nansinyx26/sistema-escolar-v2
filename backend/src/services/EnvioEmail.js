/**
 * EnvioEmail.js — camada única de envio de e-mail
 * ============================================================================
 * INTERFACE PÚBLICA (é só isto que o resto do sistema deve conhecer):
 *
 *     const { enviarEmail, verificarEnvio } = require('../services/EnvioEmail');
 *     const r = await enviarEmail(para, assunto, html);   // { ok, messageId, etapa, erro }
 *
 * Trocar de provedor custa um arquivo: este.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA CAMADA PRECISOU EXISTIR
 * ─────────────────────────────────────────────────────────────────────────
 * O código tinha CINCO `nodemailer.createTransport` independentes, com defaults
 * divergentes — um deles apontando para `smtp.mailtrap.io:2525`, que engole a
 * mensagem e nunca entrega a ninguém. Não havia `verify()` em lugar nenhum e os
 * envios do 2FA eram disparados sem `await`, com o erro caindo num
 * `.catch(console.error)`: a resposta HTTP dizia "código enviado" mesmo quando
 * nada saiu. Foi por isso que diretor e secretaria ficaram sem conseguir entrar
 * e ninguém viu erro nenhum.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE HTTPS E NÃO SMTP
 * ─────────────────────────────────────────────────────────────────────────
 * O Render bloqueia conexão SMTP de saída. O próprio repositório já sabia
 * disso: utils/nodemailerPatch.js existe só para desviar o envio pela API HTTP
 * do Brevo, com o comentário "contorna bloqueio SMTP do Render". Só que aquele
 * desvio testava `EMAIL_HOST.includes('brevo')` — e a produção está configurada
 * com Resend, então caía direto no SMTP bloqueado.
 *
 * Aqui a ordem é: API HTTPS sempre que a chave permitir (Resend ou Brevo),
 * SMTP apenas como último recurso. HTTPS/443 não é bloqueado por hospedagem
 * nenhuma, o que faz o "Plano B" do pedido virar o caminho principal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O REMETENTE
 * ─────────────────────────────────────────────────────────────────────────
 * Sem EMAIL_FROM o código caía em `noreply@escola.com` — domínio que ninguém
 * verificou em provedor nenhum. Resend e Brevo RECUSAM enviar como um remetente
 * não verificado, e essa recusa vinha em silêncio pelo caminho fire-and-forget.
 * Agora a ausência de EMAIL_FROM é reportada como erro de CONFIGURAÇÃO, com
 * nome, na rota de diagnóstico e no boot.
 * ============================================================================
 */

const https = require('https');
const logger = require('../utils/logger');

const TIMEOUT_MS = 15000;

// ── Configuração ────────────────────────────────────────────────────────────

function config() {
    const chave = (process.env.EMAIL_PASS || '').trim();
    return {
        chave,
        host: (process.env.EMAIL_HOST || '').trim(),
        porta: parseInt(process.env.EMAIL_PORT, 10) || null,
        usuario: (process.env.EMAIL_USER || '').trim(),
        remetente: (process.env.EMAIL_FROM || '').trim(),
    };
}

/**
 * Qual transporte usar. A chave do provedor é auto-identificável pelo prefixo,
 * então não dependemos de mais uma variável de ambiente para escolher — uma a
 * menos para configurar errado.
 */
function transporteEscolhido() {
    const { chave, host } = config();
    if (chave.startsWith('re_')) return 'resend-api';
    if (chave.startsWith('xsmtpsib-') || chave.startsWith('xkeysib-')) return 'brevo-api';
    if (host) return 'smtp';
    return 'nenhum';
}

/** `"Nome" <a@b.com>` → { nome, email }. Aceita também o e-mail cru. */
function separarRemetente(valor) {
    const m = /^(.*?)\s*<(.+?)>\s*$/.exec(valor || '');
    if (m) return { nome: m[1].replace(/["']/g, '').trim() || 'Sistema Escolar', email: m[2].trim() };
    return { nome: 'Sistema Escolar', email: (valor || '').trim() };
}

/** Nunca logamos o destinatário inteiro: e-mail de menor/responsável é dado pessoal. */
function mascarar(email) {
    if (typeof email !== 'string') return '';
    return email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
}

// ── Transporte HTTPS genérico ───────────────────────────────────────────────

function requisicaoJson({ hostname, path, headers, corpo }) {
    return new Promise((resolve, reject) => {
        const dados = JSON.stringify(corpo);
        const req = https.request({
            hostname,
            port: 443,
            path,
            method: 'POST',
            timeout: TIMEOUT_MS,
            headers: Object.assign({
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(dados),
            }, headers),
        }, (res) => {
            let bruto = '';
            res.on('data', (c) => { bruto += c; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(bruto); } catch (e) { /* resposta não-JSON */ }
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    return resolve({ status: res.statusCode, json });
                }
                // A mensagem REAL do provedor é o que resolve o chamado. Um
                // "HTTP 403" sem corpo obrigaria a adivinhar entre chave errada,
                // domínio não verificado e destinatário recusado.
                const motivo = (json && (json.message || json.error || json.name))
                    || String(bruto).slice(0, 300)
                    || `HTTP ${res.statusCode}`;
                reject(Object.assign(new Error(motivo), { status: res.statusCode, corpo: json }));
            });
        });

        req.on('timeout', () => req.destroy(new Error(`Tempo esgotado (${TIMEOUT_MS}ms)`)));
        req.on('error', reject);
        req.write(dados);
        req.end();
    });
}

// ── Provedores ──────────────────────────────────────────────────────────────

async function viaResend(para, assunto, html) {
    const { chave, remetente } = config();
    const r = await requisicaoJson({
        hostname: 'api.resend.com',
        path: '/emails',
        headers: { Authorization: `Bearer ${chave}` },
        corpo: { from: remetente, to: [para], subject: assunto, html },
    });
    return (r.json && r.json.id) || null;
}

async function viaBrevo(para, assunto, html) {
    const { chave, remetente } = config();
    const de = separarRemetente(remetente);
    const r = await requisicaoJson({
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        headers: { 'api-key': chave },
        corpo: {
            sender: { name: de.nome, email: de.email },
            to: [{ email: para }],
            subject: assunto,
            htmlContent: html,
        },
    });
    return (r.json && r.json.messageId) || null;
}

let transporterSmtp = null;
function smtp() {
    if (transporterSmtp) return transporterSmtp;
    const nodemailer = require('nodemailer');
    const { host, porta, usuario, chave } = config();
    const portaFinal = porta || 587;
    transporterSmtp = nodemailer.createTransport({
        host,
        port: portaFinal,
        // 465 é TLS implícito; 587 é STARTTLS (secure=false + upgrade).
        // A porta 25 é bloqueada em toda hospedagem e não deve ser usada.
        secure: portaFinal === 465,
        auth: usuario ? { user: usuario, pass: chave } : undefined,
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
    });
    return transporterSmtp;
}

async function viaSmtp(para, assunto, html) {
    const { remetente } = config();
    const info = await smtp().sendMail({ from: remetente, to: para, subject: assunto, html });
    return info && info.messageId;
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Envia um e-mail. NUNCA lança: devolve o resultado para o chamador decidir.
 *
 * @returns {Promise<{ok:boolean, messageId?:string, etapa:string, erro?:string, duracaoMs:number, transporte:string}>}
 *   `etapa` diz ONDE parou — 'configuracao', 'envio' ou 'concluido' — que é a
 *   primeira pergunta de qualquer diagnóstico.
 */
async function enviarEmail(para, assunto, html) {
    const inicio = Date.now();
    const transporte = transporteEscolhido();
    const { remetente } = config();

    const falha = (etapa, erro) => {
        const duracaoMs = Date.now() - inicio;
        logger.error('[email] Falha no envio', {
            etapa, transporte, destinatario: mascarar(para), assunto, duracaoMs,
            erro: erro && (erro.stack || erro.message || String(erro)),
            action: 'email.enviar',
        });
        return { ok: false, etapa, transporte, duracaoMs, erro: erro && (erro.message || String(erro)) };
    };

    if (!para || typeof para !== 'string' || !para.includes('@')) {
        // Destinatário ausente é a falha mais silenciosa de todas: o provedor
        // recusa e, no caminho antigo, ninguém ficava sabendo.
        return falha('configuracao', new Error('Destinatário ausente ou inválido.'));
    }
    if (transporte === 'nenhum') {
        return falha('configuracao', new Error('Nenhum transporte de e-mail configurado (defina EMAIL_PASS ou EMAIL_HOST).'));
    }
    if (!remetente) {
        return falha('configuracao', new Error('EMAIL_FROM não definido. Resend e Brevo recusam remetente não verificado.'));
    }

    try {
        let messageId = null;
        if (transporte === 'resend-api') messageId = await viaResend(para, assunto, html);
        else if (transporte === 'brevo-api') messageId = await viaBrevo(para, assunto, html);
        else messageId = await viaSmtp(para, assunto, html);

        const duracaoMs = Date.now() - inicio;
        logger.info('[email] Enviado', {
            transporte, messageId, destinatario: mascarar(para), assunto, duracaoMs,
            action: 'email.enviar',
        });
        return { ok: true, messageId, etapa: 'concluido', transporte, duracaoMs };
    } catch (e) {
        return falha('envio', e);
    }
}

/**
 * Checagem de saúde do canal, SEM enviar mensagem: valida a configuração e,
 * no SMTP, abre a conexão (`verify()`). Nas APIs HTTPS confirma a chave com uma
 * chamada de leitura — não existe "verify" nelas, e mandar um e-mail de teste
 * a cada boot geraria custo e ruído.
 */
async function verificarEnvio() {
    const inicio = Date.now();
    const transporte = transporteEscolhido();
    const { remetente } = config();

    const problemas = [];
    if (transporte === 'nenhum') problemas.push('EMAIL_PASS/EMAIL_HOST ausentes.');
    if (!remetente) problemas.push('EMAIL_FROM ausente.');
    if (problemas.length) {
        return { ok: false, etapa: 'configuracao', transporte, erro: problemas.join(' '), duracaoMs: Date.now() - inicio };
    }

    try {
        if (transporte === 'smtp') {
            await smtp().verify();
        } else if (transporte === 'resend-api') {
            await consultarGet('api.resend.com', '/domains', { Authorization: `Bearer ${config().chave}` });
        } else {
            await consultarGet('api.brevo.com', '/v3/account', { 'api-key': config().chave });
        }
        return { ok: true, etapa: 'concluido', transporte, remetente, duracaoMs: Date.now() - inicio };
    } catch (e) {
        return { ok: false, etapa: 'conexao', transporte, erro: e.message || String(e), duracaoMs: Date.now() - inicio };
    }
}

function consultarGet(hostname, path, headers) {
    return new Promise((resolve, reject) => {
        const req = https.request({ hostname, port: 443, path, method: 'GET', timeout: TIMEOUT_MS, headers },
            (res) => {
                let bruto = '';
                res.on('data', (c) => { bruto += c; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) return resolve(bruto);
                    let json = null;
                    try { json = JSON.parse(bruto); } catch (e) { /* não-JSON */ }
                    reject(new Error((json && (json.message || json.error)) || `HTTP ${res.statusCode}`));
                });
            });
        req.on('timeout', () => req.destroy(new Error(`Tempo esgotado (${TIMEOUT_MS}ms)`)));
        req.on('error', reject);
        req.end();
    });
}

/**
 * Contatos que o provedor BLOQUEOU e para os quais não entrega mais.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO PRECISA SER CONSULTÁVEL
 * ─────────────────────────────────────────────────────────────────────────
 * O Brevo anexa `list-unsubscribe` em TODO e-mail, inclusive transacional —
 * é obrigatório e não há chave para desligar no painel. O Gmail transforma
 * esse cabeçalho num link "Cancelar inscrição" ao lado do remetente.
 *
 * Se um diretor clicar ali achando que é propaganda, ele entra na lista de
 * bloqueados e PARA DE RECEBER OS CÓDIGOS DE LOGIN. Fica trancado fora do
 * sistema, e o sintoma é o pior possível: o e-mail simplesmente não chega,
 * sem erro, sem aviso, sem nada para investigar.
 *
 * Com esta consulta, o painel aponta o problema antes de virar chamado.
 *
 * @returns {Promise<{suportado: boolean, emails: string[], erro?: string}>}
 *          `suportado: false` quando o transporte não expõe essa informação —
 *          não é erro, é ausência de recurso, e o chamador não deve alarmar.
 */
async function contatosBloqueados() {
    if (transporteEscolhido() !== 'brevo-api') {
        return { suportado: false, emails: [] };
    }

    try {
        // 500 é o teto por página na API. Uma escola não chega perto disso em
        // bloqueios; se chegar, o problema é outro e maior.
        const bruto = await consultarGet(
            'api.brevo.com',
            '/v3/smtp/blockedContacts?limit=500&offset=0',
            { 'api-key': config().chave }
        );
        const json = JSON.parse(bruto);
        const emails = (json.contacts || [])
            .map((c) => String(c.email || '').toLowerCase())
            .filter(Boolean);
        return { suportado: true, emails };
    } catch (e) {
        return { suportado: true, emails: [], erro: e.message || String(e) };
    }
}

module.exports = { enviarEmail, verificarEnvio, transporteEscolhido, mascarar, contatosBloqueados };
