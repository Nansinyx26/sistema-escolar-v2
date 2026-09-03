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

    function botao(texto, rotuloAria, pressionado, aoClicar) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = texto;
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
        abre.textContent = '♿'; // ♿
        abre.setAttribute('aria-label', 'Opções de acessibilidade');
        abre.setAttribute('aria-expanded', 'false');
        abre.setAttribute('aria-controls', 'painel-acessibilidade');

        var painel = document.createElement('div');
        painel.className = 'acessibilidade-painel';
        painel.id = 'painel-acessibilidade';
        painel.setAttribute('role', 'group');
        painel.setAttribute('aria-label', 'Opções de acessibilidade');
        painel.hidden = true;

        var titulo = document.createElement('h2');
        titulo.textContent = 'Acessibilidade';
        painel.appendChild(titulo);

        painel.appendChild(
            grupo('Contraste', [
                botao(
                    'Alto contraste',
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
        menor.textContent = 'A-';
        menor.setAttribute('aria-label', 'Diminuir o tamanho do texto');
        var maior = document.createElement('button');
        maior.type = 'button';
        maior.textContent = 'A+';
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
                    'Sublinhar links',
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
                    'Reduzir animações',
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
        limpar.textContent = 'Restaurar padrão';
        limpar.addEventListener('click', function () {
            prefs = {};
            gravar(prefs);
            aplicar();
            painel.remove();
            abre.remove();
            montarPainel();
        });
        painel.appendChild(limpar);

        abre.addEventListener('click', function () {
            var abrindo = painel.hidden;
            painel.hidden = !abrindo;
            abre.setAttribute('aria-expanded', abrindo ? 'true' : 'false');
            if (abrindo) {
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

        document.body.appendChild(painel);
        document.body.appendChild(abre);
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
