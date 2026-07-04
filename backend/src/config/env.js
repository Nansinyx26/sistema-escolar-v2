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
    { nome: 'MONGODB_URI',        obrigatoriaEm: 'sempre',   descricao: 'Connection string do MongoDB Atlas' },
    { nome: 'JWT_SECRET',         obrigatoriaEm: 'sempre',   descricao: 'Segredo de assinatura dos tokens JWT' },
    { nome: 'SESSION_SECRET',     obrigatoriaEm: 'producao', descricao: 'Segredo da sessão multi-escola (express-session)' },
    { nome: 'MONGODB_DB_NAME',    obrigatoriaEm: null,       descricao: 'Nome do banco (padrão: o da connection string)' },
    { nome: 'PORT',               obrigatoriaEm: null,       descricao: 'Porta HTTP (padrão 3001)' },
    { nome: 'NODE_ENV',           obrigatoriaEm: null,       descricao: 'development | production | test' },
    { nome: 'FRONTEND_URL',       obrigatoriaEm: null,       descricao: 'URL pública do frontend (CORS/links de e-mail)' },
    { nome: 'GOOGLE_CLIENT_ID',   obrigatoriaEm: null,       descricao: 'OAuth Google (login social)' },
    { nome: 'EMAIL_HOST',         obrigatoriaEm: null,       descricao: 'Servidor SMTP' },
    { nome: 'EMAIL_PORT',         obrigatoriaEm: null,       descricao: 'Porta SMTP' },
    { nome: 'EMAIL_USER',         obrigatoriaEm: null,       descricao: 'Usuário SMTP' },
    { nome: 'EMAIL_PASS',         obrigatoriaEm: null,       descricao: 'Senha/API key SMTP' },
    { nome: 'GOOGLE_TTS_API_KEY', obrigatoriaEm: null,       descricao: 'API key Gemini/Google (TTS e chatbot)' },
    { nome: 'GEMINI_KEY',         obrigatoriaEm: null,       descricao: 'Alias da API key do Gemini' },
    { nome: 'ELEVENLABS_API_KEY', obrigatoriaEm: null,       descricao: 'API key ElevenLabs (TTS)' },
    { nome: 'METRICS_TOKEN',      obrigatoriaEm: null,       descricao: 'Protege GET /api/metrics em produção' },
];

/**
 * Valida o ambiente. Chame UMA vez no arranque, antes de conectar ao banco.
 * Encerra o processo (exit 1) se faltar variável obrigatória — exceto em teste.
 */
function validarAmbiente() {
    const faltando = DECLARACAO.filter(v => {
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
    console.error('   - Local: copie backend/.env.example para backend/.env e preencha os valores.');
    console.error('   - Render: painel do serviço → aba Environment → Add Environment Variable.');
    console.error('   - Gere segredos com: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
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
