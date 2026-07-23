/**
 * csrf-helper.js — cabeçalhos CSRF para requisições que alteram estado.
 *
 * O backend usa double-submit cookie: POST/PUT/DELETE sem o header
 * X-CSRF-Token são bloqueados com 403 e NADA é salvo. As páginas da
 * secretaria faziam fetch sem esse header — por isso os cadastros/edições
 * não persistiam no banco. Use window.csrfHeaders() em toda mutação.
 */
(function () {
  'use strict';

  window.getCsrfToken = function () {
    var m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  };

  /**
   * @param {boolean} json  inclui Content-Type: application/json
   * @returns {Object} headers prontos com X-CSRF-Token
   */
  window.csrfHeaders = function (json) {
    var h = {};
    if (json) h['Content-Type'] = 'application/json';
    var t = window.getCsrfToken();
    if (t) h['X-CSRF-Token'] = t;
    return h;
  };
})();
