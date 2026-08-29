/**
 * guarda-acesso.js
 * ============================================================================
 * O ESPELHO DA MATRIZ DE ACESSO NO NAVEGADOR — a decisão antes do primeiro pixel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ISTO NÃO É AUTORIZAÇÃO. LEIA ANTES DE MEXER.
 * ─────────────────────────────────────────────────────────────────────────
 * Quem autoriza é `backend/src/middleware/protegerPaginas.js`, no servidor,
 * antes de qualquer byte sair. Este arquivo roda DEPOIS de o HTML já estar no
 * navegador — logo, tudo que ele faz é reversível por quem abrir o DevTools, e
 * nada aqui pode ser a única coisa entre uma pessoa e uma tela que não é dela.
 *
 * O problema que ele resolve é outro, e é real: mesmo com o gate do servidor
 * correto, existem páginas que CHEGAM legitimamente ao navegador e mesmo assim
 * não deviam ser exibidas para quem está olhando. O caso concreto é o Service
 * Worker — `service-worker.js` guarda navegações em cache e as devolve offline
 * ou em rede ruim, sem passar pelo servidor. Depois de um logout, ou numa troca
 * de conta no mesmo aparelho, a página cacheada aparece inteira. A checagem
 * antiga, escrita dentro de cada tela e rodando no `DOMContentLoaded`, chegava
 * tarde: a interface já tinha pintado. Era o "pisca" relatado.
 *
 * Daí as duas regras que governam este arquivo:
 *
 *   1. Ele entra SEM `defer` e o mais cedo possível no `<head>`, antes de
 *      qualquer CSS de tela. `defer` adiaria a execução para depois do parse do
 *      documento — ou seja, para depois do pixel que ele existe para impedir.
 *   2. Ele esconde primeiro e pergunta depois. Enquanto não há veredito, o
 *      documento fica invisível; ao final, ou revela, ou navega para outro
 *      lugar. Nunca revela "por precaução".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ...MAS TAMBÉM NÃO PODE DEIXAR NINGUÉM NA TELA BRANCA
 * ─────────────────────────────────────────────────────────────────────────
 * Esconder o documento é uma faca de dois gumes: um erro de JS, um `fetch` que
 * nunca resolve ou um navegador sem `sessionStorage` transformariam o guard em
 * uma página permanentemente em branco — um defeito PIOR que o pisca, e num
 * lugar onde a pessoa não tem o que fazer a respeito.
 *
 * Por isso todo o corpo roda dentro de `try/catch`, e existe um prazo máximo
 * (`PRAZO_REVELAR_MS`) depois do qual o documento aparece de qualquer jeito.
 * Revelar por timeout é seguro precisamente porque este arquivo não é a defesa:
 * se o servidor não devia ter entregue a página, ele não a entregou.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE A MATRIZ VEM EMBUTIDA, E NÃO DE `GET /api/auth/matriz-acesso`
 * ─────────────────────────────────────────────────────────────────────────
 * Porque uma decisão que espera resposta de rede não é uma decisão antes do
 * primeiro pixel. Buscar a matriz custaria um RTT com a tela escondida — em
 * conexão ruim, exatamente o cenário do Service Worker, isso é meio segundo de
 * página branca em toda navegação. A cópia embutida decide em microssegundos.
 *
 * O endpoint existe assim mesmo, e é usado depois do veredito, em segundo
 * plano: ele é a correção de rota para quando este JS cacheado ficar mais velho
 * que o servidor. Divergência dentro do mesmo deploy é impedida por teste —
 * `backend/src/tests/matrizAcesso.test.js` compara este arquivo com
 * `utils/matrizAcesso.js` regra por regra e falha no CI se alguém mexer só de
 * um lado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE NÃO ESTÁ AQUI: A ÁREA ADMINISTRATIVA
 * ─────────────────────────────────────────────────────────────────────────
 * A matriz abaixo não menciona `/html/admin`, e isso é de propósito. Sob
 * `ADMIN_PATH`, a área vive num prefixo secreto que o servidor não conta ao
 * navegador — publicar a regra puxaria o caminho junto. Essas páginas caem no
 * padrão do desconhecido: exigem sessão, sem exigir perfil. É o veredito certo,
 * porque quem chegou lá já passou pelo gate do servidor; e uma tela que o
 * servidor não entrega não tem como piscar. O raciocínio completo está em
 * `matrizPublicavel()`, no backend.
 * ============================================================================
 */

