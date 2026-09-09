/**
 * acessibilidade.js — os controles que a LBI exige que o software ofereça.
 *
 * POR QUE O SISTEMA PRECISA DISSO SE O NAVEGADOR JÁ TEM ZOOM
 * ----------------------------------------------------------
 * O navegador tem zoom, tem leitor de tela e tem modo de alto contraste — e a
 * maior parte das pessoas que precisa deles não sabe onde ficam. Quem usa este
 * sistema é professor, mãe, avó que busca o neto na escola. A Lei Brasileira de
 * Inclusão e o eMAG pedem que o RECURSO esteja na aplicação, alcançável de
 * qualquer página, e não que exista em algum lugar do sistema operacional.
 *
 * O QUE ESTE ARQUIVO FAZ
 * ----------------------
 *   • injeta o "Pular para o conteúdo" (WCAG 2.4.1) — quem navega por teclado
 *     repete o cabeçalho inteiro em toda página sem ele;
 *   • oferece alto contraste, escala de texto, sublinhado de links e redução de
 *     animação, guardados por navegador;
 *   • respeita `prefers-reduced-motion` como PADRÃO: quem já pediu menos
 *     animação no sistema operacional não precisa pedir de novo aqui.
 *
 * A PREFERÊNCIA É APLICADA ANTES DE TUDO
 * --------------------------------------
 * `aplicar()` roda na primeira linha da execução, antes de montar qualquer
 * interface. Se esperasse o DOMContentLoaded, a pessoa que escolheu alto
 * contraste veria a página piscar no tema normal a cada navegação.
 *
 * PERSISTÊNCIA QUE PODE FALHAR
 * ----------------------------
 * `localStorage` lança em navegação privativa e com cookies bloqueados. Toda
 * leitura e escrita está em try/catch: a pessoa perde a memória da preferência,
 * nunca a página.
 */
