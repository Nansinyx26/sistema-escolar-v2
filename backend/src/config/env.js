/**
 * config/env.js — ponto único de leitura e validação das variáveis de ambiente.
 *
 * Regras:
 * - NENHUM valor padrão contém credencial real (fallbacks só para
 *   conveniência de desenvolvimento local, nunca segredos).
 * - `validarAmbiente()` roda no arranque (src/index.js): se faltar variável
 *   obrigatória, loga QUAIS faltam em português e encerra com exit(1)
 *   ANTES de conectar ao banco.
 * - Em ambiente de teste (Jest) a validação não derruba o processo — os
 *   testes usam mongodb-memory-server e segredos próprios de fixture.
 */

const path = require('path');
const dotenv = require('dotenv');

// Carrega .env do backend e, como fallback, o da raiz do projeto
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Declaração central de todas as variáveis usadas pelo sistema.
 * `obrigatoriaEm`: 'sempre' | 'producao' | null (opcional)
 */
const DECLARACAO = [
    {
        nome: 'MONGODB_URI',
        obrigatoriaEm: 'sempre',
        descricao: 'Connection string do MongoDB Atlas',
    },
    {
        nome: 'JWT_SECRET',
        obrigatoriaEm: 'sempre',
        descricao: 'Segredo de assinatura dos tokens JWT',
    },
    {
        nome: 'SESSION_SECRET',
        obrigatoriaEm: 'producao',
        descricao: 'Segredo da sessão multi-escola (express-session)',
    },
    {
        nome: 'MONGODB_DB_NAME',
        obrigatoriaEm: null,
        descricao: 'Nome do banco (padrão: o da connection string)',
    },
    { nome: 'PORT', obrigatoriaEm: null, descricao: 'Porta HTTP (padrão 3001)' },
    { nome: 'NODE_ENV', obrigatoriaEm: null, descricao: 'development | production | test' },
    {
        nome: 'FRONTEND_URL',
        obrigatoriaEm: null,
        descricao: 'URL pública do frontend (CORS/links de e-mail)',
    },
    { nome: 'GOOGLE_CLIENT_ID', obrigatoriaEm: null, descricao: 'OAuth Google (login social)' },
    { nome: 'EMAIL_HOST', obrigatoriaEm: null, descricao: 'Servidor SMTP' },
    { nome: 'EMAIL_PORT', obrigatoriaEm: null, descricao: 'Porta SMTP' },
    { nome: 'EMAIL_USER', obrigatoriaEm: null, descricao: 'Usuário SMTP' },
    {
        nome: 'EMAIL_PASS',
        obrigatoriaEm: null,
        descricao: 'Chave de API do provedor (re_.../xkeysib-...) ou senha SMTP',
    },
    // Sem EMAIL_FROM o provedor recusa a mensagem por remetente não verificado,
    // e o 2FA de diretor/secretaria para de chegar sem erro visível.
    {
        nome: 'EMAIL_FROM',
        obrigatoriaEm: null,
        descricao: 'Remetente verificado — obrigatório para o e-mail funcionar',
    },
    {
        nome: 'GOOGLE_TTS_API_KEY',
        obrigatoriaEm: null,
        descricao: 'API key Gemini/Google (TTS e chatbot)',
    },
    { nome: 'GEMINI_KEY', obrigatoriaEm: null, descricao: 'Alias da API key do Gemini' },
    { nome: 'ELEVENLABS_API_KEY', obrigatoriaEm: null, descricao: 'API key ElevenLabs (TTS)' },
    {
        nome: 'METRICS_TOKEN',
        obrigatoriaEm: null,
        descricao: 'Protege GET /api/metrics em produção',
    },
    // Enfraquece a autenticação: o boot emite alerta enquanto estiver preenchida.
    {
        nome: 'DISPENSAR_2FA_EMAIL',
        obrigatoriaEm: null,
        descricao: 'Perfis que entram sem segundo fator (ex.: diretor,secretaria)',
    },
    // Vazia = diretor,secretaria. Ver docs/2FA-OBRIGATORIO.md antes de incluir admin.
    {
        nome: 'PERFIS_2FA_OBRIGATORIO',
        obrigatoriaEm: null,
        descricao: 'Perfis que exigem segundo fator',
    },
    {
        nome: 'FILTRO_PALAVROES_NIVEIS',
        obrigatoriaEm: null,
        descricao: 'Níveis que bloqueiam o envio (padrão: grave,moderado)',
    },
    {
        nome: 'FILTRO_PALAVROES_EXTRAS',
        obrigatoriaEm: null,
        descricao: 'Palavras extras a bloquear, separadas por vírgula',
    },
    {
        nome: 'FILTRO_PALAVROES_EXCECOES',
        obrigatoriaEm: null,
        descricao: 'Palavras a liberar do filtro, separadas por vírgula',
    },

    // ── Moderação de conteúdo (docs/moderacao/ESPEC-MODERACAO-CHAT.md §8.7) ──
    // TODOS os padrões DESLIGAM provedor externo. Sem nenhuma destas variáveis
    // definidas, o sistema roda exatamente como rodava antes da moderação
    // existir: só a Camada 1 (léxico), in-process, sem chave e sem custo.
    // Escola que não contratou serviço de IA não percebe diferença.
    {
        nome: 'MODERACAO_ATIVA',
        obrigatoriaEm: null,
        descricao: 'Liga o registro de ocorrências (padrão: true)',
    },
    {
        nome: 'MODERACAO_MODO',
        obrigatoriaEm: null,
        descricao: 'observar | aplicar (padrão: observar — ver §9.1)',
    },
    {
        nome: 'MODERACAO_TEXTO_CLASSIFICADOR',
        obrigatoriaEm: null,
        descricao: 'none | gemini | openai (padrão: none)',
    },
    {
        nome: 'MODERACAO_TEXTO_SINCRONA',
        obrigatoriaEm: null,
        descricao: 'Classificar texto de forma bloqueante (padrão: false)',
    },
    {
        nome: 'MODERACAO_TEXTO_AMOSTRAGEM',
        obrigatoriaEm: null,
        descricao: 'Fração de mensagens classificadas (padrão: 0.3)',
    },
    { nome: 'MODERACAO_AUDIO_STT', obrigatoriaEm: null, descricao: 'none | google (padrão: none)' },
    {
        nome: 'MODERACAO_IMAGEM_PROVEDOR',
        obrigatoriaEm: null,
        descricao: 'none | vision (padrão: none)',
    },
    {
        nome: 'MODERACAO_GUARDAR_TRANSCRICAO',
        obrigatoriaEm: null,
        descricao: 'Opt-in para guardar transcrição de áudio (padrão: false)',
    },
    {
        nome: 'MODERACAO_TIMEOUT_STT_MS',
        obrigatoriaEm: null,
        descricao: 'Timeout do STT em ms (padrão: 8000)',
    },
    {
        nome: 'MODERACAO_TIMEOUT_IMAGEM_MS',
        obrigatoriaEm: null,
        descricao: 'Timeout da análise de imagem em ms (padrão: 10000)',
    },
    {
        nome: 'MODERACAO_PRAZO_FILA_HORAS',
        obrigatoriaEm: null,
        descricao: 'Prazo até a liberação por decurso (padrão: 24 — §5.2)',
    },
    {
        nome: 'MODERACAO_WORKER_ATIVO',
        obrigatoriaEm: null,
        descricao: 'Kill-switch do worker in-process (padrão: true; sempre off em teste)',
    },
    {
        nome: 'MODERACAO_VIDEO_PERMITIDO',
        obrigatoriaEm: null,
        descricao: 'equipe | todos | ninguem (§4.3)',
    },
    {
        nome: 'RATE_LIMIT_MODERACAO',
        obrigatoriaEm: null,
        descricao: 'Teto/hora de denúncias e contestações por conta (padrão: 10)',
    },
];

