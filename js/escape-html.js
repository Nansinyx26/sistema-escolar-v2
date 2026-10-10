/**
 * escape-html.js — escape de HTML seguro para texto E para atributos.
 *
 * POR QUE NÃO USAR O TRUQUE DO textContent
 * -----------------------------------------
 * O projeto tinha três cópias desta função escritas assim:
 *
 *     const div = document.createElement('div');
 *     div.textContent = texto;
 *     return div.innerHTML;
 *
 * Isso escapa `&`, `<` e `>`, mas NÃO escapa aspas. Serve para conteúdo de
 * elemento e falha em atributo — e boa parte dos templates deste código
 * interpola justamente dentro de atributo:
 *
 *     `<div title="${descricao}" data-id="${id}">`
 *
 * Com o textContent, um valor contendo `"` fecha o atributo e permite injetar
 * outro atributo — inclusive um handler de evento, que a CSP aceitava até a
 * Issue #619 (script-src-attr). Ou seja: o caminho de XSS mais provável passava
 * exatamente pelo ponto que a função não cobria.
 *
 * REGRA DE USO: atributos SEMPRE entre aspas — `id="${escapeHtml(x)}"`.
 * Atributo sem aspas não é seguro nem com este escape.
 *
 * NÃO usar para: interpolar dentro de <script>, em href/src (use encodeURI e
 * valide o esquema) ou em CSS. Contextos diferentes exigem escapes diferentes.
 *
 * escapeAttr — PARA VALOR QUE JÁ VEM CODIFICADO DO SERVIDOR (Issue #582)
 * ---------------------------------------------------------------------
 * O backend grava texto com `&`, `<` e `>` já codificados (utils/sanitize.js:
 * "Pedro & Maria" fica "Pedro &amp; Maria"), mas deixa as aspas cruas. Passar
 * esse valor por escapeHtml num atributo codifica o `&` de novo, e um
 * `value="${…}"` passaria a mostrar "&amp;" literal. escapeAttr troca só aspas,
 * < > e crase: sem aspa literal o valor não sai do atributo (uma entidade é
 * decodificada DENTRO do valor e não o fecha), e o que o servidor codificou
 * continua aparecendo certo. Os scripts que não carregam este arquivo trazem
 * uma cópia local chamada `escAttr`.
 *
 * ATRIBUTO DE EVENTO (onclick, onerror…) é outro contexto: o navegador
 * decodifica as entidades ANTES de rodar o JS, então `&quot;` volta a ser aspa
 * dentro do código. Lá o valor entra como string JS e o escape inclui o `&`:
 *
 *     `onclick="abrir(${escapeHtml(JSON.stringify(valor))})"`
 */
(function (global) {
    'use strict';

    var MAPA = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;',
    };

    function escapeHtml(valor) {
        if (valor === null || valor === undefined) return '';
        return String(valor).replace(/[&<>"'`]/g, function (c) {
            return MAPA[c];
        });
    }

    function escapeAttr(valor) {
        if (valor === null || valor === undefined) return '';
        return String(valor).replace(/["'<>`]/g, function (c) {
            return MAPA[c];
        });
    }

    global.escapeHtml = escapeHtml;
    global.escapeAttr = escapeAttr;

    // Alias usado em alguns arquivos do projeto
    global.escapeHTML = escapeHtml;
})(typeof window !== 'undefined' ? window : this);
