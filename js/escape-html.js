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
 *     `<div title="${descricao}" onclick="abrir('${id}')">`
 *
 * Com o textContent, um valor contendo `"` fecha o atributo e permite injetar
 * outro atributo — inclusive um handler de evento, que a CSP ainda aceita
 * (script-src-attr). Ou seja: o caminho de XSS mais provável passava exatamente
 * pelo ponto que a função não cobria.
 *
 * REGRA DE USO: atributos SEMPRE entre aspas — `id="${escapeHtml(x)}"`.
 * Atributo sem aspas não é seguro nem com este escape.
 *
 * NÃO usar para: interpolar dentro de <script>, em href/src (use encodeURI e
 * valide o esquema) ou em CSS. Contextos diferentes exigem escapes diferentes.
 */
(function (global) {
    'use strict';

    var MAPA = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;'
    };

    function escapeHtml(valor) {
        if (valor === null || valor === undefined) return '';
        return String(valor).replace(/[&<>"'`]/g, function (c) { return MAPA[c]; });
    }

    global.escapeHtml = escapeHtml;

    // Alias usado em alguns arquivos do projeto
    global.escapeHTML = escapeHtml;
})(typeof window !== 'undefined' ? window : this);
