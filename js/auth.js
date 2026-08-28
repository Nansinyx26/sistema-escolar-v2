/**
 * Authentication Manager
 * Gerencia login com Email/Senha e Google OAuth (simulado offline)
 */

// ============================================================================
// RESOLUÇÃO DO PERFIL ATIVO — FONTE ÚNICA
// ============================================================================
// Antes cada tela decidia o rótulo por conta própria, e as quatro decisões
// discordavam entre si:
//
//   sidebar-voice.js  perfil === 'diretor' ? 'Diretor(a)' : 'Professor(a)'
//   dashboard.js      admin|professor|secretaria, resto → 'Diretor'
//   perfil.js         admin|professor|diretor, resto → 'Usuário'
//   chatbot-ia.js     admin → 'Diretor(a)'
//
// O primeiro é o bug relatado: um ternário binário faz TUDO que não é diretor
// virar "Professor(a)" — inclusive a conta admin, a secretaria e o responsável.
// O rótulo aparecia certo no dashboard e o sidebar o sobrescrevia logo depois.
//
// A regra agora é uma só, e ela é FAIL-CLOSED: sem perfil resolvido o rótulo é
// '—' e um erro vai ao console. Chutar 'professor' é pior que não exibir nada —
// dá ao operador a impressão de estar numa conta que não é a dele.
//
// Carregado por js/auth.js de propósito: é o único script presente nas 43
// páginas autenticadas, então nenhuma tela fica sem a função. Como `auth.js` é
// `defer` e todos os consumidores chamam no DOMContentLoaded, a ordem é segura
// mesmo nas páginas que carregam sidebar-voice.js sem `defer`.
// ============================================================================

const PERFIS_CONHECIDOS = {
    admin: 'Administrador(a)',
    diretor: 'Diretor(a)',
    secretaria: 'Secretário(a)',
    professor: 'Professor(a)',
    responsavel: 'Responsável',
};

/** Retornado quando o perfil não pode ser determinado. Nunca é um palpite. */
const PERFIL_INDEFINIDO = Object.freeze({ chave: null, rotulo: '—', origem: 'indefinido' });

/**
 * Resolve o perfil com que o usuário está operando AGORA.
 *
 * @param {object} usuario        Usuário como devolvido por /api/auth/login ou /api/auth/me.
 * @param {string} [escolaIdAtiva] Escola ativa da sessão. Quando o usuário tem
 *        `vinculos` (multi-escola), o cargo do vínculo DESSA escola vence o
 *        campo `perfil` do documento — nunca `vinculos[0]`, que devolveria o
 *        cargo de uma escola qualquer.
 * @returns {{chave: string|null, rotulo: string, origem: string}}
 */
function resolverPerfilAtivo(usuario, escolaIdAtiva) {
    if (!usuario || typeof usuario !== 'object') {
        console.error('[perfil] resolverPerfilAtivo chamado sem usuário.', { usuario });
        return PERFIL_INDEFINIDO;
    }

    // 1. Vínculo da escola ativa (multi-escola).
    if (escolaIdAtiva && Array.isArray(usuario.vinculos)) {
        const vinculo = usuario.vinculos.find((v) => String(v?.escolaId) === String(escolaIdAtiva));
        const normalizado = normalizarPerfil(vinculo?.cargo || vinculo?.perfil);
        if (normalizado) return montar(normalizado, usuario, 'vinculo');
    }

    // 2. Campo canônico do documento de usuário (models/Usuario.js → `perfil`).
    const doDocumento = normalizarPerfil(usuario.perfil);
    if (doDocumento) return montar(doDocumento, usuario, 'documento');

    // 3. Nada resolveu. Não inventa: registra e devolve indefinido.
    console.error(
        '[perfil] Não foi possível resolver o perfil do usuário. ' +
            'Verifique se /api/auth/me está devolvendo o campo `perfil`.',
        { id: usuario.id || usuario._id, perfilRecebido: usuario.perfil, escolaIdAtiva }
    );
    return PERFIL_INDEFINIDO;
}

/** Aceita só os valores do enum do schema. Qualquer outra coisa é ruído. */
function normalizarPerfil(valor) {
    if (typeof valor !== 'string') return null;
    const chave = valor.trim().toLowerCase();
    return Object.hasOwn(PERFIS_CONHECIDOS, chave) ? chave : null;
}

/**
 * O rótulo preferido é o que o BACKEND mandou (`perfilRotulo`). O mapa local só
 * entra quando a resposta é de uma versão anterior do servidor — assim mudar a
 * nomenclatura institucional não exige um deploy do front.
 */
function montar(chave, usuario, origem) {
    const doServidor = typeof usuario.perfilRotulo === 'string' && usuario.perfilRotulo.trim();
    return {
        chave,
        rotulo: doServidor ? usuario.perfilRotulo.trim() : PERFIS_CONHECIDOS[chave],
        origem,
    };
}

/** Atalho: só o texto a exibir. */
function rotuloPerfilAtivo(usuario, escolaIdAtiva) {
    return resolverPerfilAtivo(usuario, escolaIdAtiva).rotulo;
}

