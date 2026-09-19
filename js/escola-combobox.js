/**
 * escola-combobox.js — Seletor de escola com busca (#366)
 * ============================================================================
 * Aprimora um <select data-ui-combo> comum: o select continua no DOM como
 * fonte da verdade (é dele que login.js lê o valor enviado ao backend) e
 * ganha por cima um combobox acessível com campo de busca.
 *
 * A tela mostra SÓ o texto da opção — o nome da escola. O `_id` fica no
 * `value` da opção e nunca é desenhado. Opção desabilitada aparece com o selo
 * "Em breve" e não pode ser escolhida.
 *
 * Padrão ARIA: botão com aria-haspopup="listbox" + popover com campo de busca
 * (aria-controls/aria-activedescendant) e listbox. Teclado: ↑ ↓ Home End
 * navegam, Enter escolhe, Esc fecha e devolve o foco ao botão.
 *
 * O select é preenchido de forma assíncrona (GET /api/escolas), então o
 * componente observa as opções e se redesenha quando elas mudam.
 * ============================================================================
 */
(function () {
    'use strict';

    var ICONE_ESCOLA =
        '<svg class="ui-combo-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-5h6v5"/><path d="M10 11h4"/></svg>';
    var ICONE_SETA =
        '<svg class="ui-combo-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    var ICONE_BUSCA =
        '<svg class="ui-control-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

    var contador = 0;

    /** Sem acento e em minúsculas: "Profª Nilde" casa com "prof nilde". */
    function normalizar(texto) {
        return String(texto || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    function aprimorar(select) {
        if (select.dataset.uiComboPronto) return;
        select.dataset.uiComboPronto = '1';

        var id = 'uiCombo' + ++contador;
        var placeholder = select.dataset.placeholder || 'Selecione a escola';
        var rotulo = document.querySelector('label[for="' + select.id + '"]');

        var raiz = document.createElement('div');
        raiz.className = 'ui-combo';

        var botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'ui-combo-trigger';
        botao.id = id + 'Botao';
        botao.setAttribute('aria-haspopup', 'listbox');
        botao.setAttribute('aria-expanded', 'false');
        botao.setAttribute('aria-controls', id + 'Pop');
        botao.innerHTML = ICONE_ESCOLA + '<span class="ui-combo-valor"></span>' + ICONE_SETA;
        var valorEl = botao.querySelector('.ui-combo-valor');

        var pop = document.createElement('div');
        pop.className = 'ui-combo-pop';
        pop.id = id + 'Pop';
        pop.hidden = true;

        var busca = document.createElement('div');
        busca.className = 'ui-combo-busca';
        busca.innerHTML = ICONE_BUSCA;
        var campo = document.createElement('input');
        campo.type = 'text';
        campo.id = id + 'Busca';
        campo.placeholder = 'Buscar escola…';
        campo.autocomplete = 'off';
        campo.spellcheck = false;
        campo.setAttribute('role', 'combobox');
        campo.setAttribute('aria-autocomplete', 'list');
        campo.setAttribute('aria-expanded', 'true');
        campo.setAttribute('aria-controls', id + 'Lista');
        campo.setAttribute('aria-label', 'Buscar escola pelo nome');
        busca.appendChild(campo);

        var lista = document.createElement('ul');
        lista.className = 'ui-combo-lista';
        lista.id = id + 'Lista';
        lista.setAttribute('role', 'listbox');
        if (rotulo) {
            rotulo.id = rotulo.id || id + 'Rotulo';
            lista.setAttribute('aria-labelledby', rotulo.id);
            botao.setAttribute('aria-labelledby', rotulo.id + ' ' + botao.id);
            // O <label for> apontava para o select escondido: passa a focar o botão.
            rotulo.addEventListener('click', function (e) {
                e.preventDefault();
                botao.focus();
            });
        }

        pop.appendChild(busca);
        pop.appendChild(lista);
        raiz.appendChild(botao);
        raiz.appendChild(pop);

        select.hidden = true;
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');
        select.insertAdjacentElement('afterend', raiz);

        var visiveis = [];
        var ativa = -1;

        function opcoes() {
            return Array.prototype.filter.call(select.options, function (o) {
                return o.value !== '';
            });
        }

        function pintarValor() {
            var escolhida = select.selectedOptions && select.selectedOptions[0];
            if (escolhida && escolhida.value) {
                valorEl.textContent = escolhida.textContent;
                valorEl.removeAttribute('data-vazio');
            } else {
                valorEl.textContent = placeholder;
                valorEl.setAttribute('data-vazio', '');
            }
        }

        function marcarAtiva(i) {
            ativa = i;
            visiveis.forEach(function (item, j) {
                if (j === i) {
                    item.el.setAttribute('data-ativa', '');
                    if (item.el.scrollIntoView) item.el.scrollIntoView({ block: 'nearest' });
                } else {
                    item.el.removeAttribute('data-ativa');
                }
            });
            if (i >= 0 && visiveis[i]) {
                campo.setAttribute('aria-activedescendant', visiveis[i].el.id);
            } else {
                campo.removeAttribute('aria-activedescendant');
            }
        }

        function desenhar() {
            var termo = normalizar(campo.value);
            lista.textContent = '';
            visiveis = [];

            opcoes().forEach(function (o, i) {
                if (termo && normalizar(o.textContent).indexOf(termo) === -1) return;

                var li = document.createElement('li');
                li.className = 'ui-combo-opcao';
                li.id = id + 'Op' + i;
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', String(o.value === select.value));

                var nome = document.createElement('span');
                nome.textContent = o.textContent;
                li.appendChild(nome);

                if (o.disabled) {
                    li.setAttribute('aria-disabled', 'true');
                    var selo = document.createElement('span');
                    selo.className = 'ui-pill ui-pill--muted';
                    selo.textContent = 'Em breve';
                    li.appendChild(selo);
                }

                var item = { el: li, opcao: o };
                li.addEventListener('mousedown', function (e) {
                    e.preventDefault(); // não tira o foco do campo de busca
                });
                li.addEventListener('click', function () {
                    escolher(item);
                });
                li.addEventListener('mousemove', function () {
                    var j = visiveis.indexOf(item);
                    if (j !== ativa) marcarAtiva(j);
                });

                visiveis.push(item);
                lista.appendChild(li);
            });

            if (!visiveis.length) {
                var vazio = document.createElement('li');
                vazio.className = 'ui-combo-vazio';
                vazio.setAttribute('role', 'presentation');
                vazio.textContent = 'Nenhuma escola com esse nome.';
                lista.appendChild(vazio);
            }

            var sel = visiveis.findIndex(function (it) {
                return it.opcao.value === select.value;
            });
            marcarAtiva(sel >= 0 && !termo ? sel : proximaHabilitada(-1, 1));
        }

        function proximaHabilitada(de, passo) {
            for (var i = de + passo; i >= 0 && i < visiveis.length; i += passo) {
                if (!visiveis[i].opcao.disabled) return i;
            }
            return de >= 0 && de < visiveis.length ? de : -1;
        }

        function abrir() {
            if (!pop.hidden) return;
            campo.value = '';
            desenhar();
            pop.hidden = false;
            botao.setAttribute('aria-expanded', 'true');
            campo.focus();
            document.addEventListener('pointerdown', foraDoCombo, true);
        }

        function fechar(devolverFoco) {
            if (pop.hidden) return;
            pop.hidden = true;
            botao.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', foraDoCombo, true);
            if (devolverFoco) botao.focus();
        }

        function foraDoCombo(e) {
            if (!raiz.contains(e.target)) fechar(false);
        }

        function escolher(item) {
            if (!item || item.opcao.disabled) return;
            select.value = item.opcao.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            pintarValor();
            fechar(true);
        }

        botao.addEventListener('click', function () {
            if (pop.hidden) abrir();
            else fechar(true);
        });

        botao.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                abrir();
            }
        });

        campo.addEventListener('input', desenhar);

        campo.addEventListener('keydown', function (e) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    marcarAtiva(proximaHabilitada(ativa, 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    marcarAtiva(proximaHabilitada(ativa, -1));
                    break;
                case 'Home':
                    e.preventDefault();
                    marcarAtiva(proximaHabilitada(-1, 1));
                    break;
                case 'End':
                    e.preventDefault();
                    marcarAtiva(proximaHabilitada(visiveis.length, -1));
                    break;
                case 'Enter':
                    e.preventDefault();
                    escolher(visiveis[ativa]);
                    break;
                case 'Escape':
                    e.preventDefault();
                    fechar(true);
                    break;
                case 'Tab':
                    fechar(false);
                    break;
                default:
                    break;
            }
        });

        // O select é repovoado quando GET /api/escolas responde.
        new MutationObserver(function () {
            pintarValor();
            if (!pop.hidden) desenhar();
        }).observe(select, { childList: true, subtree: true, attributes: true });

        select.addEventListener('change', pintarValor);

        // login.js foca o select quando a escola não foi escolhida.
        select.focus = function () {
            botao.focus();
        };

        pintarValor();
    }

    function iniciar() {
        document.querySelectorAll('select[data-ui-combo]').forEach(aprimorar);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
