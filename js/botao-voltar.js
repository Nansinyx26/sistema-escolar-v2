/**
 * js/botao-voltar.js
 * Gerenciador Central de Navegação e Botão Voltar
 *
 * Garante que o botão "<- Voltar" retorne à página anterior correta
 * conforme o histórico real da sessão (sessionStorage), sem links fixos,
 * e com fallback inteligente para o Dashboard do perfil correspondente.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.NavegacaoVoltar = factory();
    }
})(
    typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this,
    function () {
        'use strict';

        var STORAGE_STACK_KEY = 'app_nav_history_stack';
        var STORAGE_LAST_DASHBOARD_KEY = 'app_last_visited_dashboard';

        var DASHBOARDS = [
            '/html/direcao/index.html',
            '/html/secretaria/painel.html',
            '/html/dashboard.html',
            '/portal-responsavel/dist/index.html',
            '/portal-responsavel/index.html',
        ];

        var DASHBOARD_FALLBACKS_BY_ROLE = {
            diretor: '/html/direcao/index.html',
            secretaria: '/html/secretaria/painel.html',
            professor: '/html/dashboard.html',
            admin: '/html/dashboard.html',
            responsavel: '/portal-responsavel/dist/index.html',
        };

        /**
         * Lê a pilha do sessionStorage de forma segura.
         * @returns {string[]}
         */
        function getStack() {
            try {
                if (typeof sessionStorage === 'undefined') return [];
                var raw = sessionStorage.getItem(STORAGE_STACK_KEY);
                if (!raw) return [];
                var parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        }

        /**
         * Salva a pilha no sessionStorage.
         * @param {string[]} stack
         */
        function setStack(stack) {
            try {
                if (typeof sessionStorage === 'undefined') return;
                sessionStorage.setItem(STORAGE_STACK_KEY, JSON.stringify(stack));
            } catch (e) {
                // Storage inacessível ou cota excedida
            }
        }

        /**
         * Normaliza a URL para caminho relativo limpo com query string.
         * @param {string|Location} [url]
         * @returns {string}
         */
        function normalizeUrl(url) {
            if (!url && typeof window !== 'undefined' && window.location) {
                url = window.location.pathname + window.location.search;
            }
            if (typeof url !== 'string') {
                try {
                    url = (url.pathname || '') + (url.search || '');
                } catch (e) {
                    url = '/';
                }
            }
            // Remove protocolo, host e hash
            try {
                var parser =
                    typeof URL !== 'undefined' && url.includes('://') ? new URL(url) : null;
                if (parser) {
                    return (parser.pathname || '/') + (parser.search || '');
                }
            } catch (e) {}

            var clean = url.split('#')[0];
            if (clean.includes('://')) {
                var parts = clean.split('://')[1];
                var slashIdx = parts.indexOf('/');
                clean = slashIdx !== -1 ? parts.substring(slashIdx) : '/';
            }
            return clean.startsWith('/') ? clean : '/' + clean;
        }

        /**
         * Verifica se uma URL é considerada Dashboard principal.
         * @param {string} [url]
         * @returns {boolean}
         */
        function isDashboardUrl(url) {
            var clean = normalizeUrl(url).split('?')[0].toLowerCase();
            for (var i = 0; i < DASHBOARDS.length; i++) {
                var dash = DASHBOARDS[i].toLowerCase();
                if (
                    clean === dash ||
                    clean === dash.replace('/index.html', '/') ||
                    clean === dash.replace('.html', '')
                ) {
                    return true;
                }
            }
            // Identificação por caminhos específicos
            if (
                clean === '/html/direcao' ||
                clean === '/html/direcao/' ||
                clean === '/html/dashboard'
            ) {
                return true;
            }
            return false;
        }

        /**
         * Resolve o perfil do usuário atual a partir do cache da sessão.
         * @returns {string|null}
         */
        function getUserRole() {
            try {
                if (typeof sessionStorage !== 'undefined') {
                    var rawUser = sessionStorage.getItem('currentUser');
                    if (rawUser) {
                        var user = JSON.parse(rawUser);
                        if (user && user.perfil) return String(user.perfil).toLowerCase();
                    }
                    var role = sessionStorage.getItem('user_role');
                    if (role) return String(role).toLowerCase();
                }
                if (typeof localStorage !== 'undefined') {
                    var localUser = localStorage.getItem('currentUser');
                    if (localUser) {
                        var u = JSON.parse(localUser);
                        if (u && u.perfil) return String(u.perfil).toLowerCase();
                    }
                    var lRole = localStorage.getItem('user_role');
                    if (lRole) return String(lRole).toLowerCase();
                }
            } catch (e) {}
            return null;
        }

        /**
         * Obtém o Dashboard de fallback correspondente ao perfil ou último visitado.
         * @param {string} [customFallback]
         * @returns {string}
         */
        function getFallbackDashboard(customFallback) {
            if (customFallback && typeof customFallback === 'string' && customFallback !== '#') {
                return customFallback;
            }

            // 1. Tentar último dashboard visitado na sessão
            try {
                if (typeof sessionStorage !== 'undefined') {
                    var lastDash = sessionStorage.getItem(STORAGE_LAST_DASHBOARD_KEY);
                    if (lastDash && isDashboardUrl(lastDash)) {
                        return lastDash;
                    }
                }
            } catch (e) {}

            // 2. Tentar pelo perfil do usuário
            var role = getUserRole();
            if (role && DASHBOARD_FALLBACKS_BY_ROLE[role]) {
                return DASHBOARD_FALLBACKS_BY_ROLE[role];
            }

            // 3. Fallback padrão seguro do sistema
            return '/html/dashboard.html';
        }

        /**
         * Registra a página atual no histórico da sessão.
         * @param {string} [url]
         */
        function registrarPaginaAtual(url) {
            var current = normalizeUrl(url);

            // Se a página for um Dashboard, reseta a pilha e guarda como último dashboard
            if (isDashboardUrl(current)) {
                try {
                    if (typeof sessionStorage !== 'undefined') {
                        sessionStorage.setItem(STORAGE_LAST_DASHBOARD_KEY, current);
                    }
                } catch (e) {}
                setStack([current]);
                return;
            }

            var stack = getStack();

            // Se a pilha estiver vazia, adiciona o fallback de entrada e a página atual
            if (stack.length === 0) {
                var fallback = getFallbackDashboard();
                stack.push(fallback);
                stack.push(current);
                setStack(stack);
                return;
            }

            var top = stack[stack.length - 1];

            // Se for recarregamento (F5) ou a mesma URL, não duplica
            if (top === current) {
                return;
            }

            // Se o usuário navegou de volta para uma página já presente no histórico, trunca o ciclo
            var existingIndex = stack.lastIndexOf(current);
            if (existingIndex !== -1 && existingIndex > 0) {
                stack = stack.slice(0, existingIndex + 1);
            } else {
                stack.push(current);
            }

            // Limita o tamanho máximo da pilha a 30 entradas para evitar estouro de memória
            if (stack.length > 30) {
                stack = stack.slice(stack.length - 30);
            }

            setStack(stack);
        }

        /**
         * Executa a ação de voltar, desempilhando e navegando para a página anterior.
         * @param {string} [customFallback]
         */
        function voltar(customFallback) {
            var current = typeof window !== 'undefined' && window.location ? normalizeUrl() : '';
            var stack = getStack();

            // Se o topo for a página atual, remove
            if (stack.length > 0 && stack[stack.length - 1] === current) {
                stack.pop();
            }

            var target = null;
            if (stack.length > 0) {
                target = stack.pop();
            }

            // Garante que o target não seja idêntico à página atual
            while (target === current && stack.length > 0) {
                target = stack.pop();
            }

            if (!target) {
                target = getFallbackDashboard(customFallback);
                stack = [target];
            }

            setStack(stack);

            if (typeof window !== 'undefined' && window.location) {
                window.location.href = target;
            }

            return target;
        }

        /**
         * Retorna a URL para onde o botão voltar irá levar.
         * @param {string} [customFallback]
         * @returns {string}
         */
        function obterUrlVoltar(customFallback) {
            var current = typeof window !== 'undefined' && window.location ? normalizeUrl() : '';
            var stack = getStack();
            var copy = stack.slice();

            if (copy.length > 0 && copy[copy.length - 1] === current) {
                copy.pop();
            }

            var target = copy.length > 0 ? copy[copy.length - 1] : null;
            if (!target || target === current) {
                target = getFallbackDashboard(customFallback);
            }
            return target;
        }

        /**
         * Cria e monta o botão Voltar na interface.
         */
        function montarInterface() {
            if (typeof document === 'undefined' || typeof window === 'undefined') return;

            var isDash = isDashboardUrl();
            if (isDash) {
                if (document.body) document.body.classList.add('is-dashboard-page');
                // Remove ou oculta botões de voltar em páginas de Dashboard
                var dashBtns = document.querySelectorAll(
                    '.btn-voltar-global, #btnVoltarNav, [data-voltar], a.btn-voltar'
                );
                dashBtns.forEach(function (btn) {
                    btn.style.display = 'none';
                });
                return;
            }

            // Garante que o CSS do botão voltar esteja presente no documento
            if (!document.querySelector('link[href*="botao-voltar.css"]')) {
                var link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = '/css/botao-voltar.css';
                document.head.appendChild(link);
            }

            // Busca botões existentes
            var seletores = [
                '.btn-voltar-global',
                '#btnVoltarNav',
                '#btnVoltar',
                '.btn-voltar',
                '[data-voltar]',
                '.header-back',
            ];
            var existentes = document.querySelectorAll(seletores.join(', '));

            if (existentes.length > 0) {
                existentes.forEach(function (btn) {
                    configurarBotao(btn);
                });
                return;
            }

            // Se não houver botão, injeta automaticamente no canto superior esquerdo
            injetarBotaoPadrao();
        }

        /**
         * Configura um botão de voltar existente.
         * @param {HTMLElement} btn
         */
        function configurarBotao(btn) {
            if (!btn || btn.dataset.voltarConfigurado === 'true') return;
            btn.dataset.voltarConfigurado = 'true';

            btn.classList.add('btn-voltar-global');
            if (!btn.getAttribute('aria-label')) {
                btn.setAttribute('aria-label', 'Voltar à página anterior');
            }

            // Se o botão não tiver conteúdo, preenche com ícone e texto padrão
            if (!btn.innerHTML.trim() || btn.innerHTML.trim() === 'Voltar') {
                btn.innerHTML = '<i class="bi bi-arrow-left"></i><span>Voltar</span>';
            }

            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                voltar(btn.getAttribute('data-fallback') || btn.getAttribute('href'));
            });
        }

        /**
         * Injeta o botão padrão no local mais adequado do topo da página.
         */
        function injetarBotaoPadrao() {
            if (typeof document === 'undefined') return;

            var btn = document.createElement('a');
            btn.href = 'javascript:void(0)';
            btn.className = 'btn-voltar-global';
            btn.id = 'btnVoltarNav';
            btn.setAttribute('aria-label', 'Voltar à página anterior');
            btn.innerHTML = '<i class="bi bi-arrow-left"></i><span>Voltar</span>';
            configurarBotao(btn);

            // Pontos de ancoragem no topo da página
            var apHeader = document.querySelector('.ap-top-header');
            if (apHeader) {
                var searchGlobal = apHeader.querySelector('.ap-search-global');
                if (searchGlobal) {
                    apHeader.insertBefore(btn, searchGlobal);
                    return;
                }
                apHeader.prepend(btn);
                return;
            }

            var navbarContent = document.querySelector('.navbar-content');
            if (navbarContent) {
                var navbarBrand = navbarContent.querySelector('.navbar-brand');
                if (navbarBrand && navbarBrand.nextSibling) {
                    navbarContent.insertBefore(btn, navbarBrand.nextSibling);
                    return;
                }
                navbarContent.prepend(btn);
                return;
            }

            var navbar = document.querySelector('.navbar, nav');
            if (navbar) {
                navbar.prepend(btn);
                return;
            }

            var detalhesHeader = document.querySelector('.detalhes-header');
            if (detalhesHeader) {
                detalhesHeader.prepend(btn);
                return;
            }

            var container = document.querySelector('.container, .main-content, .page, main');
            if (container) {
                var wrapper = document.createElement('div');
                wrapper.className = 'btn-voltar-top-left-container';
                wrapper.appendChild(btn);
                container.prepend(wrapper);
                return;
            }

            if (document.body) {
                var bodyWrapper = document.createElement('div');
                bodyWrapper.className = 'btn-voltar-top-left-container';
                bodyWrapper.style.padding = '1rem';
                bodyWrapper.appendChild(btn);
                document.body.prepend(bodyWrapper);
            }
        }

        // Inicialização automática no carregamento
        if (typeof window !== 'undefined') {
            registrarPaginaAtual();

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', montarInterface);
            } else {
                montarInterface();
            }

            // Expõe globalmente para retrocompatibilidade com smartBack
            window.smartBack = function (fallback) {
                return voltar(fallback);
            };
        }

        return {
            getStack: getStack,
            setStack: setStack,
            normalizeUrl: normalizeUrl,
            isDashboardUrl: isDashboardUrl,
            getUserRole: getUserRole,
            getFallbackDashboard: getFallbackDashboard,
            registrarPaginaAtual: registrarPaginaAtual,
            voltar: voltar,
            obterUrlVoltar: obterUrlVoltar,
            montarInterface: montarInterface,
            configurarBotao: configurarBotao,
            injetarBotaoPadrao: injetarBotaoPadrao,
            DASHBOARDS: DASHBOARDS,
            DASHBOARD_FALLBACKS_BY_ROLE: DASHBOARD_FALLBACKS_BY_ROLE,
        };
    }
);