(function () {
    'use strict';

    // ── Espelho de `matrizPublicavel()` ────────────────────────────────────
    // GERADO A PARTIR DO BACKEND. Não edite à mão: mude
    // `backend/src/utils/matrizAcesso.js` e traga a alteração para cá — o teste
    // de paridade cobra as duas pontas.
    var MATRIZ = {
        areas: {
            '/html/secretaria': {
                perfis: ['admin', 'diretor', 'secretaria'],
            },
            '/html/direcao': {
                perfis: ['admin', 'diretor'],
            },
            '/html/conversas.html': {
                perfis: ['admin', 'diretor', 'secretaria', 'professor', 'responsavel'],
            },
            '/html/dashboard.html': {
                perfis: ['admin', 'diretor', 'professor', 'secretaria'],
                redirecionarAoPainel: true,
            },
            '/direcao': {
                perfis: ['admin', 'diretor'],
                excecoes: {
                    'codigos-secretos.html': ['admin', 'diretor', 'secretaria'],
                    'codigos-secretos.js': ['admin', 'diretor', 'secretaria'],
                },
            },
        },
        publicas: [
            '/',
            '/index.html',
            '/html/404.html',
            '/html/500.html',
            '/html/offline.html',
            '/html/login.html',
            '/html/login-diretor.html',
            '/html/login-professor.html',
            '/html/login-secretaria.html',
            '/html/primeiro-acesso.html',
            '/html/reset-password.html',
            '/html/politica-privacidade.html',
            '/html/escolher-perfil.html',
            '/html/selecionar.html',
            '/html/cadastro-diretor.html',
            '/html/cadastro-professor.html',
            '/html/pages/cadastro-diretor-publico.html',
            '/html/pages/cadastro-docente.html',
            '/html/pages/cadastro-responsavel.html',
            '/html/pages/cadastro-secretaria-publico.html',
            '/html/pages/primeiro-acesso.html',
        ],
        semSessao: ['entrar.html'],
        paineis: {
            admin: '/html/dashboard.html',
            diretor: '/html/dashboard.html',
            professor: '/html/dashboard.html',
            secretaria: '/html/secretaria/painel.html',
            responsavel: '/portal-responsavel/dist/index.html',
        },
        painelPadrao: '/html/escolher-perfil.html',
    };

    /**
     * Prazo máximo com o documento escondido. Passado ele, a página aparece
     * mesmo sem veredito — ver o bloco "tela branca" no topo. 2,5s é longo o
     * bastante para um `/api/auth/me` em 3G e curto o bastante para não parecer
     * travamento.
     */
    var PRAZO_REVELAR_MS = 2500;

    /** Marca no `<html>`, para o CSS da página poder reagir se quiser. */
    var ATRIBUTO_ESTADO = 'data-guarda-acesso';
    var ID_ESTILO = 'guarda-acesso-oculto';

    // ── Normalização — idêntica à de `matrizAcesso.normalizarCaminho` ──────
    function normalizarCaminho(caminho) {
        var s = String(caminho || '/').replace(/\\/g, '/');
        s = s.replace(/\/{2,}/g, '/');
        if (s.length > 1 && s.charAt(s.length - 1) === '/') s = s.slice(0, -1);
        return s.toLowerCase();
    }

    function dentroDe(caminho, prefixo) {
        return caminho === prefixo || caminho.indexOf(prefixo + '/') === 0;
    }

    function arquivoDe(caminho) {
        var partes = normalizarCaminho(caminho).split('/');
        return partes[partes.length - 1] || '';
    }

    /**
     * Veredito sobre um caminho. Mesma ordem de decisão do servidor: área
     * restrita primeiro (com a exceção por arquivo vencendo a área), depois a
     * lista de públicas, e por último o padrão fechado do desconhecido.
     */
    function vereditoDe(caminho) {
        var alvo = normalizarCaminho(caminho);
        var arquivo = arquivoDe(alvo);
        var prefixo;

        // Tela de login de área, avaliada por NOME DE ARQUIVO e antes de tudo.
        // É o que impede o guard de mandar para o login a própria página de
        // login da área administrativa, que sob `ADMIN_PATH` chega num caminho
        // que este espelho não reconhece. O raciocínio inteiro está na função
        // equivalente do backend.
        if (MATRIZ.semSessao.indexOf(arquivo) !== -1) {
            return { publica: false, exigeSessao: false, perfis: null, aoPainel: false };
        }

        for (prefixo in MATRIZ.areas) {
            if (!Object.hasOwn(MATRIZ.areas, prefixo)) continue;
            if (!dentroDe(alvo, prefixo)) continue;

            var config = MATRIZ.areas[prefixo];
            var excecao = config.excecoes && config.excecoes[arquivo];
            return {
                publica: false,
                exigeSessao: true,
                perfis: excecao || config.perfis,
                aoPainel: config.redirecionarAoPainel === true,
            };
        }

        if (MATRIZ.publicas.indexOf(alvo) !== -1) {
            return { publica: true, exigeSessao: false, perfis: null, aoPainel: false };
        }

        // Desconhecido: exige sessão, não exige perfil. Ver PADRAO_DESCONHECIDO
        // no backend.
        return { publica: false, exigeSessao: true, perfis: null, aoPainel: false };
    }

    function painelDoPerfil(perfil) {
        var chave = String(perfil || '')
            .trim()
            .toLowerCase();
        return MATRIZ.paineis[chave] || MATRIZ.painelPadrao;
    }

    // ── Esconder / revelar ────────────────────────────────────────────────
    // `visibility` e não `display:none`: o layout continua sendo calculado, e a
    // página revelada não precisa refazer o trabalho todo — a revelação sai sem
    // salto. Também não usa `opacity`, que ainda pinta.
    function esconder() {
        var raiz = document.documentElement;
        raiz.setAttribute(ATRIBUTO_ESTADO, 'verificando');
        if (document.getElementById(ID_ESTILO)) return;
        var estilo = document.createElement('style');
        estilo.id = ID_ESTILO;
        estilo.textContent =
            'html[' + ATRIBUTO_ESTADO + '="verificando"]{visibility:hidden!important}';
        // `documentElement` e não `head`: este script roda tão cedo que o
        // `<head>` pode ainda não estar fechado, e em alguns navegadores
        // `document.head` é nulo neste ponto.
        (document.head || raiz).appendChild(estilo);
    }

    function revelar() {
        document.documentElement.setAttribute(ATRIBUTO_ESTADO, 'liberado');
    }

    /**
     * Sai da página. `replace` e não `href`: quem foi barrado não deve conseguir
     * voltar para cá com o botão "voltar" e ver a tela cacheada de novo — que é
     * um dos caminhos pelos quais o defeito original aparecia.
     */
    function sair(destino) {
        try {
            window.location.replace(destino);
        } catch (e) {
            window.location.href = destino;
        }
    }

    /** Base da API. Ver comentário em `resolverSessao`. */
    function baseApi() {
        if (window.API_BASE_URL) return window.API_BASE_URL;
        var host = window.location.hostname;
        var localzinho =
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '::1' ||
            /^(127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|10\.)/.test(host) ||
            window.location.protocol === 'file:';
        return localzinho
            ? 'http://' + (host || 'localhost') + ':3001/api'
            : 'https://sistema-escolar-bfty.onrender.com/api';
    }

    /** Perfil em cache da sessão, ou `null`. */
    function perfilDoCache() {
        try {
            var bruto = sessionStorage.getItem('currentUser');
            if (!bruto) return null;
            var usuario = JSON.parse(bruto);
            return (usuario && usuario.perfil) || null;
        } catch (e) {
            // Storage bloqueado (modo privado, política do navegador) ou JSON
            // corrompido. Sem cache é um estado legítimo, não um erro.
            return null;
        }
    }

    /**
     * Confirma a sessão contra o servidor, que é a única fonte de verdade.
     *
     * `window.API_BASE_URL` costuma NÃO existir aqui: quem o define é
     * `js/api-config.js`, que carrega depois — este script roda antes de tudo,
     * de propósito. Daí a detecção própria em `baseApi()`, que repete a de lá.
     * Duplicação consciente: fundir as duas exigiria carregar o api-config
     * antes do guard, e aí o guard deixaria de ser a primeira coisa a rodar.
     */
    function resolverSessao() {
        return fetch(baseApi() + '/auth/me', { credentials: 'include' })
            .then(function (res) {
                if (!res.ok) return null;
                return res.json();
            })
            .then(function (dados) {
                if (dados && dados.success && dados.user) return dados.user.perfil || null;
                return null;
            })
            .catch(function () {
                // Offline ou API fora do ar. `undefined` (e não `null`) para o
                // chamador distinguir "o servidor disse que não há sessão" de
                // "não deu para perguntar" — as duas merecem respostas
                // diferentes.
                return undefined;
            });
    }

    /**
     * Aplica o veredito a um perfil já resolvido.
     * @returns {boolean} `true` quando pode ficar na página.
     */
    function permitido(veredito, perfil) {
        if (veredito.publica || !veredito.exigeSessao) return true;
        if (!perfil) return false;
        if (veredito.perfis === null) return true; // basta estar autenticado
        return veredito.perfis.indexOf(String(perfil).trim().toLowerCase()) !== -1;
    }

    /** Para onde mandar quem foi barrado. */
    function destinoDeNegado(perfil) {
        // Sem sessão: login, com o caminho atual guardado pelo servidor no
        // cookie `destino_pos_login` quando ele mesmo barra. Aqui não há o que
        // guardar — o servidor entregou a página, então este caso é o da tela
        // cacheada depois do logout, e o retorno certo é a tela de entrada.
        if (!perfil) return '/html/login.html';

        // Com sessão e perfil errado: o painel DA PESSOA, nunca uma tela de
        // erro. Mesma escolha que `redirecionarAoPainel` faz no servidor, e
        // pelo mesmo motivo — negar sem destino deixa o usuário preso.
        var painel = painelDoPerfil(perfil);
        return normalizarCaminho(painel) === normalizarCaminho(window.location.pathname)
            ? MATRIZ.painelPadrao
            : painel;
    }

    /**
     * Reconciliação tardia com o servidor. Roda com a página JÁ visível e sem
     * segurar nada: serve para o caso do JS cacheado ser mais antigo que o
     * deploy, em que a cópia embutida pode liberar uma tela que a matriz atual
     * fechou. Só age quando o veredito ATUAL do servidor é mais restritivo.
     */
    function reconciliarComServidor(caminho, perfil) {
        fetch(baseApi() + '/auth/matriz-acesso', { credentials: 'omit' })
            .then(function (res) {
                return res.ok ? res.json() : null;
            })
            .then(function (dados) {
                if (!dados || !dados.success || !dados.matriz) return;
                var anterior = MATRIZ;
                MATRIZ = dados.matriz;
                if (!permitido(vereditoDe(caminho), perfil)) {
                    sair(destinoDeNegado(perfil));
                    return;
                }
                // Nada a fazer, mas a matriz nova fica valendo para quem
                // consultar a API pública deste módulo depois.
                void anterior;
            })
            .catch(function () {
                /* sem rede: a cópia embutida segue valendo */
            });
    }

    // ── Execução ──────────────────────────────────────────────────────────
    var caminhoAtual = normalizarCaminho(window.location.pathname);
    var vereditoAtual = vereditoDe(caminhoAtual);

    // API pública, para as telas que ainda queiram perguntar (e para o teste).
    window.GuardaAcesso = {
        vereditoDe: vereditoDe,
        permitido: permitido,
        painelDoPerfil: painelDoPerfil,
        normalizarCaminho: normalizarCaminho,
        matriz: function () {
            return MATRIZ;
        },
    };

    // Página pública não esconde nada: seria custo de renderização em toda
    // visita anônima, para uma pergunta cuja resposta já é conhecida.
    if (vereditoAtual.publica || !vereditoAtual.exigeSessao) return;

    try {
        esconder();
    } catch (e) {
        // Se nem esconder deu certo, não há guard — e não há motivo para
        // impedir a página de carregar por causa disso.
        return;
    }

    var jaResolveu = false;
    function concluir(acao) {
        if (jaResolveu) return;
        jaResolveu = true;
        acao();
    }

    // Rede da segurança contra a tela branca (ver topo do arquivo).
    var prazo = window.setTimeout(function () {
        concluir(revelar);
    }, PRAZO_REVELAR_MS);

    try {
        var perfilCache = perfilDoCache();

        // Com cache e permissão, revela IMEDIATAMENTE — é o caminho comum, e é
        // o que mantém a promessa de "antes do primeiro pixel". A confirmação
        // com o servidor continua acontecendo logo abaixo, e derruba a página
        // se o cache estiver mentindo.
        if (perfilCache && permitido(vereditoAtual, perfilCache)) {
            window.clearTimeout(prazo);
            concluir(revelar);
        }

        resolverSessao()
            .then(function (perfilServidor) {
                // `undefined` = não deu para perguntar. Vale o cache: se o
                // servidor não devia ter entregue esta página, ele não teria
                // entregado. Derrubar o usuário legítimo por causa de uma queda
                // de rede seria trocar um defeito por outro.
                var perfil = perfilServidor === undefined ? perfilCache : perfilServidor;

                if (permitido(vereditoAtual, perfil)) {
                    window.clearTimeout(prazo);
                    concluir(revelar);
                    if (perfilServidor !== undefined) reconciliarComServidor(caminhoAtual, perfil);
                    return;
                }

                window.clearTimeout(prazo);
                // NÃO revela antes de sair: o ponto do guard é a tela errada
                // nunca aparecer.
                jaResolveu = true;
                sair(destinoDeNegado(perfil));
            })
            .catch(function () {
                window.clearTimeout(prazo);
                concluir(revelar);
            });
    } catch (e) {
        window.clearTimeout(prazo);
        concluir(revelar);
    }
})();
