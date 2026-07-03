/**
 * API Configuration
 * Detecta automaticamente se está em desenvolvimento ou produção
 */

const API_URLS = {
    development: `http://${window.location.hostname || 'localhost'}:3001/api`,
    production: 'https://sistema-escolar-bfty.onrender.com/api'
};

function getApiBaseUrl() {
    const hostname = window.location.hostname;
    const isLocalIP = /^(127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|10\.)/.test(hostname);
    
    const isDevelopment = hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        isLocalIP ||
        window.location.protocol === 'file:';

    const url = isDevelopment ? API_URLS.development : API_URLS.production;
    console.log(`[API Config] Detecção: hostname='${hostname}', isDevelopment=${isDevelopment}`);
    console.log(`[API Config] URL Selecionada: ${url}`);
    return url;
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
 * Utilitário global para resolver URLs de fotos (GridFS, Google ou Base64)
 */
window.getPhotoUrl = function(foto, fotoGoogle = '') {
    // Helper to check if a value is truly empty or a literal "null"/"undefined" string
    const isEmpty = (v) => !v || v === 'null' || v === 'undefined' || v === '[object Object]';

    // 1. Prioridade: Se for Base64 (upload recente ou temporário)
    if (typeof foto === 'string' && foto.startsWith('data:image')) return foto;

    // 2. Se for uma URL completa (Google Oauth ou externa)
    if (typeof foto === 'string' && (foto.startsWith('http') || foto.startsWith('https'))) return foto;
    if (typeof fotoGoogle === 'string' && fotoGoogle.startsWith('http')) return fotoGoogle;

    // 3. Se for um ID do GridFS ou caminho relativo da nossa API
    if (!isEmpty(foto)) {
        const photoId = typeof foto === 'object' && foto.$oid ? foto.$oid : foto;
        
        // Se já for uma URL completa da nossa API, não mexe
        if (typeof photoId === 'string' && (photoId.startsWith('/api/files/') || photoId.startsWith('/api/upload/photo/'))) {
            return `${window.API_BASE_URL.replace('/api', '')}${photoId}`;
        }
        
        if (typeof photoId === 'string' && (photoId.includes('/api/files/') || photoId.includes('/api/upload/photo/'))) {
            return photoId;
        }

        // Constrói a URL usando a rota pública /files/:id
        return `${window.API_BASE_URL}/files/${photoId}`;
    }

    // 4. Fallback: Google se original falhou
    if (!isEmpty(fotoGoogle)) return fotoGoogle;

    // 5. Fallback total: Avatar padrão
    return '/img/default-avatar.png';
};

/**
 * Atualiza todos os elementos de avatar/foto na tela baseado no usuário fornecido.
 * Procura por IDs específicos e classes globais.
 */
window.updateAllAvatars = function(user) {
    if (!user) return;
    const photoUrl = window.getPhotoUrl(user.foto, user.fotoGoogle);
    const isDefault = !photoUrl || photoUrl.includes('default-avatar.png');
    const initialsText = window.utils?.getInitials ? window.utils.getInitials(user.nome || "U") : (user.nome || "U").charAt(0);
    
    // IDs comuns de avatar
    ['sidebarAvatar', 'userPhotoPreview', 'headerAvatar', 'profilePhotoDisplay', 'sidebarAvatarImg'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        const wrapper = el.parentElement;
        
        if (isDefault) {
            if (el.tagName === 'IMG') {
                el.style.display = 'none';
                // Adiciona iniciais ao wrapper se não existirem
                if (wrapper && !wrapper.querySelector('.avatar-placeholder-global')) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'avatar-placeholder-global';
                    placeholder.style.cssText = `
                        width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
                        background: linear-gradient(135deg, var(--primary, #10b981) 0%, var(--primary-dark, #059669) 100%);
                        color: white; font-weight: 700; border-radius: inherit;
                    `;
                    placeholder.textContent = initialsText;
                    wrapper.appendChild(placeholder);
                }
            } else {
                el.style.backgroundImage = 'none';
                el.textContent = initialsText;
            }
        } else {
            if (el.tagName === 'IMG') {
                el.src = photoUrl;
                el.style.display = 'block';
                wrapper?.querySelector('.avatar-placeholder-global')?.remove();
                wrapper?.querySelector('.avatar-placeholder')?.remove(); // Compatibilidade
            } else {
                el.style.backgroundImage = `url(${photoUrl})`;
                el.textContent = '';
            }
        }
    });

    // Elementos com data-user-photo="self"
    document.querySelectorAll('[data-user-photo="self"]').forEach(el => {
        const wrapper = el.parentElement;
        if (isDefault) {
            if (el.tagName === 'IMG') {
                el.style.display = 'none';
                if (wrapper && !wrapper.querySelector('.avatar-placeholder-global')) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'avatar-placeholder-global';
                    placeholder.style.cssText = `width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--primary, #10b981) 0%, var(--primary-dark, #059669) 100%); color: white; font-weight: 700; border-radius: inherit;`;
                    placeholder.textContent = initialsText;
                    wrapper.appendChild(placeholder);
                }
            } else {
                el.style.backgroundImage = 'none';
                el.textContent = initialsText;
            }
        } else {
            if (el.tagName === 'IMG') {
                el.src = photoUrl;
                el.style.display = 'block';
                wrapper?.querySelector('.avatar-placeholder-global')?.remove();
            } else {
                el.style.backgroundImage = `url(${photoUrl})`;
                el.textContent = '';
            }
        }
    });

    // Notitica o React se aplicável
    window.dispatchEvent(new CustomEvent('userPhotoUpdated', { detail: { photoUrl, user, isDefault } }));
};

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

