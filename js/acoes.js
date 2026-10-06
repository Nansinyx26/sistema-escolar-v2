/**
 * acoes.js — delegação de eventos por atributo (Issue #613, épico #612).
 *
 * POR QUE EXISTE
 * --------------
 * A CSP ainda tem `script-src-attr 'unsafe-inline'` por causa dos handlers
 * inline do frontend legado (`onclick="excluir('123')"`). Enquanto ela existir,
 * HTML injetado que escape do `escapeHtml` executa script por um atributo de
 * evento. Este arquivo é o caminho da troca: o HTML diz QUAL ação, o JS diz O
 * QUE ela faz.
 *
 *   <button data-acao="excluirAluno" data-id="123">Excluir</button>
 *   Acoes.registrar('excluirAluno', function (evento, alvo) {
 *       excluirAluno(alvo.dataset.id);
 *   });
 *
 * Só ações REGISTRADAS rodam. Cair em `window[nome]` deixaria um HTML
 * injetado chamar qualquer função global; com o registro, ele só alcança o que
 * a página declarou, e com argumentos em texto.
 *
 * Um ouvinte por tipo de evento no `document` cobre também o HTML montado
 * depois, por `innerHTML`, sem religar nada.
 */
(function () {
    'use strict';

    /** Atributo que nomeia a ação, por tipo de evento. Todos borbulham. */
    var ATRIBUTOS = {
        click: 'data-acao',
        change: 'data-acao-change',
        input: 'data-acao-input',
        submit: 'data-acao-submit',
        keydown: 'data-acao-keydown',
    };

    var registro = Object.create(null);

    /**
     * Registra uma ação, ou várias de uma vez: `registrar({ a: fn, b: fn })`.
     * A função recebe `(evento, alvo)`, com `this` no elemento que tem o atributo.
     */
    function registrar(nomeOuMapa, fn) {
        if (nomeOuMapa && typeof nomeOuMapa === 'object') {
            Object.keys(nomeOuMapa).forEach(function (nome) {
                registrar(nome, nomeOuMapa[nome]);
            });
            return;
        }
        if (typeof nomeOuMapa !== 'string' || !nomeOuMapa) {
            throw new TypeError('Acoes.registrar: o nome da ação precisa ser um texto.');
        }
        if (typeof fn !== 'function') {
            throw new TypeError('Acoes.registrar: "' + nomeOuMapa + '" precisa de uma função.');
        }
        registro[nomeOuMapa] = fn;
    }

    function despachar(evento) {
        var atributo = ATRIBUTOS[evento.type];
        var origem = evento.target;
        if (!atributo || !origem || typeof origem.closest !== 'function') return;

        var alvo = origem.closest('[' + atributo + ']');
        if (!alvo) return;

        var nome = alvo.getAttribute(atributo);
        var fn = registro[nome];
        if (!fn) {
            console.warn('[acoes] Ação não registrada: ' + nome);
            return;
        }
        return fn.call(alvo, evento, alvo);
    }

    Object.keys(ATRIBUTOS).forEach(function (tipo) {
        document.addEventListener(tipo, despachar);
    });

    var Acoes = { registrar: registrar, ATRIBUTOS: ATRIBUTOS };
    window.Acoes = Acoes;
    if (typeof module !== 'undefined' && module.exports) module.exports = Acoes;
})();
