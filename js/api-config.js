/**
 * API Configuration
 * Detecta automaticamente se está em desenvolvimento ou produção
 */

const API_URLS = {
    development: `http://${window.location.hostname}:3001/api`,
    production: 'https://sistema-escolar-bfty.onrender.com/api'
};

function getApiBaseUrl() {
    const isDevelopment = window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

    return isDevelopment ? API_URLS.development : API_URLS.production;
}

window.API_BASE_URL = getApiBaseUrl();

// ============================================
// SEGURANÇA: Utilitário para ler cookies (necessário para CSRF)
// ============================================
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}
window.getCookie = getCookie;

/**
 * Wrapper centralizado para chamadas à API.
 * Inclui automaticamente:
 * - Cookies HttpOnly (JWT) via credentials: 'include'
 * - Token CSRF no header X-CSRF-Token (proteção Double Submit Cookie)
 *
 * @param {string} path  - Caminho relativo à API, ex: '/alunos'
 * @param {object} opts  - Opções do fetch (method, body, headers, etc.)
 * @returns {Promise<object>} JSON de resposta
 */
async function apiFetch(path, opts = {}) {
    const isFormData = opts.body instanceof FormData;
    const headers = {
        // Não setar Content-Type para FormData — o browser define automaticamente com boundary
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(opts.headers || {})
    };
    
    // SEGURANÇA: Envia token CSRF em requisições que mudam estado
    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const csrfToken = getCookie('csrf_token');
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }
    }

    const res = await fetch(window.API_BASE_URL + path, { 
        ...opts, 
        headers,
        credentials: 'include' // IMPORTANTE: Envia cookies (JWT + CSRF) para a API
    });
    
    return res.json();
}
window.apiFetch = apiFetch;

/**
 * Realiza login via backend.
 * O JWT é salvo automaticamente como cookie HttpOnly pelo backend.
 * SEGURANÇA: Não armazenamos mais o token no localStorage.
 */
async function apiLogin(email, senha) {
    const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, senha })
    });
    if (data.success && data.user) {
        // Armazena apenas dados de UI do usuário em sessionStorage (não sensível)
        sessionStorage.setItem('currentUser', JSON.stringify(data.user));
    }
    return data;
}
window.apiLogin = apiLogin;

/** Remove dados de sessão (logout) */
function apiLogout() {
    // Limpeza completa de todos os storages
    localStorage.removeItem('escola_jwt');       // Legado — limpeza preventiva
    localStorage.removeItem('escola_jwt_user');   // Legado — limpeza preventiva
    localStorage.removeItem('escola_session');    // Legado — limpeza preventiva
    sessionStorage.removeItem('currentUser');
    sessionStorage.removeItem('forcePasswordChange');
    // O cookie HttpOnly só pode ser removido pelo backend via rota de logout
}
window.apiLogout = apiLogout;

/**
 * INTERCEPTOR GLOBAL DE FETCH
 * Adiciona automaticamente:
 * - credentials: 'include' para enviar cookies JWT
 * - Header X-CSRF-Token em requisições POST/PUT/DELETE
 */
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    let [resource, config] = args;
    config = config || {};

    const url = typeof resource === 'string' ? resource : (resource.url || '');
    
    if (url.includes(window.API_BASE_URL)) {
        // Garante que cookies sejam enviados para nossa API
        config.credentials = 'include';

        // SEGURANÇA: Injeta CSRF token em requisições que mudam estado
        const method = (config.method || 'GET').toUpperCase();
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
            config.headers = config.headers || {};
            const csrfToken = getCookie('csrf_token');
            if (csrfToken) {
                if (config.headers instanceof Headers) {
                    config.headers.set('X-CSRF-Token', csrfToken);
                } else {
                    config.headers['X-CSRF-Token'] = csrfToken;
                }
            }
        }
        
        // Se o recurso for um objeto Request, precisamos cloná-lo
        if (typeof resource !== 'string') {
            resource = new Request(resource, config);
        }
    }

    return originalFetch(resource, config);
};

console.log('Ambiente:', window.location.hostname === 'localhost' ? 'Desenvolvimento' : 'Produção');
console.log('API URL:', window.API_BASE_URL);
console.log('🛡️ Fetch Interceptor + CSRF: Ativo');