(function () {
    'use strict';

    var CHAVE = 'acessibilidade:preferencias';
    var ESCALAS = ['100', '115', '130'];

    function ler() {
        try {
            return JSON.parse(localStorage.getItem(CHAVE) || '{}') || {};
        } catch (_e) {
            return {};
        }
    }

    function gravar(prefs) {
        try {
            localStorage.setItem(CHAVE, JSON.stringify(prefs));
        } catch (_e) {
            /* navegação privativa: segue sem memória */
        }
    }

    var prefs = ler();

    function prefereMenosMovimento() {
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (_e) {
            return false;
        }
    }

    function aplicar() {
        var raiz = document.documentElement;
        raiz.setAttribute('data-contraste', prefs.contraste === 'alto' ? 'alto' : 'normal');
        raiz.setAttribute('data-escala-texto', prefs.escala || '100');
        raiz.setAttribute('data-links-sublinhados', prefs.sublinhar ? '1' : '0');

        // A escolha explícita vence; sem escolha, vale o que o sistema
        // operacional já diz sobre a pessoa.
        var reduzir = prefs.animacao === undefined ? prefereMenosMovimento() : !!prefs.animacao;
        raiz.setAttribute('data-animacao', reduzir ? 'reduzida' : 'normal');
    }

    aplicar();

    function definir(chave, valor) {
        prefs[chave] = valor;
        gravar(prefs);
        aplicar();
    }

    function botao(html, rotuloAria, pressionado, aoClicar) {
        var b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = html;
        b.setAttribute('aria-label', rotuloAria);
        b.setAttribute('aria-pressed', pressionado ? 'true' : 'false');
        b.addEventListener('click', function () {
            var novo = b.getAttribute('aria-pressed') !== 'true';
            b.setAttribute('aria-pressed', novo ? 'true' : 'false');
            aoClicar(novo);
        });
        return b;
    }

    function grupo(titulo, filhos) {
        var div = document.createElement('div');
        div.className = 'acessibilidade-grupo';
        var span = document.createElement('span');
        span.textContent = titulo;
        div.appendChild(span);
        filhos.forEach(function (filho) {
            div.appendChild(filho);
        });
        return div;
    }

    /** "Pular para o conteúdo" — criado só se a página tiver um alvo. */
    function montarSkipLink() {
        if (document.querySelector('.skip-link')) return;
        var alvo = document.querySelector('main, [role="main"], #conteudo');
        if (!alvo) return;
        if (!alvo.id) alvo.id = 'conteudo-principal';
        // `tabindex="-1"` para que o alvo possa RECEBER o foco pelo link; sem
        // isso o navegador rola a página mas o foco continua no cabeçalho, e
        // o leitor de tela segue lendo o menu.
        if (!alvo.hasAttribute('tabindex')) alvo.setAttribute('tabindex', '-1');

        var link = document.createElement('a');
        link.className = 'skip-link';
        link.href = '#' + alvo.id;
        link.textContent = 'Pular para o conteúdo';
        document.body.insertBefore(link, document.body.firstChild);
    }

    function montarPainel() {
        if (document.querySelector('.acessibilidade-botao')) return;

        var abre = document.createElement('button');
        abre.type = 'button';
        abre.className = 'acessibilidade-botao';
        abre.id = 'btn-acessibilidade';
        abre.innerHTML = '<i class="bi bi-universal-access" aria-hidden="true"></i>';
        abre.title = 'Acessibilidade';
        abre.setAttribute('aria-label', 'Opções de acessibilidade');
        abre.setAttribute('aria-expanded', 'false');
        abre.setAttribute('aria-controls', 'painel-acessibilidade');

        var painel = document.createElement('div');
        painel.className = 'acessibilidade-painel';
        painel.id = 'painel-acessibilidade';
        painel.setAttribute('role', 'group');
        painel.setAttribute('aria-label', 'Opções de acessibilidade');
        painel.hidden = true;

        var topo = document.createElement('div');
        topo.className = 'acessibilidade-painel-header';

        var titulo = document.createElement('h2');
        titulo.innerHTML =
            '<i class="bi bi-universal-access" aria-hidden="true"></i> Acessibilidade';
        topo.appendChild(titulo);

        var fechar = document.createElement('button');
        fechar.type = 'button';
        fechar.className = 'acessibilidade-fechar';
        fechar.setAttribute('aria-label', 'Fechar painel de acessibilidade');
        fechar.innerHTML = '<i class="bi bi-x" aria-hidden="true"></i>';
        fechar.addEventListener('click', function () {
            painel.hidden = true;
            abre.setAttribute('aria-expanded', 'false');
            abre.focus();
        });
        topo.appendChild(fechar);
        painel.appendChild(topo);

        painel.appendChild(
            grupo('Contraste', [
                botao(
                    '<i class="bi bi-circle-half" aria-hidden="true"></i> Alto contraste',
                    'Ativar alto contraste',
                    prefs.contraste === 'alto',
                    function (ligado) {
                        definir('contraste', ligado ? 'alto' : 'normal');
                    }
                ),
            ])
        );

        var menor = document.createElement('button');
        menor.type = 'button';
        menor.innerHTML = '<i class="bi bi-zoom-out" aria-hidden="true"></i> A-';
        menor.setAttribute('aria-label', 'Diminuir o tamanho do texto');
        var maior = document.createElement('button');
        maior.type = 'button';
        maior.innerHTML = '<i class="bi bi-zoom-in" aria-hidden="true"></i> A+';
        maior.setAttribute('aria-label', 'Aumentar o tamanho do texto');

        function mudarEscala(passo) {
            var atual = ESCALAS.indexOf(prefs.escala || '100');
            var proximo = Math.min(ESCALAS.length - 1, Math.max(0, atual + passo));
            definir('escala', ESCALAS[proximo]);
        }
        menor.addEventListener('click', function () {
            mudarEscala(-1);
        });
        maior.addEventListener('click', function () {
            mudarEscala(1);
        });
        painel.appendChild(grupo('Tamanho do texto', [menor, maior]));

        painel.appendChild(
            grupo('Links', [
                botao(
                    '<i class="bi bi-type-underline" aria-hidden="true"></i> Sublinhar links',
                    'Sublinhar todos os links',
                    !!prefs.sublinhar,
                    function (ligado) {
                        definir('sublinhar', ligado);
                    }
                ),
            ])
        );

        painel.appendChild(
            grupo('Movimento', [
                botao(
                    '<i class="bi bi-pause-circle" aria-hidden="true"></i> Reduzir animações',
                    'Reduzir animações da interface',
                    prefs.animacao === undefined ? prefereMenosMovimento() : !!prefs.animacao,
                    function (ligado) {
                        definir('animacao', ligado);
                    }
                ),
            ])
        );

        var limpar = document.createElement('button');
        limpar.type = 'button';
        limpar.className = 'acessibilidade-btn-restaurar';
        limpar.innerHTML =
            '<i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Restaurar padrão';
        limpar.addEventListener('click', function () {
            prefs = {};
            gravar(prefs);
            aplicar();
            painel.remove();
            abre.remove();
            montarPainel();
        });
        painel.appendChild(limpar);

        abre.addEventListener('click', function (e) {
            e.stopPropagation();
            var abrindo = painel.hidden;
            painel.hidden = !abrindo;
            abre.setAttribute('aria-expanded', abrindo ? 'true' : 'false');
            if (abrindo) {
                if (typeof window.renderLucideIcons === 'function') {
                    window.renderLucideIcons();
                }
                var primeiro = painel.querySelector('button');
                if (primeiro) primeiro.focus();
            }
        });

        document.addEventListener('keydown', function (evento) {
            if (evento.key === 'Escape' && !painel.hidden) {
                painel.hidden = true;
                abre.setAttribute('aria-expanded', 'false');
                abre.focus();
            }
        });

        document.addEventListener('click', function (e) {
            if (
                !painel.hidden &&
                !painel.contains(e.target) &&
                e.target !== abre &&
                !abre.contains(e.target)
            ) {
                painel.hidden = true;
                abre.setAttribute('aria-expanded', 'false');
            }
        });

        document.body.appendChild(painel);

        // Posiciona no slot de ações do cabeçalho, ao lado da engrenagem (settings-trigger), ou flutuante
        function posicionarBotao() {
            var slot = document.querySelector(
                '.header-actions, .header-right, .topbar-actions, .nav-actions, .dashboard-header-actions, .page-header-actions'
            );
            if (slot) {
                var btnSettings = slot.querySelector('#btn-open-settings, .settings-trigger');
                if (btnSettings) {
                    slot.insertBefore(abre, btnSettings);
                } else {
                    slot.appendChild(abre);
                }
                abre.classList.remove('acessibilidade-botao--floating');
            } else {
                abre.classList.add('acessibilidade-botao--floating');
                if (!document.body.contains(abre)) {
                    document.body.appendChild(abre);
                }
            }
        }

        posicionarBotao();

        // Assegura posicionamento correto mesmo se settings-drawer inicializar após este script
        window.addEventListener('load', posicionarBotao);
        setTimeout(posicionarBotao, 100);
        setTimeout(posicionarBotao, 500);

        if (typeof window.renderLucideIcons === 'function') {
            window.renderLucideIcons();
        }
    }

    function montar() {
        montarSkipLink();
        montarPainel();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', montar);
    } else {
        montar();
    }

    window.acessibilidade = {
        aplicar: aplicar,
        definir: definir,
        preferencias: function () {
            return prefs;
        },
    };
})();
