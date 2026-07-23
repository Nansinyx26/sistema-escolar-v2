/**
 * settings-drawer.js — Painel de Configurações Unificado
 *
 * Centraliza as preferências do sistema em um único drawer lateral, reduzindo
 * a poluição visual do cabeçalho. Carregado em todas as páginas.
 *
 * Acessibilidade: role="dialog" + aria-modal, focus trap, retorno de foco ao
 * gatilho, fechamento por Esc/clique fora e toggles operáveis por teclado
 * (role="switch" + aria-checked).
 *
 * v2.0
 */
(function () {
    'use strict';

    if (window.__settingsDrawerInit) return;
    window.__settingsDrawerInit = true;

    // Chaves que NUNCA podem ser apagadas por "Limpar Cache": sessão, escola
    // selecionada e preferências do próprio usuário.
    var PRESERVED_PREFIXES = ['sd_', 'user_', 'pwa_'];
    var PRESERVED_KEYS = [
        'theme', 'escolaSelecionada', 'escola_session', 'escola_jwt',
        'escola_jwt_user', 'clickSound', 'sidebar_collapsed', 'token'
    ];

    var FOCUSABLE = 'a[href],button:not(:disabled),select:not(:disabled),input:not(:disabled),' +
        'textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

    // ---------- CAMINHOS ABSOLUTOS ----------
    // O drawer existe em páginas de várias profundidades (/html, /html/direcao,
    // /detalhes…). Links relativos quebrariam fora da raiz de /html.
    var PATHS = {
        perfil: '/html/perfil.html',
        meusDados: '/html/meus-dados.html',
        login: '/html/login.html'
    };

    // ---------- CSS ----------
    var css = [
        '.settings-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);',
        'z-index:1090;opacity:0;pointer-events:none;transition:opacity 250ms var(--ease-out,cubic-bezier(.16,1,.3,1))}',
        '.settings-overlay.open{opacity:1;pointer-events:auto}',
        '.settings-drawer{position:fixed;top:0;right:0;width:min(380px,92vw);height:100vh;height:100dvh;',
        'background:#0a0a0c;border-left:1px solid rgba(255,255,255,.06);z-index:1095;display:flex;',
        'flex-direction:column;transform:translateX(100%);visibility:hidden;',
        'transition:transform 300ms var(--ease-out,cubic-bezier(.16,1,.3,1)),visibility 300ms;overflow:hidden}',
        '.settings-drawer.open{transform:translateX(0);visibility:visible}',
        '.sd-header{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;',
        'padding-top:calc(1.25rem + env(safe-area-inset-top));border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0}',
        '.sd-header h2{margin:0;font-size:1.1rem;font-weight:700;color:#fafafa;display:flex;align-items:center;gap:.5rem}',
        '.sd-close{width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.06);',
        'border:1px solid rgba(255,255,255,.08);color:#a1a1aa;cursor:pointer;font-size:1.1rem;',
        'display:flex;align-items:center;justify-content:center;transition:background-color 200ms,color 200ms,border-color 200ms}',
        '.sd-close:hover{background:rgba(239,68,68,.15);color:#ef4444;border-color:rgba(239,68,68,.3)}',
        '.sd-body{flex:1;overflow-y:auto;padding:1rem 1.5rem 2rem;scrollbar-width:thin;',
        'scrollbar-color:rgba(255,255,255,.08) transparent;-webkit-overflow-scrolling:touch}',
        '.sd-section{margin-bottom:1.75rem}',
        '.sd-section-title{font-size:.68rem;font-weight:700;color:#52525b;text-transform:uppercase;',
        'letter-spacing:.08em;margin-bottom:.75rem;padding-bottom:.5rem;border-bottom:1px solid rgba(255,255,255,.04)}',
        '.sd-item{display:flex;align-items:center;justify-content:space-between;padding:.65rem .75rem;',
        'border-radius:10px;color:#d4d4d8;font-size:.88rem;transition:background-color 150ms,color 150ms;',
        'gap:.75rem;text-decoration:none;border:none;background:none;width:100%;text-align:left;font-family:inherit}',
        'button.sd-item,a.sd-item{cursor:pointer}',
        '.sd-item:hover{background:rgba(255,255,255,.04);color:#fafafa}',
        '.sd-item>i{font-size:1.15rem;width:1.5rem;text-align:center;flex-shrink:0;color:#71717a}',
        '.sd-item:hover>i{color:#10b981}',
        '.sd-item-label{flex:1;min-width:0}',
        '.sd-item-value{font-size:.78rem;color:#52525b;white-space:nowrap}',
        '.sd-item--danger{color:#ef4444}.sd-item--danger>i{color:#ef4444}',
        '.sd-item--danger:hover{background:rgba(239,68,68,.08);color:#ef4444}',
        '.sd-toggle{position:relative;width:40px;height:22px;flex-shrink:0;padding:0;border:none;',
        'background:rgba(255,255,255,.1);border-radius:11px;cursor:pointer;transition:background-color 200ms}',
        '.sd-toggle::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;',
        'border-radius:50%;background:#71717a;transition:left 200ms,background-color 200ms}',
        '.sd-toggle[aria-checked="true"]{background:rgba(16,185,129,.3)}',
        '.sd-toggle[aria-checked="true"]::after{left:21px;background:#10b981}',
        '.sd-toggle:focus-visible{outline:2px solid #10b981;outline-offset:2px}',
        '.sd-range{width:100px;accent-color:#10b981;cursor:pointer}',
        '.sd-step{width:28px;height:28px;font-size:.8rem;border-radius:8px;background:rgba(255,255,255,.06);',
        'border:1px solid rgba(255,255,255,.08);color:#a1a1aa;cursor:pointer;display:flex;',
        'align-items:center;justify-content:center;transition:background-color 200ms,color 200ms}',
        '.sd-step:hover{background:rgba(16,185,129,.15);color:#10b981}',
        '.sd-version{text-align:center;padding:1rem;padding-bottom:calc(1rem + env(safe-area-inset-bottom));',
        'font-size:.72rem;color:#3f3f46;border-top:1px solid rgba(255,255,255,.04);flex-shrink:0}'
    ].join('');

    var styleEl = document.createElement('style');
    styleEl.id = 'settings-drawer-styles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ---------- ESTRUTURA ----------
    var overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.id = 'settingsOverlay';
    overlay.hidden = false;

    var drawer = document.createElement('div');
    drawer.className = 'settings-drawer';
    drawer.id = 'settingsDrawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-labelledby', 'sdTitle');
    drawer.setAttribute('aria-hidden', 'true');

    function toggleRow(id, iconClass, label) {
        return '<div class="sd-item">' +
            '<i class="bi ' + iconClass + '" aria-hidden="true"></i>' +
            '<span class="sd-item-label" id="' + id + '-label">' + label + '</span>' +
            '<button type="button" class="sd-toggle" id="' + id + '" role="switch" ' +
            'aria-checked="false" aria-labelledby="' + id + '-label"></button>' +
            '</div>';
    }

    drawer.innerHTML =
        '<div class="sd-header">' +
        '<h2 id="sdTitle"><i class="bi bi-gear" aria-hidden="true"></i> Configurações</h2>' +
        '<button type="button" class="sd-close" id="sdClose" aria-label="Fechar configurações">' +
        '<i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
        '</div>' +
        '<div class="sd-body">' +

        // APARÊNCIA
        '<div class="sd-section">' +
        '<h3 class="sd-section-title">Aparência</h3>' +
        '<div class="sd-item">' +
        '<i class="bi bi-moon-stars" aria-hidden="true"></i>' +
        '<span class="sd-item-label">Tema Escuro</span>' +
        '<span class="sd-item-value" style="color:#10b981;">Ativo</span>' +
        '</div>' +
        '<div class="sd-item">' +
        '<i class="bi bi-type" aria-hidden="true"></i>' +
        '<span class="sd-item-label" id="sd-font-label">Tamanho da Fonte</span>' +
        '<span class="sd-item-value" id="sd-font-value" aria-live="polite">100%</span>' +
        '<span style="display:flex;gap:4px;">' +
        '<button type="button" class="sd-step" id="sd-font-down" aria-label="Diminuir tamanho da fonte">' +
        '<i class="bi bi-dash" aria-hidden="true"></i></button>' +
        '<button type="button" class="sd-step" id="sd-font-up" aria-label="Aumentar tamanho da fonte">' +
        '<i class="bi bi-plus" aria-hidden="true"></i></button>' +
        '</span></div>' +
        toggleRow('sd-reading-toggle', 'bi-book', 'Modo Leitura') +
        '</div>' +

        // ÁUDIO
        '<div class="sd-section">' +
        '<h3 class="sd-section-title">Áudio &amp; Voz</h3>' +
        '<div class="sd-item">' +
        '<i class="bi bi-soundwave" aria-hidden="true"></i>' +
        '<label class="sd-item-label" for="sd-tts-provider">Provedor TTS</label>' +
        '<select id="sd-tts-provider" class="select-sm" style="width:140px;">' +
        '<option value="elevenlabs">ElevenLabs</option>' +
        '<option value="auto">Auto (Smart)</option>' +
        '<option value="gemini">Gemini TTS</option>' +
        '<option value="google-cloud">Google Cloud</option>' +
        '<option value="google-translate">Google Translate</option>' +
        '</select></div>' +
        '<div class="sd-item">' +
        '<i class="bi bi-person-standing" aria-hidden="true"></i>' +
        '<label class="sd-item-label" for="sd-voice-gender">Narrador</label>' +
        '<select id="sd-voice-gender" class="select-sm" style="width:140px;">' +
        '<option value="male">Masculino</option>' +
        '<option value="female">Feminino</option>' +
        '</select></div>' +
        '<div class="sd-item">' +
        '<i class="bi bi-speedometer2" aria-hidden="true"></i>' +
        '<label class="sd-item-label" for="sd-voice-speed">Velocidade</label>' +
        '<span class="sd-item-value" id="sd-speed-value">1.0x</span>' +
        '<input type="range" class="sd-range" id="sd-voice-speed" min="0.5" max="2" step="0.1" value="1.0">' +
        '</div>' +
        '<div class="sd-item">' +
        '<i class="bi bi-volume-up" aria-hidden="true"></i>' +
        '<label class="sd-item-label" for="sd-voice-volume">Volume</label>' +
        '<span class="sd-item-value" id="sd-volume-value">100%</span>' +
        '<input type="range" class="sd-range" id="sd-voice-volume" min="0" max="1" step="0.05" value="1">' +
        '</div>' +
        toggleRow('sd-auto-read-toggle', 'bi-play-circle', 'Leitura Automática') +
        '</div>' +

        // NOTIFICAÇÕES
        '<div class="sd-section">' +
        '<h3 class="sd-section-title">Notificações</h3>' +
        toggleRow('sd-push-toggle', 'bi-bell', 'Push Notifications') +
        toggleRow('sd-desktop-toggle', 'bi-window', 'Notificações Desktop') +
        toggleRow('sd-sound-toggle', 'bi-music-note-beamed', 'Sons') +
        '</div>' +

        // ACESSIBILIDADE
        '<div class="sd-section">' +
        '<h3 class="sd-section-title">Acessibilidade</h3>' +
        toggleRow('sd-contrast-toggle', 'bi-circle-half', 'Alto Contraste') +
        toggleRow('sd-motion-toggle', 'bi-pause-circle', 'Reduzir Animações') +
        '</div>' +

        // SISTEMA
        '<div class="sd-section">' +
        '<h3 class="sd-section-title">Sistema</h3>' +
        '<button type="button" class="sd-item" id="sd-clear-cache">' +
        '<i class="bi bi-trash3" aria-hidden="true"></i>' +
        '<span class="sd-item-label">Limpar Cache</span>' +
        '<span class="sd-item-value">Mantém sua sessão</span></button>' +
        '<button type="button" class="sd-item" id="sd-sync-data">' +
        '<i class="bi bi-arrow-repeat" aria-hidden="true"></i>' +
        '<span class="sd-item-label">Sincronizar Dados</span></button>' +
        '<button type="button" class="sd-item" id="sd-check-update">' +
        '<i class="bi bi-cloud-arrow-down" aria-hidden="true"></i>' +
        '<span class="sd-item-label">Verificar Atualizações</span></button>' +
        '<div class="sd-item">' +
        '<i class="bi bi-info-circle" aria-hidden="true"></i>' +
        '<span class="sd-item-label">Versão</span>' +
        '<span class="sd-item-value">v3.0</span></div>' +
        '<div class="sd-item">' +
        '<i class="bi bi-wifi" aria-hidden="true"></i>' +
        '<span class="sd-item-label">Conexão</span>' +
        '<span class="sd-item-value" id="sd-connection" aria-live="polite">—</span></div>' +
        '</div>' +

        // CONTA
        '<div class="sd-section">' +
        '<h3 class="sd-section-title">Conta</h3>' +
        '<a href="' + PATHS.perfil + '" class="sd-item">' +
        '<i class="bi bi-person-circle" aria-hidden="true"></i>' +
        '<span class="sd-item-label">Editar Perfil</span>' +
        '<i class="bi bi-chevron-right" style="font-size:.85rem;width:auto;" aria-hidden="true"></i></a>' +
        '<a href="' + PATHS.meusDados + '" class="sd-item">' +
        '<i class="bi bi-shield-lock" aria-hidden="true"></i>' +
        '<span class="sd-item-label">Privacidade LGPD</span>' +
        '<i class="bi bi-chevron-right" style="font-size:.85rem;width:auto;" aria-hidden="true"></i></a>' +
        '<button type="button" class="sd-item sd-item--danger" id="sd-logout">' +
        '<i class="bi bi-box-arrow-right" aria-hidden="true"></i>' +
        '<span class="sd-item-label">Sair da Conta</span></button>' +
        '</div>' +

        '</div>' +
        '<div class="sd-version">Sistema Escolar v3.0 — NanDev</div>';

    function mount() {
        document.body.appendChild(overlay);
        document.body.appendChild(drawer);
        init();
    }

    // ---------- ABRIR / FECHAR ----------
    var lastFocused = null;

    function openSettings() {
        lastFocused = document.activeElement;
        overlay.classList.add('open');
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        updateConnection();
        var first = drawer.querySelector('#sdClose');
        if (first) first.focus();
    }

    function closeSettings() {
        overlay.classList.remove('open');
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
        lastFocused = null;
    }

    function isOpen() {
        return drawer.classList.contains('open');
    }

    // Focus trap: Tab não escapa do drawer enquanto ele estiver aberto.
    function trapFocus(e) {
        if (e.key !== 'Tab' || !isOpen()) return;
        var items = Array.prototype.filter.call(
            drawer.querySelectorAll(FOCUSABLE),
            function (el) { return el.offsetParent !== null; }
        );
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    // ---------- HELPERS ----------
    function showFeedback(msg, type) {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
        else if (window.Swal) window.Swal.fire({ text: msg, icon: type || 'success', background: '#0a0a0c', color: '#fafafa', confirmButtonColor: '#10b981' });
        else alert(msg);
    }

    function read(key, fallback) {
        try {
            var v = localStorage.getItem(key);
            return v === null ? fallback : v;
        } catch (e) {
            return fallback;
        }
    }

    function write(key, value) {
        try { localStorage.setItem(key, String(value)); } catch (e) { /* storage cheio/bloqueado */ }
    }

    function bindToggle(id, storageKey, onToggle, defaultOn) {
        var el = document.getElementById(id);
        if (!el) return;
        var saved = read(storageKey, null);
        var on = saved === null ? !!defaultOn : saved === 'true';
        el.setAttribute('aria-checked', String(on));
        if (onToggle) onToggle(on, true);

        el.addEventListener('click', function () {
            var next = el.getAttribute('aria-checked') !== 'true';
            el.setAttribute('aria-checked', String(next));
            write(storageKey, next);
            if (onToggle) onToggle(next, false);
        });
    }

    function updateConnection() {
        var el = document.getElementById('sd-connection');
        if (!el) return;
        el.textContent = navigator.onLine ? 'Online' : 'Offline';
        el.style.color = navigator.onLine ? '#10b981' : '#ef4444';
    }

    // ---------- INICIALIZAÇÃO ----------
    function init() {
        overlay.addEventListener('click', closeSettings);
        document.getElementById('sdClose').addEventListener('click', closeSettings);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) closeSettings();
            trapFocus(e);
        });

        window.addEventListener('online', updateConnection);
        window.addEventListener('offline', updateConnection);
        updateConnection();

        // ----- Escala de fonte -----
        var fontValue = document.getElementById('sd-font-value');

        function applyFontScale(scale) {
            scale = Math.min(1.4, Math.max(0.85, Math.round(scale * 100) / 100));
            document.documentElement.style.setProperty('--user-font-scale', scale);
            write('sd_font_scale', scale);
            if (fontValue) fontValue.textContent = Math.round(scale * 100) + '%';
            return scale;
        }

        var currentScale = parseFloat(read('sd_font_scale', '1')) || 1;
        applyFontScale(currentScale);

        document.getElementById('sd-font-down').addEventListener('click', function () {
            currentScale = applyFontScale(currentScale - 0.05);
        });
        document.getElementById('sd-font-up').addEventListener('click', function () {
            currentScale = applyFontScale(currentScale + 0.05);
        });

        // ----- Modo leitura -----
        bindToggle('sd-reading-toggle', 'sd_reading_mode', function (on) {
            document.documentElement.classList.toggle('reading-mode', on);
        });

        // ----- TTS -----
        var ttsSelect = document.getElementById('sd-tts-provider');
        ttsSelect.value = read('user_tts_provider', 'elevenlabs');
        ttsSelect.addEventListener('change', function () {
            write('user_tts_provider', ttsSelect.value);
            var legacy = document.getElementById('voice-provider-select');
            if (legacy) {
                legacy.value = ttsSelect.value;
                legacy.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        var genderSelect = document.getElementById('sd-voice-gender');
        genderSelect.value = read('user_voice_preference', 'male');
        genderSelect.addEventListener('change', function () {
            write('user_voice_preference', genderSelect.value);
        });

        var speedRange = document.getElementById('sd-voice-speed');
        var speedValue = document.getElementById('sd-speed-value');
        speedRange.value = read('user_voice_speed', '1.0');
        speedValue.textContent = parseFloat(speedRange.value).toFixed(1) + 'x';
        speedRange.addEventListener('input', function () {
            speedValue.textContent = parseFloat(speedRange.value).toFixed(1) + 'x';
            write('user_voice_speed', speedRange.value);
        });

        var volumeRange = document.getElementById('sd-voice-volume');
        var volumeValue = document.getElementById('sd-volume-value');
        volumeRange.value = read('user_voice_volume', '1');
        volumeValue.textContent = Math.round(parseFloat(volumeRange.value) * 100) + '%';
        volumeRange.addEventListener('input', function () {
            volumeValue.textContent = Math.round(parseFloat(volumeRange.value) * 100) + '%';
            write('user_voice_volume', volumeRange.value);
        });

        bindToggle('sd-auto-read-toggle', 'sd_auto_read');

        // ----- Notificações -----
        bindToggle('sd-push-toggle', 'sd_push_notifications', function (on, restoring) {
            if (on && !restoring && 'Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        });
        bindToggle('sd-desktop-toggle', 'sd_desktop_notifications');
        bindToggle('sd-sound-toggle', 'sd_sounds_enabled', null, true);

        // ----- Acessibilidade -----
        bindToggle('sd-contrast-toggle', 'sd_high_contrast', function (on) {
            document.documentElement.classList.toggle('high-contrast', on);
        });
        bindToggle('sd-motion-toggle', 'sd_reduce_motion', function (on) {
            document.documentElement.classList.toggle('reduce-motion', on);
        });

        // ----- Sistema -----
        document.getElementById('sd-clear-cache').addEventListener('click', async function () {
            try {
                if ('caches' in window) {
                    var names = await caches.keys();
                    await Promise.all(names.map(function (n) { return caches.delete(n); }));
                }

                // Remove apenas dados em cache. A sessão (sessionStorage), a
                // escola selecionada e as preferências são preservadas — antes
                // um localStorage.clear()/sessionStorage.clear() deslogava o
                // usuário e apagava o contexto da escola.
                var removable = [];
                for (var i = 0; i < localStorage.length; i++) {
                    var key = localStorage.key(i);
                    if (!key) continue;
                    var keep = PRESERVED_KEYS.indexOf(key) !== -1 ||
                        PRESERVED_PREFIXES.some(function (p) { return key.indexOf(p) === 0; });
                    if (!keep) removable.push(key);
                }
                removable.forEach(function (k) { localStorage.removeItem(k); });

                showFeedback('Cache limpo. Sua sessão foi mantida.', 'success');
            } catch (e) {
                console.error('Erro ao limpar cache:', e);
                showFeedback('Não foi possível limpar o cache.', 'error');
            }
        });

        document.getElementById('sd-sync-data').addEventListener('click', function () {
            showFeedback('Sincronizando dados…', 'info');
            setTimeout(function () { window.location.reload(); }, 600);
        });

        document.getElementById('sd-check-update').addEventListener('click', function () {
            if (!('serviceWorker' in navigator)) {
                showFeedback('Atualizações automáticas não suportadas neste navegador.', 'info');
                return;
            }
            navigator.serviceWorker.getRegistration().then(function (reg) {
                if (!reg) {
                    showFeedback('Nenhuma instalação encontrada.', 'info');
                    return;
                }
                return reg.update().then(function () {
                    showFeedback('Você está na versão mais recente.', 'success');
                });
            }).catch(function () {
                showFeedback('Não foi possível verificar atualizações.', 'error');
            });
        });

        // ----- Logout -----
        document.getElementById('sd-logout').addEventListener('click', function () {
            if (typeof window.sair === 'function') { window.sair(); return; }
            if (window.auth && typeof window.auth.logout === 'function') { window.auth.logout(); return; }
            window.location.href = PATHS.login;
        });

        mountTrigger();
    }

    // ---------- GATILHO NO HEADER ----------
    // Se a página já tem um botão de configurações, apenas o conecta. Caso
    // contrário, insere um no slot de ações do header — ou flutuante.
    function mountTrigger() {
        var existing = document.querySelectorAll(
            '#btn-open-settings,[data-open-settings],.settings-trigger'
        );
        if (existing.length) {
            Array.prototype.forEach.call(existing, function (btn) {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    openSettings();
                });
            });
            return;
        }

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'settings-trigger';
        btn.id = 'btn-open-settings';
        btn.setAttribute('aria-label', 'Abrir configurações');
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.title = 'Configurações';
        btn.innerHTML = '<i class="bi bi-gear" aria-hidden="true"></i>';
        btn.addEventListener('click', openSettings);

        var slot = document.querySelector(
            '.header-actions,.header-right,.topbar-actions,.nav-actions,.dashboard-header-actions'
        );
        if (slot) {
            slot.appendChild(btn);
        } else {
            btn.classList.add('settings-trigger--floating');
            document.body.appendChild(btn);
        }
    }

    // Expõe a API para os botões já existentes no HTML.
    window.openSettingsDrawer = openSettings;
    window.closeSettingsDrawer = closeSettings;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