/**
 * Escola em que a sessão está operando, na ordem em que o backend a resolve:
 * escola do próprio usuário → contexto explícito da URL → escolha do modal.
 * Devolve `null` quando não há contexto — e `null` é uma resposta legítima:
 * admin e responsável operam sem escola fixa.
 */
function escolaAtivaId() {
    const usuario = window.auth && window.auth.getCurrentUser ? window.auth.getCurrentUser() : null;
    if (usuario && usuario.escolaId) return String(usuario.escolaId);
    if (window.EscolaContexto && window.EscolaContexto.id) return String(window.EscolaContexto.id);
    try {
        const salva = JSON.parse(localStorage.getItem('escolaSelecionada') || 'null');
        if (salva && salva.id) return String(salva.id);
    } catch (e) {
        /* valor corrompido — segue sem contexto */
    }
    return null;
}

window.resolverPerfilAtivo = resolverPerfilAtivo;
window.rotuloPerfilAtivo = rotuloPerfilAtivo;
window.PERFIS_CONHECIDOS = PERFIS_CONHECIDOS;
window.escolaAtivaId = escolaAtivaId;

// ============================================================================
// LIMPEZA DE ESTADO NA TROCA DE CONTA
// ============================================================================
// O logout anterior removia três chaves legadas e o `currentUser`. Tudo que era
// preferência DA CONTA — modo de narração, voz, escola selecionada, config do
// assistente — sobrevivia e era herdado pela conta seguinte no mesmo navegador.
//
// O sessionStorage vai inteiro (é escopo de aba, nada ali pertence ao aparelho).
// Do localStorage saem apenas as chaves ligadas à conta; `theme`, `clickSound` e
// `sidebar_collapsed` FICAM, porque são preferências do dispositivo — zerar o
// tema de quem apenas trocou de usuário seria uma regressão de usabilidade.
// ============================================================================
const CHAVES_DA_CONTA = [
    'escola_jwt', // legado
    'escola_jwt_user', // legado
    'escola_session', // legado
    'escolaSelecionada',
    'aichat_cfg_local',
    'user_narration_mode',
    'user_preferencia_narracao',
    'user_narrar_auto',
    'user_voice_speed',
    'user_voice_preference',
    'user_tts_provider',
    'user_elevenlabs_voice',
];

function limparEstadoDaConta() {
    try {
        sessionStorage.clear();
    } catch (e) {
        console.warn('[auth] Não foi possível limpar o sessionStorage.', e);
    }
    CHAVES_DA_CONTA.forEach((chave) => {
        try {
            localStorage.removeItem(chave);
        } catch (e) {
            /* storage indisponível */
        }
    });
}

window.limparEstadoDaConta = limparEstadoDaConta;

// ============================================================================
// MENSAGENS DO LOGIN — resolvidas por `codigo`, nunca pelo texto do servidor
// ============================================================================
// O front lançava `new Error(data.error)` e o texto do backend era exibido cru.
// Isso tornava a mensagem parte do contrato: renomear o texto no servidor
// mudava a interface, e não havia como distinguir "senha errada" de "conta
// temporariamente bloqueada" sem comparar strings.
//
// `codigo` é estável e enumerado. O texto do servidor vira apenas o fallback
// para um código que este front ainda não conhece.
// ============================================================================
const MENSAGENS_LOGIN = {
    CREDENCIAL_INVALIDA: 'E-mail ou senha incorretos. Verifique e tente novamente.',
    CODIGO_INVALIDO: 'Código inválido ou expirado. Peça um novo código.',
    MUITAS_TENTATIVAS: 'Muitas tentativas. Aguarde antes de tentar de novo.',
    ESCOLA_INDISPONIVEL: 'Esta escola ainda não está disponível no sistema.',
    SEM_VINCULO_ESCOLA: 'Você não possui vínculo com esta escola. Fale com a direção.',
};

/**
 * Erro de login com o código preservado, para a tela poder reagir ao caso
 * (ex.: iniciar contagem regressiva em MUITAS_TENTATIVAS) sem ler o texto.
 */
function erroDeLogin(data, status) {
    const codigo = (data && data.codigo) || (status === 429 ? 'MUITAS_TENTATIVAS' : null);
    let texto = MENSAGENS_LOGIN[codigo];

    if (!texto) {
        // Código desconhecido (servidor mais novo que este front): usa o texto
        // dele, que ao menos descreve algo, em vez de uma mensagem genérica.
        texto = (data && data.error) || 'Não foi possível entrar. Tente novamente.';
        if (codigo) console.warn('[auth] Código de login não mapeado neste front:', codigo);
    }

    if (codigo === 'MUITAS_TENTATIVAS' && data && data.retryEmSegundos > 0) {
        const minutos = Math.ceil(data.retryEmSegundos / 60);
        texto += ` Tente novamente em ${minutos} minuto${minutos > 1 ? 's' : ''}.`;
    }

    const erro = new Error(texto);
    erro.codigo = codigo;
    erro.status = status;
    erro.retryEmSegundos = (data && data.retryEmSegundos) || 0;
    return erro;
}

