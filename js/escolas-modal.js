/**
 * escolas-modal.js — popula o modal "Escolas em Americana" da landing page
 * a partir de GET /api/escolas (substitui a lista hardcoded).
 *
 * - Escola ativa   → link clicável para /html/login.html?escolaId=<id>
 * - Escola inativa → cadeado, não clicável, tooltip "em breve"
 * - Se a API falhar, mantém o fallback estático já presente no HTML.
 */
(function () {
    'use strict';

    var API_BASE = window.API_BASE_URL || (
        (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? 'http://localhost:3001/api'
            : (location.origin + '/api')
    );

    function iconePorTipo(tipo) {
        return tipo === 'CIEP' ? 'bi-mortarboard' : 'bi-book';
    }

    function textoEscola(e) {
        var partes = [e.nome];
        var local = [e.endereco, e.bairro].filter(Boolean).join(' - ');
        if (local) partes.push(local);
        return partes.join(' — ');
    }

    function renderEscolas(escolas) {
        var lista = document.getElementById('schoolSwitcherList');
        if (!lista || !escolas.length) return;

        // Ativas primeiro, depois por tipo/nome (a API já ordena por tipo/nome)
        escolas.sort(function (a, b) { return (b.ativo ? 1 : 0) - (a.ativo ? 1 : 0); });

        lista.textContent = '';
        escolas.forEach(function (e) {
            var item = document.createElement('a');
            item.className = 'school-list-item ' + (e.tipo === 'CIEP' ? 'ciep' : 'emef');

            var icone = document.createElement('i');
            icone.className = 'bi ' + iconePorTipo(e.tipo);
            item.appendChild(icone);
            item.appendChild(document.createTextNode(' ' + textoEscola(e) + ' '));

            if (e.ativo) {
                item.href = '/html/login.html?escolaId=' + encodeURIComponent(e._id);
                item.title = 'Entrar em ' + e.nome;
            } else {
                var cadeado = document.createElement('i');
                cadeado.className = 'bi bi-lock-fill lock-icon-item';
                item.appendChild(cadeado);
                item.title = 'Em breve';
                item.setAttribute('aria-disabled', 'true');
            }
            lista.appendChild(item);
        });
    }

    function carregar() {
        fetch(API_BASE + '/escolas')
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (json) {
                if (json && json.success && Array.isArray(json.data) && json.data.length > 0) {
                    renderEscolas(json.data);
                }
                // API vazia ou fora do ar: mantém o fallback estático do HTML
            })
            .catch(function () { /* fallback estático permanece */ });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', carregar);
    } else {
        carregar();
    }
})();