// ============================================
// DEVELOPER LOGS SYSTEM
// ============================================
const isDev = window.location.hostname === 'localhost' || 
              window.location.hostname === '127.0.0.1' || 
              window.location.hostname === '';

window.DEVELOPER_MODE = isDev;

// Store original console methods
const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
};

// Safe wrapper for developer logs
window.devLog = function(...args) {
    if (window.DEVELOPER_MODE) {
        originalConsole.log('[DEV]', ...args);
    }
};

// Silences logs in production to protect system structure and look professional
if (!window.DEVELOPER_MODE) {
    console.log = () => {};
    console.warn = () => {};
    console.debug = () => {};
    console.info = () => {};
    // Keep console.error but make it generic/masked if needed, or keep for debugging
}

// ============================================
// REQUEST DEDUPLICATION AND CACHE SYSTEM
// ============================================
const getCache = new Map();
const pendingRequests = new Map();
const CACHE_TTL = 2000; // 2 seconds short-lived cache to avoid duplicate component/page loading queries

/**
 * INTERCEPTOR GLOBAL DE FETCH
 * Adiciona automaticamente:
 * - credentials: 'include' para enviar cookies JWT
 * - Header X-CSRF-Token em requisições POST/PUT/DELETE
 * - Cache de curta duração (2s) para requisições GET
 * - Dedup de requisições GET paralelas
 * - Tratamento inteligente e amigável de erros (429 Rate Limit, Redes, etc.)
 */
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    let [resource, config] = args;
    config = config || {};

    const url = typeof resource === 'string' ? resource : (resource.url || '');
    const method = (config.method || 'GET').toUpperCase();
    
    const isApiRequest = url.includes(window.API_BASE_URL) || url.startsWith('/api') || url.startsWith('./api');

    if (isApiRequest) {
        config.credentials = 'include';

        // SEGURANÇA: Injeta CSRF token em requisições que mudam estado
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
            config.headers = config.headers || {};
            const csrfToken = getCookie('csrf_token');
            if (window.DEVELOPER_MODE) console.log(`[CSRF] Injecting token for ${method} ${url}: ${csrfToken ? 'YES' : 'NO'}`);
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

    // Apenas aplica cache/dedup para requisições GET à nossa API
    if (isApiRequest && method === 'GET') {
        const cacheKey = url;
        const now = Date.now();

        // 1. Verificar cache válido
        if (getCache.has(cacheKey)) {
            const cached = getCache.get(cacheKey);
            if (now - cached.timestamp < CACHE_TTL) {
                window.devLog('Serving from short cache:', cacheKey);
                return cached.response.clone();
            }
            getCache.delete(cacheKey);
        }

        // 2. Verificar se há uma requisição idêntica em andamento
        if (pendingRequests.has(cacheKey)) {
            window.devLog('Deduplicating parallel request:', cacheKey);
            try {
                const response = await pendingRequests.get(cacheKey);
                return response.clone();
            } catch (e) {
                // Se a promessa original falhar, prossegue normalmente
            }
        }

        // 3. Fazer requisição real
        const fetchPromise = originalFetch(resource, config).then(async (res) => {
            pendingRequests.delete(cacheKey);

            // Se for bem sucedido, coloca no cache
            if (res.ok) {
                const clonedRes = res.clone();
                getCache.set(cacheKey, {
                    timestamp: Date.now(),
                    response: clonedRes
                });
            }
            return res;
        }).catch(err => {
            pendingRequests.delete(cacheKey);
            throw err;
        });

        pendingRequests.set(cacheKey, fetchPromise);

        try {
            const res = await fetchPromise;
            return res.clone();
        } catch (error) {
            return handleFetchError(error);
        }
    }

    // Para requisições POST/PUT/DELETE ou requisições fora da API
    try {
        const res = await originalFetch(resource, config);
        
        // Tratamento global para erros HTTP (como 429 Rate Limit)
        if (res.status === 429) {
            const msg = 'Muitas requisições vindas deste IP. Tente novamente em alguns minutos.';
            if (window.showToast) {
                window.showToast(msg, 'warning');
            } else if (window.utils && window.utils.showToast) {
                window.utils.showToast(msg, 'warning');
            }
            return new Response(JSON.stringify({ success: false, error: msg }), {
                status: 429,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        return res;
    } catch (error) {
        return handleFetchError(error);
    }
};

/** Função centralizada para tratamento amigável de erros de rede */
function handleFetchError(error) {
    window.devLog('Global Fetch Error Intercepted:', error);
    const userMsg = 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet.';
    
    if (window.showToast) {
        window.showToast(userMsg, 'error');
    } else if (window.utils && window.utils.showToast) {
        window.utils.showToast(userMsg, 'error');
    }
    
    return new Response(JSON.stringify({ success: false, error: userMsg }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
    });
}

console.log('Ambiente:', window.location.hostname === 'localhost' ? 'Desenvolvimento' : 'Produção');
console.log('API URL:', window.API_BASE_URL);
console.log('🛡️ Fetch Interceptor + Cache + Dedup + CSRF: Ativo');