/**
 * Valida o ambiente. Chame UMA vez no arranque, antes de conectar ao banco.
 * Encerra o processo (exit 1) se faltar variável obrigatória — exceto em teste.
 */
function validarAmbiente() {
    const faltando = DECLARACAO.filter((v) => {
        if (!v.obrigatoriaEm) return false;
        if (v.obrigatoriaEm === 'producao' && !isProduction) return false;
        const valor = process.env[v.nome];
        return !valor || String(valor).trim() === '';
    });

    if (faltando.length === 0) return true;

    /* eslint-disable no-console */
    console.error('');
    console.error('❌ ERRO DE CONFIGURAÇÃO — variáveis de ambiente obrigatórias ausentes:');
    for (const v of faltando) {
        console.error(`   • ${v.nome} — ${v.descricao}`);
    }
    console.error('');
    console.error('   Como corrigir:');
    console.error(
        '   - Local: copie backend/.env.example para backend/.env e preencha os valores.'
    );
    console.error('   - Render: painel do serviço → aba Environment → Add Environment Variable.');
    console.error(
        "   - Gere segredos com: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
    );
    console.error('');
    /* eslint-enable no-console */

    if (isTest) return false; // Jest usa segredos de fixture — não derruba o runner
    process.exit(1);
}

/**
 * Snapshot tipado das variáveis — importe daqui em vez de espalhar
 * process.env pelo código novo.
 */
const env = {
    isProduction,
    isTest,
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT, 10) || 3001,
    MONGODB_URI: process.env.MONGODB_URI || '',
    MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || undefined,
    JWT_SECRET: process.env.JWT_SECRET || '',
    SESSION_SECRET: process.env.SESSION_SECRET || '',
    FRONTEND_URL: process.env.FRONTEND_URL || '',
    EMAIL_HOST: process.env.EMAIL_HOST || '',
    EMAIL_PORT: process.env.EMAIL_PORT || '',
    EMAIL_USER: process.env.EMAIL_USER || '',
    EMAIL_PASS: process.env.EMAIL_PASS || '',
    METRICS_TOKEN: process.env.METRICS_TOKEN || '',
};

module.exports = { env, validarAmbiente };