window.MENSAGENS_LOGIN = MENSAGENS_LOGIN;

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
            this.refreshUser().catch((e) => console.warn('Falha ao sincronizar perfil:', e));
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
                credentials: 'include', // IMPORTANTE: Para receber o cookie HttpOnly
            });

            const data = await res.json();

            if (!data.success) {
                // A tela reage a `erro.codigo`; o texto já vem pronto e traduzido.
                throw erroDeLogin(data, res.status);
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
                // O userId não vem mais na resposta: o alvo do 2FA é o cookie
                // de pré-autenticação emitido pelo backend no passo de senha.
                if (typeof window.abrirModal2FA === 'function') {
                    window.abrirModal2FA(data.message || email, data.redirect_to);
                }

                // `envioConfirmado: false` = o backend gerou o código mas o
                // provedor recusou a mensagem. Antes esse caso era mudo: a tela
                // pedia um código que nunca ia chegar. O campo só existe em
                // servidores atualizados — `=== false` evita alarme falso com
                // uma resposta antiga, onde ele vem `undefined`.
                if (data.envioConfirmado === false && typeof window.showToast === 'function') {
                    window.showToast(
                        'Não conseguimos enviar o código por e-mail. Use "Reenviar" ou fale com o administrador.',
                        'error'
                    );
                }

                // Retorna um indicador especial para o login.js não redirecionar
                return {
                    requires2FA: true,
                    redirect_to: data.redirect_to,
                    canal: data.canal || 'email',
                    destinoMascarado: data.destinoMascarado || '',
                    envioConfirmado: data.envioConfirmado,
                };
            }

            // O JWT agora é salvo automaticamente no cookie HttpOnly pelo navegador
            // SEGURANÇA: Não armazenamos mais o token no localStorage

            // ============================================
            // Troca de conta sem fechar o navegador.
            // ============================================
            // Sem esta limpeza, quem sai de uma conta de professor e entra como
            // admin herda o modo de narração, a voz e o contexto de escola da
            // sessão anterior — o "resíduo" que fazia a interface parecer de
            // outro usuário. A escola escolhida NESTE login é preservada: ela
            // acabou de ser gravada pelo modal, não é resto da conta anterior.
            const escolaDesteLogin = escolaId ? localStorage.getItem('escolaSelecionada') : null;
            limparEstadoDaConta();
            if (escolaDesteLogin) {
                try {
                    localStorage.setItem('escolaSelecionada', escolaDesteLogin);
                } catch (e) {
                    /* noop */
                }
            }

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
                body: JSON.stringify({ email, senha, nome, codigoEscola, cpf, telefone }),
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

    async registerDocente(
        nome,
        email,
        senha,
        disciplina,
        turma,
        matricula,
        telefone,
        codigoEscola
    ) {
        try {
            const baseUrl = this._apiBase();
            const res = await fetch(`${baseUrl}/auth/register-docente`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nome,
                    email,
                    senha,
                    disciplina,
                    turma,
                    matricula,
                    telefone,
                    codigoEscola,
                }),
                credentials: 'include',
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
                body: JSON.stringify({
                    nome,
                    email,
                    senha,
                    nomeAluno,
                    turma,
                    telefone,
                    parentesco,
                }),
                credentials: 'include',
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
                    perfilDefinidoEm: new Date().toISOString(),
                }),
                credentials: 'include',
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
        limparEstadoDaConta();

        // Chama rota de logout no backend para limpar o cookie HttpOnly
        try {
            const baseUrl = this._apiBase();
            await fetch(`${baseUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
        } catch (e) {
            console.log('Logout silencioso no backend');
        }

        // ============================================
        // CAMINHO ABSOLUTO, E NÃO 'login.html'
        // ============================================
        // O relativo resolvia contra o diretório da página atual. Sair de
        // `/html/secretaria/painel.html` procurava `/html/secretaria/login.html`,
        // que não existe — a pessoa deslogava e caía num 404, com a sessão já
        // encerrada e sem link de volta. O mesmo valia para /html/direcao,
        // /html/admin e /direcao; só funcionava a partir das telas que já
        // moravam na raiz de /html.
        //
        // O destino é o mesmo que `js/guarda-acesso.js` usa ao barrar alguém sem
        // sessão. Divergir aqui daria dois "lugares de onde se faz login".
        window.location.replace('/html/login.html');
    }

    /**
     * Obtém usuário atual
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Revalida o usuário contra o servidor (fonte de verdade da sessão via
     * cookie JWT). Corrige o caso de o sessionStorage ter um usuário antigo
     * em cache (ex.: troca de conta na mesma sessão do navegador), que fazia
     * o nome/foto exibidos não baterem com quem está logado de fato.
     */
    async refreshCurrentUser() {
        try {
            const baseUrl = this._apiBase();
            const res = await fetch(`${baseUrl}/auth/me`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.user) {
                    this.currentUser = data.user;
                    sessionStorage.setItem('currentUser', JSON.stringify(data.user));
                    return data.user;
                }
            }
        } catch (e) {
            // Sem rede: mantém o cache atual.
        }
        return null;
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
