/**
 * keepAlive.js
 * ============================================
 * MELHORIA: Solução para Cold Start (Roadmap #5)
 * ============================================
 * O Render (plano gratuito) coloca o servidor para dormir após 15 min de
 * inatividade, causando cold starts de 30–50s para os usuários.
 *
 * Esta solução faz o servidor "pingar" a si mesmo a cada 14 minutos,
 * mantendo-o ativo sem nenhum custo adicional.
 *
 * USO: Chamar startKeepAlive() no index.js após o servidor iniciar.
 *
 * NOTA: Desativado automaticamente em desenvolvimento para não poluir logs.
 */

const https = require('https');
const http = require('http');

/**
 * Inicia o loop de keep-alive.
 * @param {string} [customUrl] - URL personalizada para fazer o ping.
 *                               Se não informada, usa RENDER_EXTERNAL_URL ou FRONTEND_URL.
 */
function startKeepAlive(customUrl) {
    // Apenas ativo em produção
    if (process.env.NODE_ENV !== 'production') {
        console.log('ℹ️  [KeepAlive] Desativado em desenvolvimento.');
        return;
    }

    // Determina a URL de destino: usa a URL do próprio serviço no Render
    const targetUrl = customUrl
        || process.env.RENDER_EXTERNAL_URL  // Variável injetada automaticamente pelo Render
        || process.env.FRONTEND_URL
        || null;

    if (!targetUrl) {
        console.warn('⚠️  [KeepAlive] Nenhuma URL configurada. Cold start não será prevenido.');
        console.warn('   Defina RENDER_EXTERNAL_URL ou FRONTEND_URL nas variáveis de ambiente.');
        return;
    }

    // Pinga a cada 14 minutos (abaixo do limite de 15min do Render)
    const INTERVAL_MS = 14 * 60 * 1000;

    const ping = () => {
        const url = new URL('/api/health', targetUrl);
        const client = url.protocol === 'https:' ? https : http;

        const req = client.get(url.toString(), (res) => {
            console.log(`✅ [KeepAlive] Ping OK — Status: ${res.statusCode} | ${new Date().toISOString()}`);
        });

        req.on('error', (err) => {
            // Silencioso — não queremos travar o servidor por uma falha de ping
            console.warn(`⚠️  [KeepAlive] Ping falhou: ${err.message}`);
        });

        req.setTimeout(10000, () => {
            req.destroy();
            console.warn('⚠️  [KeepAlive] Ping timeout (10s).');
        });
    };

    // Primeiro ping após 1 minuto (aguarda o servidor estabilizar)
    setTimeout(ping, 60 * 1000);

    // Pings periódicos
    const interval = setInterval(ping, INTERVAL_MS);

    // Garante que o interval não bloqueia o shutdown gracioso do processo
    if (interval.unref) interval.unref();

    console.log(`🔄 [KeepAlive] Ativo — Pingando ${targetUrl} a cada 14 minutos.`);
}

module.exports = { startKeepAlive };
