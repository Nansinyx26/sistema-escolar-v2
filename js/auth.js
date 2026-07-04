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

    _apiBase() {
        return window.API_BASE_URL || 'http://localhost:3001/api';
    }

    /**
     * Inicializa o gerenciador de autenticação
     */
    async init() {
        await db.init();
        await this.checkSession();
        // Tenta atualizar os dados do usuário em background para sincronizar fotos/infos
        if (this.isAuthenticated()) {
            this.refreshUser().catch(e => console.warn('Falha ao sincronizar perfil:', e));
        }
    }

    /**
     * Sincroniza dados do usuário com o servidor
     */
    async refreshUser() {
        try {
            const baseUrl = this._apiBase();
            const res = await fetch(`${baseUrl}/auth/me`, { credentials: 'include' });
            const data = await res.json();
            if (data.success && data.user) {
                this.updateSession(data.user);
                // Notifica o sistema que os dados mudaram (opcional)
                window.dispatchEvent(new CustomEvent('auth:updated', { detail: data.user }));
                return data.user;
            }
        } catch (e) {
            console.error('Erro ao atualizar usuário:', e);
        }
        return null;
    }

    /**
     * Verifica se há sessão ativa.
     * Fonte primária: sessionStorage (rápido, sem rede).
     * Fallback: cookie JWT HttpOnly validado via /auth/me — cobre fluxos que
     * autenticam no backend sem passar pela tela de login (cadastro, ativação
     * de conta, retorno em nova aba), que antes "perdiam" a sessão.
     */
    async checkSession() {
        const sessionData = sessionStorage.getItem('currentUser');
        if (sessionData) {
            this.currentUser = JSON.parse(sessionData);
            return this.currentUser;
        }

        try {
            const baseUrl = this._apiBase();
            const res = await fetch(`${baseUrl}/auth/me`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.user) {
                    this.currentUser = data.user;
                    sessionStorage.setItem('currentUser', JSON.stringify(data.user));
                    return this.currentUser;
                }
            }
        } catch (e) {
            // Sem rede ou sem cookie válido — segue não autenticado
        }
        return null;
    }

    /**
     * Login com Email e Senha
     * Usa POST /auth/login no backend (suporta bcrypt + legacy plain text)
     * @param {string} [escolaId] - Multi-escola: escola pré-selecionada (modal da landing)
     */
    async loginWithEmail(email, senha, escolaId) {
        try {
            const baseUrl = this._apiBase();

            const body = { email, senha };
            if (escolaId) body.escolaId = escolaId;

            const res = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                credentials: 'include' // IMPORTANTE: Para receber o cookie HttpOnly
            });

            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Credenciais inválidas');
            }

            // Multi-escola: usuário com vínculo em várias escolas precisa escolher.
            // Devolve o indicador para o login.js exibir o seletor.
            if (data.requiresEscolha) {
                return { requiresEscolha: true, escolas: data.escolas || [] };
            }

            // ============================================
            // MELHORIA: Suporte a 2FA (Roadmap #1)
            // Se o backend pedir verificação de dois fatores,
            // abre o modal — não redireciona ainda.
            // ============================================
            if (data.requires2FA) {
                if (typeof window.abrirModal2FA === 'function') {
                    window.abrirModal2FA(data.userId, data.message || email, data.redirect_to);
                }
                // Retorna um indicador especial para o login.js não redirecionar
                return { requires2FA: true, redirect_to: data.redirect_to };
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
            const baseUrl = this._apiBase();

            const res = await fetch(`${baseUrl}/auth/register-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, senha, nome, codigoEscola, cpf, telefone })
            });

            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Erro ao criar conta. Verifique o código da escola.');
            }

            if (data.user) {
                this.currentUser = data.user;
                sessionStorage.setItem('currentUser', JSON.stringify(data.user));
            }

            return data;
        } catch (error) {
            console.error('Erro no registro:', error);
            throw error;
        }
    }

    // registerWithEmail legado REMOVIDO por segurança — criava usuário localmente sem hash/validação.
    // Use registerWithCode() para novos cadastros.

    async registerDocente(nome, email, senha, disciplina, turma, matricula, telefone, codigoEscola) {
        try {
            const baseUrl = this._apiBase();
            const res = await fetch(`${baseUrl}/auth/register-docente`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome, email, senha, disciplina, turma, matricula, telefone, codigoEscola }),
                credentials: 'include'
            });
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Erro ao registrar docente.');
            }
            if (data.user) {
                this.currentUser = data.user;
                sessionStorage.setItem('currentUser', JSON.stringify(data.user));
            }
            return data;
        } catch (error) {
            console.error('Erro no registro de docente:', error);
            throw error;
        }
    }

    async registerResponsavel(nome, email, senha, nomeAluno, turma, telefone, parentesco) {
        try {
            const baseUrl = this._apiBase();
            const res = await fetch(`${baseUrl}/auth/register-responsavel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome, email, senha, nomeAluno, turma, telefone, parentesco }),
                credentials: 'include'
            });
            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Erro ao registrar responsável.');
            }
            if (data.user) {
                this.currentUser = data.user;
                sessionStorage.setItem('currentUser', JSON.stringify(data.user));
            }
            return data;
        } catch (error) {
            console.error('Erro no registro de responsável:', error);
            throw error;
        }
    }

    /**
     * Define o perfil do usuário (professor ou diretor)
     */
    async setUserProfile(userId, perfil) {
        try {
            const baseUrl = this._apiBase();

            const res = await fetch(`${baseUrl}/usuarios/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    perfil,
                    perfilDefinidoEm: new Date().toISOString()
                }),
                credentials: 'include'
            });

            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Erro ao definir perfil no servidor');
            }

            const usuario = data.data;

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
            const baseUrl = this._apiBase();
            await fetch(`${baseUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
        } catch (e) {
            console.log('Logout silencioso no backend');
        }

        window.location.href = 'login.html';
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

    hasProfile() {
        if (!this.currentUser) return false;
        if (this.currentUser.perfil === 'admin') return true;
        // Se o usuário já tem um perfil definido (professor/diretor), considera como perfil completo
        // mesmo que perfilDefinidoEm não exista (contas criadas antes dessa feature)
        return this.currentUser.perfil === 'professor' || this.currentUser.perfil === 'diretor';
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
        
        // Sincroniza fotos em toda a interface
        if (window.updateAllAvatars) {
            window.updateAllAvatars(userData);
        }
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
