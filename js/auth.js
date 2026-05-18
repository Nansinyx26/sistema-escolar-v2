/**
 * Authentication Manager
 * Gerencia login com Email/Senha e Google OAuth (simulado offline)
 */

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.isOnline = navigator.onLine;

        // Monitora status de conexão
        window.addEventListener('online', () => {
            this.isOnline = true;
            console.log('Sistema online');
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            console.log('Sistema offline');
        });
    }

    /**
     * Inicializa o gerenciador de autenticação
     */
    async init() {
        await db.init();
        await this.checkSession();
    }

    /**
     * Verifica se há sessão ativa
     */
    async checkSession() {
        const sessionData = sessionStorage.getItem('currentUser');
        if (sessionData) {
            this.currentUser = JSON.parse(sessionData);
            return this.currentUser;
        }
        return null;
    }

    /**
     * Login com Email e Senha
     * Usa POST /auth/login no backend (suporta bcrypt + legacy plain text)
     */
    async loginWithEmail(email, senha) {
        try {
            const baseUrl = window.API_BASE_URL || (
                (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                    ? 'http://localhost:3001/api'
                    : 'https://sistema-escolar-bfty.onrender.com/api'
            );

            const res = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, senha }),
                credentials: 'include' // IMPORTANTE: Para receber o cookie HttpOnly
            });

            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Credenciais inválidas');
            }

            // ============================================
            // MELHORIA: Suporte a 2FA (Roadmap #1)
            // Se o backend pedir verificação de dois fatores,
            // abre o modal — não redireciona ainda.
            // ============================================
            if (data.requires2FA) {
                if (typeof window.abrirModal2FA === 'function') {
                    window.abrirModal2FA(data.userId, data.message || email);
                }
                // Retorna um indicador especial para o login.js não redirecionar
                return { requires2FA: true };
            }

            // O JWT agora é salvo automaticamente no cookie HttpOnly pelo navegador
            // SEGURANÇA: Não armazenamos mais o token no localStorage

            if (data.user.deveMudarSenha) {
                sessionStorage.setItem('forcePasswordChange', 'true');
            } else {
                sessionStorage.removeItem('forcePasswordChange');
            }

            const usuario = data.user;
            this.currentUser = usuario;
            sessionStorage.setItem('currentUser', JSON.stringify(usuario));

            return usuario;
        } catch (error) {
            console.error('Erro no login:', error);
            throw error;
        }
    }



    // Métodos de login social removidos por segurança.

    /**
     * Registro de novo usuário com Código Secreto da Escola
     */
    async registerWithCode(email, senha, nome, codigoEscola, cpf, telefone) {
        try {
            const baseUrl = window.API_BASE_URL;

            const res = await fetch(`${baseUrl}/auth/register-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, senha, nome, codigoEscola, cpf, telefone })
            });

            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Erro ao criar conta. Verifique o código da escola.');
            }

            return data;
        } catch (error) {
            console.error('Erro no registro:', error);
            throw error;
        }
    }

    // registerWithEmail legado REMOVIDO por segurança — criava usuário localmente sem hash/validação.
    // Use registerWithCode() para novos cadastros.

    /**
     * Define o perfil do usuário (professor ou diretor)
     */
    async setUserProfile(userId, perfil) {
        try {
            const usuario = await db.findById('usuarios', userId);
            if (!usuario) {
                throw new Error('Usuário não encontrado');
            }

            usuario.perfil = perfil;
            usuario.perfilDefinidoEm = new Date().toISOString();
            await db.update('usuarios', usuario);

            // Atualiza sessão
            this.currentUser = usuario;
            sessionStorage.setItem('currentUser', JSON.stringify(usuario));

            return usuario;
        } catch (error) {
            console.error('Erro ao definir perfil:', error);
            throw error;
        }
    }

    /**
     * Logout
     */
    async logout() {
        this.currentUser = null;
        // SEGURANÇA: Limpa todos os storages (incluindo legados)
        sessionStorage.removeItem('currentUser');
        sessionStorage.removeItem('forcePasswordChange');
        localStorage.removeItem('escola_session');     // Legado — limpeza preventiva
        localStorage.removeItem('escola_jwt');          // Legado — limpeza preventiva
        localStorage.removeItem('escola_jwt_user');     // Legado — limpeza preventiva
        
        // Chama rota de logout no backend para limpar o cookie HttpOnly
        try {
            const baseUrl = window.API_BASE_URL;
            await fetch(`${baseUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
        } catch (e) {
            console.log('Logout silencioso no backend');
        }

        window.location.href = 'index.html';
    }

    /**
     * Obtém usuário atual
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Verifica se está autenticado
     */
    isAuthenticated() {
        return this.currentUser !== null;
    }

    /**
     * Verifica se tem perfil definido
     */
    hasProfile() {
        return this.currentUser && this.currentUser.perfil !== null;
    }

    /**
     * Verifica se é professor
     */
    isProfessor() {
        return this.currentUser && this.currentUser.perfil === 'professor';
    }

    /**
     * Verifica se é diretor
     */
    isDiretor() {
        return this.currentUser && this.currentUser.perfil === 'diretor';
    }

    /**
     * Atualiza dados da sessão atual
     */
    updateSession(userData) {
        if (!userData) return;
        this.currentUser = userData;
        sessionStorage.setItem('currentUser', JSON.stringify(userData));
        // SEGURANÇA: Removido localStorage — dados ficam apenas em sessionStorage
    }

    /**
     * Verifica se é administrador
     */
    isAdmin() {
        return this.currentUser && this.currentUser.perfil === 'admin';
    }

    /**
     * Atualiza dados do usuário na sessão
     */
    setUser(user) {
        if (user) {
            this.currentUser = user;
            sessionStorage.setItem('currentUser', JSON.stringify(user));
        }
    }
}

// Instância global
const auth = new AuthManager();

// Exportar
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthManager;
}

// Ensure global access for Modules
window.auth = auth;
