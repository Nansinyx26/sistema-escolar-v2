/**
 * rotas.js — Módulo central de rotas do front
 * ============================================================================
 * NENHUM caminho de página administrativa deve ser escrito à mão em HTML ou JS.
 * Todos passam por aqui.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE AS ROTAS DO ADMIN NÃO SÃO CONSTANTES
 * ─────────────────────────────────────────────────────────────────────────
 * A área administrativa vive atrás de um prefixo secreto definido por variável
 * de ambiente (ADMIN_PATH). Com ele configurado, /html/admin/... responde 404
 * para todos e a área atende em /html/<segredo>/... — foi exatamente isso que
 * quebrou os quatro botões do painel, que montavam `admin/usuarios.html` no
 * HTML e batiam num caminho morto.
 *
 * Escrever o prefixo aqui como constante seria publicar o segredo em um arquivo
 * versionado e servido a qualquer visitante. Então ele é BUSCADO no servidor,
 * em GET /api/auth/rotas, que exige sessão e filtra por perfil: quem não tem
 * acesso à página não recebe o caminho dela.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMO USAR
 * ─────────────────────────────────────────────────────────────────────────
 * No HTML, marque o elemento com a CHAVE da rota, não com o caminho:
 *
 *     <button data-rota="admin.usuarios">Gerenciar Usuários</button>
 *     <a data-rota="admin.auditoria">Auditoria</a>
 *
 * `ROTAS.ativar()` (chamado sozinho no DOMContentLoaded) resolve as chaves,
 * preenche o href dos links e liga o clique dos botões. Elementos cuja rota o
 * perfil atual não pode acessar são ESCONDIDOS — antes eles apareciam e só
 * falhavam no clique.
 *
 * Em JS: `await ROTAS.ir('admin.configuracoes')`.
 *
 * Nota: este arquivo é um script clássico (window.ROTAS), não um módulo ESM com
 * `export`. Todo o front é carregado com <script src> comum; um `export` aqui
 * quebraria o carregamento de todas as páginas que o incluíssem.
 * ============================================================================
 */

(function () {
    'use strict';

    var API = function () { return window.API_BASE_URL || '/api'; };

    // Rotas fixas — não dependem de segredo, então são constantes de verdade.
    var ESTATICAS = {
        dashboard: '/html/dashboard.html',
        login: '/html/login.html',
        perfil: '/html/perfil.html',
        meusDados: '/html/meus-dados.html',
        secretaria: {
            painel: '/html/secretaria/painel.html',
            relatorios: '/html/secretaria/relatorios.html',
            matriculas: '/html/secretaria/matriculas.html',
            comunicados: '/html/secretaria/comunicados.html',
            documentos: '/html/secretaria/documentos.html',
            justificativas: '/html/secretaria/justificativas.html',
            importarAlunos: '/html/secretaria/importar-alunos.html'
        },
        direcao: {
            painel: '/html/direcao/index.html',
            biPedagogico: '/html/direcao/bi-pedagogico.html',
            gerenciarSecretaria: '/html/direcao/gerenciar-secretaria.html',
            iaAssistant: '/html/direcao/ia-assistant.html'
        }
    };

    var adminCache = null;      // mapa resolvido, ou {} quando sem acesso
    var adminPromessa = null;   // desduplica chamadas concorrentes

    /**
     * Busca as rotas administrativas no servidor. Uma vez por carregamento de
     * página: várias chamadas concorrentes compartilham a mesma promessa, senão
     * cada botão da tela dispararia sua própria requisição.
     */
    function carregarAdmin() {
        if (adminCache) return Promise.resolve(adminCache);
        if (adminPromessa) return adminPromessa;

        adminPromessa = fetch(API() + '/auth/rotas', { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (json) {
                adminCache = (json && json.success && json.rotas && json.rotas.admin) || {};
                return adminCache;
            })
            .catch(function (e) {
                console.error('[rotas] Falha ao resolver as rotas administrativas.', e);
                // NÃO faz cache do erro: um problema de rede momentâneo não pode
                // esconder o painel pelo resto da sessão.
                adminPromessa = null;
                return {};
            });

        return adminPromessa;
    }

    /** Lê 'secretaria.relatorios' dentro do objeto de rotas estáticas. */
    function estatica(chave) {
        return chave.split('.').reduce(function (obj, parte) {
            return obj && typeof obj === 'object' ? obj[parte] : undefined;
        }, ESTATICAS);
    }

    /**
     * Resolve uma chave para um caminho.
     * @returns {Promise<string|null>} null quando a rota não existe ou o perfil
     *          atual não tem acesso a ela. Nunca devolve um palpite.
     */
    function resolver(chave) {
        if (typeof chave !== 'string' || !chave) return Promise.resolve(null);

        if (chave.indexOf('admin.') === 0) {
            var pagina = chave.slice('admin.'.length);
            return carregarAdmin().then(function (mapa) { return mapa[pagina] || null; });
        }

        var caminho = estatica(chave);
        if (typeof caminho !== 'string') {
            console.error('[rotas] Rota desconhecida: ' + chave);
            return Promise.resolve(null);
        }
        return Promise.resolve(caminho);
    }

    /** Navega para a rota. Não faz nada (e registra) se ela não for acessível. */
    function ir(chave) {
        return resolver(chave).then(function (caminho) {
            if (!caminho) {
                console.error('[rotas] Sem caminho acessível para: ' + chave);
                if (typeof window.showToast === 'function') {
                    window.showToast('Você não tem acesso a esta página.', 'error');
                }
                return false;
            }
            window.location.href = caminho;
            return true;
        });
    }

    /**
     * Liga todos os `[data-rota]` da página.
     *
     * Idempotente: marca cada elemento já processado com `data-rota-ligada`.
     * Sem isso, uma segunda chamada (re-render de painel, por exemplo) somaria
     * um listener a mais e um clique navegaria duas vezes.
     */
    function ativar(raiz) {
        var escopo = raiz || document;
        var elementos = escopo.querySelectorAll('[data-rota]:not([data-rota-ligada])');
        if (!elementos.length) return Promise.resolve();

        return Promise.all(Array.prototype.map.call(elementos, function (el) {
            el.setAttribute('data-rota-ligada', '1');
            var chave = el.getAttribute('data-rota');

            return resolver(chave).then(function (caminho) {
                if (!caminho) {
                    // Sem acesso (ou rota inexistente): esconde em vez de deixar
                    // um botão que só descobre o 404 depois do clique.
                    el.hidden = true;
                    el.style.display = 'none';
                    return;
                }

                if (el.tagName === 'A') {
                    el.setAttribute('href', caminho);
                    return;
                }

                el.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    window.location.href = caminho;
                });
            });
        })).then(function () { /* void */ });
    }

    window.ROTAS = {
        estaticas: ESTATICAS,
        resolver: resolver,
        ir: ir,
        ativar: ativar,
        /** Descarta o cache — usar após trocar de conta na mesma aba. */
        limparCache: function () { adminCache = null; adminPromessa = null; }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { ativar(); });
    } else {
        ativar();
    }
})();
