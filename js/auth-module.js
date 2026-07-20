/**
 * Módulo de Autenticação (ES6)
 * Verifica sessão via sessionStorage (rápido) E via backend JWT (seguro).
 * O JWT é gerenciado via cookie HttpOnly pelo backend.
 */

class AuthModule {
    constructor() {
        this.currentUser = null;
        this.STORAGE_KEY = 'currentUser';
    }

    /**
     * Resolve a URL base da API (local ou produção)
     */
    _apiBase() {
        return window.API_BASE_URL || 'http://localhost:3001/api';
    }

    /**
     * Inicializa: tenta sessionStorage primeiro, depois confirma via backend
     */
    async init() {
        // 1. Tenta carregar do sessionStorage (instantâneo)
        const session = sessionStorage.getItem(this.STORAGE_KEY);
        if (session) {
            this.currentUser = JSON.parse(session);
            return this.currentUser;
        }

        // 2. Sessão não encontrada localmente → confirma com backend via cookie JWT
        try {
            const res = await fetch(`${this._apiBase()}/auth/me`, {
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.user) {
                    this.currentUser = data.user;
                    sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(data.user));
                    return this.currentUser;
                }
            }
        } catch (e) {
            // Offline ou backend não responde — segue sem sessão
            console.warn('[auth] Não foi possível verificar sessão no backend:', e.message);
        }

        return null;
    }

    /**
     * Verifica se há usuário logado e redireciona se necessário
     * @returns {boolean} - True se autenticado
     */
    requireAuth() {
        // Usa dados já carregados em init()
        if (!this.currentUser) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    }

    /**
     * Redireciona para página principal se já estiver logado
     * @returns {boolean} - True se redirecionou
     */
    redirectIfLoggedIn() {
        if (this.currentUser) {
            window.location.href = 'selecionar.html';
            return true;
        }
        return false;
    }

    /**
     * Sincroniza os dados do usuário com o backend (foto/nome/etc).
     * Atualiza currentUser e sessionStorage. Retorna o usuário atualizado
     * ou null se não for possível sincronizar (offline/sem sessão).
     * @returns {Promise<Object|null>}
     */
    async refreshUser() {
        try {
            const res = await fetch(`${this._apiBase()}/auth/me`, {
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.user) {
                    this.currentUser = data.user;
                    sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(data.user));
                    window.dispatchEvent(new CustomEvent('auth:updated', { detail: data.user }));
                    return data.user;
                }
            }
        } catch (e) {
            console.warn('[auth] Não foi possível sincronizar usuário:', e.message);
        }
        return null;
    }

    /**
     * Retorna o usuário atual
     * @returns {Object|null}
     */
    getCurrentUser() {
        if (!this.currentUser) {
            const session = sessionStorage.getItem(this.STORAGE_KEY);
            if (session) this.currentUser = JSON.parse(session);
        }
        return this.currentUser;
    }

    /**
     * Verifica se está logado
     * @returns {boolean}
     */
    isLoggedIn() {
        return this.getCurrentUser() !== null;
    }

    /**
     * Faz logout
     */
    logout() {
        this.currentUser = null;
        sessionStorage.removeItem(this.STORAGE_KEY);
    }
}

// Exporta instância única
const auth = new AuthModule();
export default auth;
