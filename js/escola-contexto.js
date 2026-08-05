/**
 * escola-contexto.js — contexto multi-escola nas páginas de cadastro/login.
 *
 * Quando o usuário chega via clique numa escola do modal da landing
 * (?escolaId=xxx), este helper:
 *   1. expõe window.EscolaContexto.id para os scripts de cadastro
 *      incluírem no body do POST;
 *   2. exibe um banner "Cadastro para: <escola>" no topo do formulário
 *      (campo travado — a escola veio da seleção, não é editável).
 *
 * Sem ?escolaId, nada muda: o código secreto identifica a escola no backend.
 */
(function () {
    'use strict';

    var id = null;
    try {
        id = new URLSearchParams(window.location.search).get('escolaId') || null;
    } catch (e) { /* URLSearchParams indisponível — segue sem contexto */ }

    window.EscolaContexto = { id: id, nome: null };

    if (!id) return;

    var API_BASE = window.API_BASE_URL || (
        (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? 'http://localhost:3001/api'
            : (location.origin + '/api')
    );

    function criarBanner(nomeEscola) {
        var form = document.querySelector('form');
        if (!form || document.getElementById('escolaContextoBanner')) return;

        var banner = document.createElement('div');
        banner.id = 'escolaContextoBanner';
        banner.style.cssText = 'display:flex;align-items:center;gap:10px;' +
            'background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.35);' +
            'border-radius:10px;padding:12px 14px;margin-bottom:18px;' +
            'color:var(--text-primary,#fafafa);font-size:14px;';
        banner.innerHTML = '<i class="bi bi-building-check" style="color:var(--primary,#10b981);font-size:18px;"></i>';

        var texto = document.createElement('div');
        var label = document.createElement('div');
        label.textContent = 'Cadastro para a escola:';
        label.style.cssText = 'font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-tertiary,#a1a1aa);';
        var nome = document.createElement('strong');
        nome.textContent = nomeEscola;
        texto.appendChild(label);
        texto.appendChild(nome);
        banner.appendChild(texto);

        form.insertBefore(banner, form.firstChild);
    }

    function carregarNome() {
        fetch(API_BASE + '/escolas')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (json) {
                if (!json || !json.success) return;
                var escola = (json.data || []).find(function (e) { return String(e._id) === String(id); });
                if (escola) {
                    window.EscolaContexto.nome = escola.nome;
                    criarBanner(escola.nome);
                }
            })
            .catch(function () { /* sem banner; o id ainda vai no POST */ });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', carregarNome);
    } else {
        carregarNome();
    }
})();
