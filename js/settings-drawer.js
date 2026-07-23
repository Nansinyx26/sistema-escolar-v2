/**
 * settings-drawer.js — Painel de Configurações Unificado
 * Substitui botões dispersos no header por um drawer lateral elegante.
 * v1.0
 */
(function () {
    'use strict';

    // Avoid double init
    if (window.__settingsDrawerInit) return;
    window.__settingsDrawerInit = true;

    // ---------- CSS INJECTION ----------
    const css = `
    /* ===== SETTINGS DRAWER ===== */
    .settings-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.6);
        backdrop-filter: blur(4px);
        z-index: 1090;
        opacity: 0;
        pointer-events: none;
        transition: opacity 250ms var(--ease-out, cubic-bezier(0.16,1,0.3,1));
    }
    .settings-overlay.open { opacity: 1; pointer-events: auto; }

    .settings-drawer {
        position: fixed; top: 0; right: 0;
        width: min(380px, 92vw);
        height: 100vh; height: 100dvh;
        background: #0a0a0c;
        border-left: 1px solid rgba(255,255,255,0.06);
        z-index: 1095;
        display: flex; flex-direction: column;
        transform: translateX(100%);
        transition: transform 300ms var(--ease-out, cubic-bezier(0.16,1,0.3,1));
        overflow: hidden;
    }
    .settings-drawer.open { transform: translateX(0); }

    .sd-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        flex-shrink: 0;
    }
    .sd-header h2 {
        margin: 0; font-size: 1.1rem; font-weight: 700; color: #fafafa;
        display: flex; align-items: center; gap: 0.5rem;
    }
    .sd-close {
        width: 36px; height: 36px; border-radius: 10px;
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);
        color: #a1a1aa; cursor: pointer; font-size: 1.1rem;
        display: flex; align-items: center; justify-content: center;
        transition: all 200ms;
    }
    .sd-close:hover { background: rgba(239,68,68,0.15); color: #ef4444; border-color: rgba(239,68,68,0.3); }

    .sd-body {
        flex: 1; overflow-y: auto; padding: 1rem 1.5rem 2rem;
        scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent;
    }

    .sd-section { margin-bottom: 1.75rem; }
    .sd-section-title {
        font-size: 0.68rem; font-weight: 700; color: #52525b;
        text-transform: uppercase; letter-spacing: 0.08em;
        margin-bottom: 0.75rem; padding-bottom: 0.5rem;
        border-bottom: 1px solid rgba(255,255,255,0.04);
    }

    .sd-item {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0.65rem 0.75rem; border-radius: 10px;
        color: #d4d4d8; font-size: 0.88rem; cursor: pointer;
        transition: background 150ms, color 150ms;
        gap: 0.75rem; text-decoration: none;
        border: none; background: none; width: 100%; text-align: left;
        font-family: inherit;
    }
    .sd-item:hover { background: rgba(255,255,255,0.04); color: #fafafa; }
    .sd-item i { font-size: 1.15rem; width: 1.5rem; text-align: center; flex-shrink: 0; color: #71717a; }
    .sd-item:hover i { color: #10b981; }
    .sd-item-label { flex: 1; }
    .sd-item-value { font-size: 0.78rem; color: #52525b; }
    .sd-item--danger { color: #ef4444; }
    .sd-item--danger i { color: #ef4444; }
    .sd-item--danger:hover { background: rgba(239,68,68,0.08); }

    /* Toggle switch */
    .sd-toggle {
        position: relative; width: 40px; height: 22px;
        background: rgba(255,255,255,0.1); border-radius: 11px;
        cursor: pointer; transition: background 200ms; flex-shrink: 0;
    }
    .sd-toggle::after {
        content: ''; position: absolute; top: 3px; left: 3px;
        width: 16px; height: 16px; border-radius: 50%;
        background: #71717a; transition: all 200ms;
    }
    .sd-toggle.active { background: rgba(16,185,129,0.3); }
    .sd-toggle.active::after { left: 21px; background: #10b981; }

    /* Range slider */
    .sd-range { width: 100px; accent-color: #10b981; }

    .sd-version {
        text-align: center; padding: 1rem;
        font-size: 0.72rem; color: #3f3f46;
        border-top: 1px solid rgba(255,255,255,0.04);
        flex-shrink: 0;
    }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ---------- HTML STRUCTURE ----------
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.id = 'settingsOverlay';

    const drawer = document.createElement('div');
    drawer.className = 'settings-drawer';
    drawer.id = 'settingsDrawer';
    drawer.innerHTML = `
        <div class="sd-header">
            <h2><i class="bi bi-gear"></i> Configurações</h2>
            <button class="sd-close" id="sdClose" title="Fechar"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="sd-body">

            <!-- APARÊNCIA -->
            <div class="sd-section">
                <div class="sd-section-title">Aparência</div>
                <div class="sd-item" id="sd-theme-dark">
                    <i class="bi bi-moon-stars"></i>
                    <span class="sd-item-label">Tema Escuro</span>
                    <span class="sd-item-value" style="color:#10b981;">● Ativo</span>
                </div>
                <div class="sd-item" id="sd-font-size">
                    <i class="bi bi-type"></i>
                    <span class="sd-item-label">Tamanho da Fonte</span>
                    <div style="display:flex;gap:4px;">
                        <button class="sd-close" style="width:28px;height:28px;font-size:0.8rem;" id="sd-font-down" title="Diminuir"><i class="bi bi-dash"></i></button>
                        <button class="sd-close" style="width:28px;height:28px;font-size:0.8rem;" id="sd-font-up" title="Aumentar"><i class="bi bi-plus"></i></button>
                    </div>
                </div>
                <div class="sd-item" id="sd-reading-mode">
                    <i class="bi bi-book"></i>
                    <span class="sd-item-label">Modo Leitura</span>
                    <div class="sd-toggle" id="sd-reading-toggle"></div>
                </div>
            </div>

            <!-- ÁUDIO -->
            <div class="sd-section">
                <div class="sd-section-title">Áudio & Voz</div>
                <div class="sd-item">
                    <i class="bi bi-soundwave"></i>
                    <span class="sd-item-label">Provedor TTS</span>
                    <select id="sd-tts-provider" style="width:130px;min-height:34px;font-size:0.8rem;padding:0.35rem 2rem 0.35rem 0.65rem;">
                        <option value="elevenlabs">ElevenLabs</option>
                        <option value="auto">Auto (Smart)</option>
                        <option value="google-cloud">Google Cloud</option>
                        <option value="google-translate">Google Translate</option>
                    </select>
                </div>
                <div class="sd-item">
                    <i class="bi bi-person-standing"></i>
                    <span class="sd-item-label">Voz Masculina</span>
                    <div class="sd-toggle active" id="sd-voice-male-toggle"></div>
                </div>
                <div class="sd-item">
                    <i class="bi bi-speedometer2"></i>
                    <span class="sd-item-label">Velocidade</span>
                    <input type="range" class="sd-range" id="sd-voice-speed" min="0.5" max="2" step="0.1" value="1.0">
                </div>
                <div class="sd-item">
                    <i class="bi bi-volume-up"></i>
                    <span class="sd-item-label">Leitura Automática</span>
                    <div class="sd-toggle" id="sd-auto-read-toggle"></div>
                </div>
            </div>

            <!-- NOTIFICAÇÕES -->
            <div class="sd-section">
                <div class="sd-section-title">Notificações</div>
                <div class="sd-item" id="sd-notif-push">
                    <i class="bi bi-bell"></i>
                    <span class="sd-item-label">Push Notifications</span>
                    <div class="sd-toggle" id="sd-push-toggle"></div>
                </div>
                <div class="sd-item" id="sd-notif-sound">
                    <i class="bi bi-music-note-beamed"></i>
                    <span class="sd-item-label">Sons</span>
                    <div class="sd-toggle active" id="sd-sound-toggle"></div>
                </div>
            </div>

            <!-- ACESSIBILIDADE -->
            <div class="sd-section">
                <div class="sd-section-title">Acessibilidade</div>
                <div class="sd-item" id="sd-high-contrast">
                    <i class="bi bi-circle-half"></i>
                    <span class="sd-item-label">Alto Contraste</span>
                    <div class="sd-toggle" id="sd-contrast-toggle"></div>
                </div>
                <div class="sd-item" id="sd-reduce-motion">
                    <i class="bi bi-pause-circle"></i>
                    <span class="sd-item-label">Reduzir Animações</span>
                    <div class="sd-toggle" id="sd-motion-toggle"></div>
                </div>
            </div>

            <!-- SISTEMA -->
            <div class="sd-section">
                <div class="sd-section-title">Sistema</div>
                <button class="sd-item" id="sd-clear-cache">
                    <i class="bi bi-trash3"></i>
                    <span class="sd-item-label">Limpar Cache</span>
                </button>
                <button class="sd-item" id="sd-sync-data">
                    <i class="bi bi-arrow-repeat"></i>
                    <span class="sd-item-label">Sincronizar Dados</span>
                </button>
                <div class="sd-item">
                    <i class="bi bi-info-circle"></i>
                    <span class="sd-item-label">Versão</span>
                    <span class="sd-item-value">v3.0</span>
                </div>
            </div>

            <!-- CONTA -->
            <div class="sd-section">
                <div class="sd-section-title">Conta</div>
                <a href="perfil.html" class="sd-item" id="sd-edit-profile">
                    <i class="bi bi-person-circle"></i>
                    <span class="sd-item-label">Editar Perfil</span>
                    <i class="bi bi-chevron-right" style="font-size:0.85rem;width:auto;"></i>
                </a>
                <a href="meus-dados.html" class="sd-item" id="sd-privacy">
                    <i class="bi bi-shield-lock"></i>
                    <span class="sd-item-label">Privacidade LGPD</span>
                    <i class="bi bi-chevron-right" style="font-size:0.85rem;width:auto;"></i>
                </a>
                <button class="sd-item sd-item--danger" id="sd-logout">
                    <i class="bi bi-box-arrow-right"></i>
                    <span class="sd-item-label">Sair da Conta</span>
                </button>
            </div>
        </div>
        <div class="sd-version">Sistema Escolar v3.0 — NanDev</div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    // ---------- OPEN / CLOSE ----------
    function openSettings() {
        overlay.classList.add('open');
        drawer.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeSettings() {
        overlay.classList.remove('open');
        drawer.classList.remove('open');
        document.body.style.overflow = '';
    }

    overlay.addEventListener('click', closeSettings);
    document.getElementById('sdClose').addEventListener('click', closeSettings);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawer.classList.contains('open')) closeSettings();
    });

    // Expose globally for header button
    window.openSettingsDrawer = openSettings;
    window.closeSettingsDrawer = closeSettings;

    // ---------- TOGGLE HELPERS ----------
    function bindToggle(toggleId, storageKey, onToggle) {
        const el = document.getElementById(toggleId);
        if (!el) return;
        // Restore state
        const saved = localStorage.getItem(storageKey);
        if (saved === 'true') el.classList.add('active');
        else if (saved === 'false') el.classList.remove('active');

        el.addEventListener('click', () => {
            el.classList.toggle('active');
            const isActive = el.classList.contains('active');
            localStorage.setItem(storageKey, isActive);
            if (onToggle) onToggle(isActive);
        });
    }

    // ---------- FONT SIZE ----------
    document.getElementById('sd-font-down')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = document.getElementById('btn-font-decrease');
        if (btn) btn.click();
    });
    document.getElementById('sd-font-up')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = document.getElementById('btn-font-increase');
        if (btn) btn.click();
    });

    // ---------- READING MODE ----------
    bindToggle('sd-reading-toggle', 'sd_reading_mode', (on) => {
        const btn = document.getElementById('btn-toggle-reading');
        if (btn) btn.click();
    });

    // ---------- TTS PROVIDER ----------
    const ttsSelect = document.getElementById('sd-tts-provider');
    if (ttsSelect) {
        const saved = localStorage.getItem('user_tts_provider') || 'elevenlabs';
        ttsSelect.value = saved;
        ttsSelect.addEventListener('change', () => {
            localStorage.setItem('user_tts_provider', ttsSelect.value);
            const existingSelect = document.getElementById('voice-provider-select');
            if (existingSelect) existingSelect.value = ttsSelect.value;
        });
    }

    // ---------- VOICE SPEED ----------
    const speedRange = document.getElementById('sd-voice-speed');
    if (speedRange) {
        speedRange.value = localStorage.getItem('user_voice_speed') || '1.0';
        speedRange.addEventListener('input', () => {
            localStorage.setItem('user_voice_speed', speedRange.value);
        });
    }

    // ---------- TOGGLES ----------
    bindToggle('sd-push-toggle', 'sd_push_notifications');
    bindToggle('sd-sound-toggle', 'sd_sounds_enabled');
    bindToggle('sd-contrast-toggle', 'sd_high_contrast', (on) => {
        document.documentElement.classList.toggle('high-contrast', on);
    });
    bindToggle('sd-motion-toggle', 'sd_reduce_motion', (on) => {
        document.documentElement.classList.toggle('reduce-motion', on);
    });
    bindToggle('sd-auto-read-toggle', 'sd_auto_read');

    // ---------- SYSTEM ACTIONS ----------
    document.getElementById('sd-clear-cache')?.addEventListener('click', async () => {
        try {
            if ('caches' in window) {
                const names = await caches.keys();
                await Promise.all(names.map(n => caches.delete(n)));
            }
            localStorage.clear();
            sessionStorage.clear();
            if (typeof showToast === 'function') showToast('Cache limpo com sucesso!', 'success');
            else alert('Cache limpo!');
        } catch (e) {
            console.error('Erro ao limpar cache:', e);
        }
    });

    document.getElementById('sd-sync-data')?.addEventListener('click', () => {
        if (typeof showToast === 'function') showToast('Dados sincronizados!', 'success');
        window.location.reload();
    });

    // ---------- LOGOUT ----------
    document.getElementById('sd-logout')?.addEventListener('click', () => {
        if (window.sair) { window.sair(); return; }
        if (window.auth && window.auth.logout) { window.auth.logout(); return; }
        window.location.href = 'login.html';
    });

})();
