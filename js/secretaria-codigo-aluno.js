/**
 * secretaria-codigo-aluno.js — modal "Código Secreto do Aluno" do painel
 * da Secretaria (também usado por Diretor/Admin).
 *
 * Fluxo: busca aluno (GET /api/alunos/codigos-secretos?q=) → exibe código
 * → copiar para a área de transferência → regenerar
 * (POST /api/alunos/:id/regenerar-codigo, invalida o anterior).
 *
 * Multi-escola: o backend filtra pela escola ativa da sessão.
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

    function toast(msg, tipo) {
        if (typeof window.showToast === 'function') return window.showToast(msg, tipo || 'success');
        alert(msg);
    }

    // ── Modal (criado uma única vez, reaberto sob demanda) ──────────────
    var modal = null;

    function criarModal() {
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'modalCodigoAluno';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Código Secreto do Aluno');
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);padding:16px;';

        modal.innerHTML =
            '<div style="background:#0f1420;border:1px solid rgba(255,255,255,.09);border-radius:16px;max-width:560px;width:100%;max-height:min(640px,92dvh);display:flex;flex-direction:column;overflow:hidden;">' +
              '<div style="display:flex;align-items:center;gap:10px;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.07);">' +
                '<div style="width:38px;height:38px;border-radius:10px;background:rgba(16,185,129,.14);color:#10b981;display:flex;align-items:center;justify-content:center;font-size:1.1rem;"><i class="bi bi-key-fill"></i></div>' +
                '<div style="flex:1;min-width:0;">' +
                  '<h3 style="margin:0;font-size:1.02rem;color:#fff;">Código Secreto do Aluno</h3>' +
                  '<p style="margin:0;font-size:.76rem;color:#94a3b8;">Usado pelo responsável para criar a conta no primeiro acesso</p>' +
                '</div>' +
                '<button type="button" id="mcaFechar" aria-label="Fechar" style="background:none;border:none;color:#94a3b8;font-size:1.5rem;cursor:pointer;line-height:1;padding:4px 8px;">&times;</button>' +
              '</div>' +
              '<div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.07);">' +
                '<div style="position:relative;">' +
                  '<i class="bi bi-search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#64748b;font-size:.9rem;"></i>' +
                  '<input type="text" id="mcaBusca" placeholder="Buscar por nome, matrícula ou código..." autocomplete="off" ' +
                    'style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#fff;padding:10px 12px 10px 36px;font-size:.9rem;font-family:inherit;outline:none;">' +
                '</div>' +
              '</div>' +
              '<div id="mcaLista" style="flex:1;overflow-y:auto;padding:8px 12px;min-height:120px;"></div>' +
            '</div>';

        document.body.appendChild(modal);

        modal.querySelector('#mcaFechar').addEventListener('click', fechar);
        modal.addEventListener('click', function (e) { if (e.target === modal) fechar(); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modal.style.display !== 'none') fechar();
        });

        var busca = modal.querySelector('#mcaBusca');
        var timer;
        busca.addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(function () { carregar(busca.value.trim()); }, 350);
        });

        return modal;
    }

    function abrir() {
        criarModal();
        modal.style.display = 'flex';
        document.documentElement.style.overflow = 'hidden';
        modal.querySelector('#mcaBusca').focus();
        carregar('');
    }

    function fechar() {
        if (!modal) return;
        modal.style.display = 'none';
        document.documentElement.style.overflow = '';
    }

    // ── Lista de alunos ──────────────────────────────────────────────────
    function skeleton() {
        var html = '';
        for (var i = 0; i < 4; i++) {
            html += '<div style="height:58px;border-radius:10px;background:linear-gradient(90deg,rgba(255,255,255,.03),rgba(255,255,255,.07),rgba(255,255,255,.03));background-size:200% 100%;animation:mcaShimmer 1.2s infinite;margin:6px 4px;"></div>';
        }
        return html + '<style>@keyframes mcaShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>';
    }

    function carregar(q) {
        var lista = modal.querySelector('#mcaLista');
        lista.innerHTML = skeleton();

        fetch(API_BASE + '/alunos/codigos-secretos' + (q ? ('?q=' + encodeURIComponent(q)) : ''), { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (json) {
                if (!json.success) throw new Error(json.error || 'Falha ao buscar alunos');
                render(json.data || []);
            })
            .catch(function (e) {
                lista.innerHTML = '<div style="text-align:center;color:#f87171;padding:24px;font-size:.85rem;"><i class="bi bi-exclamation-triangle"></i> ' + (e.message || 'Erro ao carregar') + '</div>';
            });
    }

    function render(alunos) {
        var lista = modal.querySelector('#mcaLista');
        if (!alunos.length) {
            lista.innerHTML = '<div style="text-align:center;color:#64748b;padding:28px;font-size:.85rem;"><i class="bi bi-inbox" style="font-size:1.4rem;display:block;margin-bottom:6px;"></i>Nenhum aluno encontrado.</div>';
            return;
        }

        lista.textContent = '';
        alunos.slice(0, 60).forEach(function (a) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 10px;margin:4px;border-radius:10px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);';

            var info = document.createElement('div');
            info.style.cssText = 'flex:1;min-width:0;';
            var nome = document.createElement('div');
            nome.textContent = a.nome;
            nome.style.cssText = 'color:#fff;font-size:.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            var meta = document.createElement('div');
            meta.textContent = (a.turma || 'Sem turma') + (a.vinculado ? ' · responsável vinculado' : ' · sem vínculo');
            meta.style.cssText = 'color:' + (a.vinculado ? '#10b981' : '#94a3b8') + ';font-size:.72rem;';
            info.appendChild(nome);
            info.appendChild(meta);

            var codigo = document.createElement('code');
            codigo.textContent = a.codigoSecreto;
            codigo.style.cssText = 'background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);color:#34d399;border-radius:8px;padding:5px 10px;font-size:.86rem;letter-spacing:.08em;font-weight:700;';

            var btnCopiar = botaoIcone('bi-clipboard', 'Copiar código');
            btnCopiar.addEventListener('click', function () {
                navigator.clipboard.writeText(a.codigoSecreto).then(function () {
                    toast('Código de ' + a.nome + ' copiado!', 'success');
                    btnCopiar.querySelector('i').className = 'bi bi-clipboard-check';
                    setTimeout(function () { btnCopiar.querySelector('i').className = 'bi bi-clipboard'; }, 1600);
                }).catch(function () { toast('Não foi possível copiar.', 'error'); });
            });

            var btnRegen = botaoIcone('bi-arrow-repeat', 'Gerar novo código (invalida o atual)');
            btnRegen.addEventListener('click', function () {
                if (!confirm('Gerar um NOVO código para ' + a.nome + '?\n\nO código atual (' + a.codigoSecreto + ') deixará de funcionar imediatamente.')) return;
                btnRegen.disabled = true;
                btnRegen.querySelector('i').className = 'bi bi-arrow-repeat mca-spin';
                fetch(API_BASE + '/alunos/' + encodeURIComponent(a.id) + '/regenerar-codigo', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() }
                })
                    .then(function (r) { return r.json(); })
                    .then(function (json) {
                        if (!json.success) throw new Error(json.error || 'Falha ao regenerar');
                        a.codigoSecreto = json.data.codigoSecreto;
                        codigo.textContent = a.codigoSecreto;
                        toast(json.message, 'success');
                    })
                    .catch(function (e) { toast(e.message || 'Erro ao regenerar código.', 'error'); })
                    .finally(function () {
                        btnRegen.disabled = false;
                        btnRegen.querySelector('i').className = 'bi bi-arrow-repeat';
                    });
            });

            row.appendChild(info);
            row.appendChild(codigo);
            row.appendChild(btnCopiar);
            row.appendChild(btnRegen);
            lista.appendChild(row);
        });

        if (alunos.length > 60) {
            var aviso = document.createElement('div');
            aviso.textContent = 'Mostrando 60 de ' + alunos.length + ' — refine a busca.';
            aviso.style.cssText = 'text-align:center;color:#64748b;font-size:.75rem;padding:10px;';
            lista.appendChild(aviso);
        }

        if (!document.getElementById('mcaSpinStyle')) {
            var st = document.createElement('style');
            st.id = 'mcaSpinStyle';
            st.textContent = '.mca-spin{display:inline-block;animation:mcaSpin 1s linear infinite}@keyframes mcaSpin{to{transform:rotate(360deg)}}';
            document.head.appendChild(st);
        }
    }

    function botaoIcone(icone, titulo) {
        var b = document.createElement('button');
        b.type = 'button';
        b.title = titulo;
        b.setAttribute('aria-label', titulo);
        b.innerHTML = '<i class="bi ' + icone + '"></i>';
        b.style.cssText = 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#d4d4d8;width:34px;height:34px;cursor:pointer;font-size:.9rem;flex-shrink:0;transition:border-color .15s,color .15s;';
        b.addEventListener('mouseenter', function () { b.style.borderColor = '#10b981'; b.style.color = '#10b981'; });
        b.addEventListener('mouseleave', function () { b.style.borderColor = 'rgba(255,255,255,.1)'; b.style.color = '#d4d4d8'; });
        return b;
    }

    // ── Gatilho: card/botão com [data-codigo-aluno] ──────────────────────
    function initGatilhos() {
        document.querySelectorAll('[data-codigo-aluno]').forEach(function (el) {
            el.addEventListener('click', function (e) { e.preventDefault(); abrir(); });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGatilhos);
    } else {
        initGatilhos();
    }

    window.SecretariaCodigoAluno = { abrir: abrir, fechar: fechar };
})();
