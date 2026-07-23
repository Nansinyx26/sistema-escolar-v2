/**
 * escola-switcher.js — seletor de escola na sidebar (usuário logado).
 *
 * Mostra APENAS as escolas presentes nos vínculos do usuário
 * (GET /api/escolas/minhas), com destaque na escola ativa. Ao trocar,
 * chama POST /api/escolas/trocar/:escolaId e recarrega no painel do cargo.
 *
 * Renderiza logo abaixo do bloco de perfil da sidebar (.sidebar-profile).
 * Com 0 ou 1 vínculo, mostra só o nome da escola ativa (sem dropdown).
 */
(function () {
    'use strict';

    var API_BASE = window.API_BASE_URL || (
        (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? 'http://localhost:3001/api'
            : (location.origin + '/api')
    );

    function getCsrf() {
        var m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    function render(escolas, escolaAtivaId) {
        var perfil = document.querySelector('.sidebar-profile');
        if (!perfil || document.getElementById('escolaSwitcherSidebar')) return;
        if (!escolas.length) return;

        var ativa = escolas.find(function (e) { return String(e._id) === String(escolaAtivaId); }) || escolas[0];
        var outras = escolas.filter(function (e) { return String(e._id) !== String(ativa._id); });

        var wrap = document.createElement('div');
        wrap.id = 'escolaSwitcherSidebar';
        wrap.style.cssText = 'margin:10px 12px 4px;padding:10px 12px;border-radius:10px;' +
            'background:rgba(16,185,129,.07);border:1px solid rgba(16,185,129,.25);';

        var atual = document.createElement('button');
        atual.type = 'button';
        atual.setAttribute('aria-expanded', 'false');
        atual.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;background:none;' +
            'border:none;padding:0;color:var(--text-primary,#fafafa);cursor:' +
            (outras.length ? 'pointer' : 'default') + ';text-align:left;font-family:inherit;';
        atual.innerHTML =
            '<i class="bi bi-building" style="color:var(--primary,#10b981);font-size:15px;flex-shrink:0;"></i>' +
            '<span style="flex:1;min-width:0;">' +
              '<span style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-tertiary,#a1a1aa);">Escola ativa</span>' +
              '<span id="escolaAtivaNome" style="display:block;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span>' +
            '</span>' +
            (outras.length ? '<i class="bi bi-chevron-down" style="font-size:12px;color:var(--text-tertiary,#a1a1aa);"></i>' : '');
        atual.querySelector('#escolaAtivaNome').textContent = ativa.nome;
        wrap.appendChild(atual);

        if (outras.length) {
            var lista = document.createElement('div');
            lista.style.cssText = 'display:none;margin-top:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:8px;';

            outras.forEach(function (e) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;background:none;border:none;' +
                    'padding:6px 4px;border-radius:6px;color:var(--text-secondary,#d4d4d8);cursor:pointer;' +
                    'font-size:12.5px;text-align:left;font-family:inherit;';
                btn.innerHTML = '<i class="bi bi-arrow-left-right" style="font-size:11px;color:var(--text-tertiary,#a1a1aa);"></i>';
                btn.appendChild(document.createTextNode(e.nome));
                btn.addEventListener('mouseenter', function () { btn.style.background = 'rgba(255,255,255,.06)'; });
                btn.addEventListener('mouseleave', function () { btn.style.background = 'none'; });
                btn.addEventListener('click', function () { trocar(e); });
                lista.appendChild(btn);
            });
            wrap.appendChild(lista);

            atual.addEventListener('click', function () {
                var aberto = lista.style.display !== 'none';
                lista.style.display = aberto ? 'none' : 'block';
                atual.setAttribute('aria-expanded', String(!aberto));
            });
        }

        perfil.insertAdjacentElement('afterend', wrap);
    }

    function trocar(escola) {
        fetch(API_BASE + '/escolas/trocar/' + encodeURIComponent(escola._id), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() }
        })
            .then(function (r) { return r.json(); })
            .then(function (json) {
                if (json && json.success) {
                    if (typeof showToast === 'function') showToast(json.message, 'success');
                    setTimeout(function () {
                        window.location.href = json.redirect_to || window.location.href;
                    }, 600);
                } else {
                    var msg = (json && json.error) || 'Não foi possível trocar de escola.';
                    if (typeof showToast === 'function') showToast(msg, 'error');
                    else alert(msg);
                }
            })
            .catch(function () {
                if (typeof showToast === 'function') showToast('Falha de conexão ao trocar de escola.', 'error');
            });
    }

    function iniciar() {
        fetch(API_BASE + '/escolas/minhas', { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (json) {
                if (json && json.success && Array.isArray(json.data)) {
                    render(json.data, json.escolaAtivaId);
                }
            })
            .catch(function () { /* sem switcher — sidebar segue normal */ });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
