/**
 * Sidebar and Voice Command Logic 3.0
 */

document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.remove('high-contrast');
    initSidebar();
    initSidebarProfile();
    initVoiceCommand();
    initVoiceToggles();
});

/**
 * Sidebar Toggle and Persistence
 */
function initSidebar() {
    const sidebar = document.getElementById('mainSidebar');
    const toggle = document.getElementById('sidebarToggle');
    const wrapper = document.getElementById('pageWrapper');
    
    if (!sidebar || !toggle) return;

    // Load state
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        wrapper?.classList.add('collapsed');
        toggle.querySelector('i').classList.replace('bi-chevron-left', 'bi-chevron-right');
    }

    toggle.addEventListener('click', () => {
        const collapsed = sidebar.classList.toggle('collapsed');
        wrapper?.classList.toggle('collapsed');
        localStorage.setItem('sidebar_collapsed', collapsed);
        
        // Update icon
        const icon = toggle.querySelector('i');
        if (collapsed) {
            icon.classList.replace('bi-chevron-left', 'bi-chevron-right');
        } else {
            icon.classList.replace('bi-chevron-right', 'bi-chevron-left');
        }
    });

    // Mobile logic
    let scrollLockY = 0;

    const createOverlay = () => {
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(overlay);
        return overlay;
    };

    const overlay = document.querySelector('.sidebar-overlay') || createOverlay();

    const isMobileSidebar = () => window.matchMedia('(max-width: 768px)').matches;

    const openMobileSidebar = () => {
        sidebar.classList.add('mobile-open');
        overlay.classList.add('visible');
        document.body.classList.add('sidebar-open', 'sidebar-lock');
        scrollLockY = window.scrollY;
        document.body.style.top = `-${scrollLockY}px`;
        overlay.setAttribute('aria-hidden', 'false');
        const burger = document.getElementById('mobileHamburger');
        if (burger) {
            burger.setAttribute('aria-expanded', 'true');
            burger.setAttribute('aria-label', 'Fechar menu lateral');
            burger.classList.add('is-active');
        }
    };

    const closeMobileSidebar = () => {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('visible');
        document.body.classList.remove('sidebar-open', 'sidebar-lock');
        document.body.style.top = '';
        window.scrollTo(0, scrollLockY);
        overlay.setAttribute('aria-hidden', 'true');
        const burger = document.getElementById('mobileHamburger');
        if (burger) {
            burger.setAttribute('aria-expanded', 'false');
            burger.setAttribute('aria-label', 'Abrir menu lateral');
            burger.classList.remove('is-active');
        }
    };

    const toggleMobileSidebar = () => {
        if (sidebar.classList.contains('mobile-open')) closeMobileSidebar();
        else openMobileSidebar();
    };

    overlay.addEventListener('click', closeMobileSidebar);

    window.DashboardSidebar = {
        open: openMobileSidebar,
        close: closeMobileSidebar,
        toggle: toggleMobileSidebar,
        isOpen: () => sidebar.classList.contains('mobile-open')
    };

    // Add mobile burger if not exists
    const menuBtnContainer = document.querySelector('.header-left') || document.querySelector('.navbar-content') || document.querySelector('.dashboard-header');
    if (sidebar && menuBtnContainer && !document.getElementById('mobileHamburger')) {
        const burger = document.createElement('button');
        burger.id = 'mobileHamburger';
        burger.type = 'button';
        burger.className = 'btn-hamburger';
        burger.innerHTML = '<i class="bi bi-list"></i>';
        burger.setAttribute('aria-label', 'Abrir menu lateral');
        burger.setAttribute('aria-expanded', 'false');
        burger.setAttribute('aria-controls', 'mainSidebar');
        burger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMobileSidebar();
        });
        menuBtnContainer.prepend(burger);
    }

    sidebar.querySelectorAll('.sidebar-item').forEach((item) => {
        item.addEventListener('click', () => {
            if (isMobileSidebar()) closeMobileSidebar();
        });
    });

    window.addEventListener('resize', () => {
        if (!isMobileSidebar() && sidebar.classList.contains('mobile-open')) {
            closeMobileSidebar();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('mobile-open')) {
            closeMobileSidebar();
        }
    });

    setActiveSidebarItem();
}

/**
 * Automagically sets .active class based on current URL
 */
function setActiveSidebarItem() {
    const currentPath = window.location.pathname;
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    
    sidebarItems.forEach(item => {
        item.classList.remove('active');
        const href = item.getAttribute('href');
        
        if (href && href !== '#' && currentPath.includes(href)) {
            item.classList.add('active');
        } else if (href === 'dashboard.html' && (currentPath.endsWith('/') || currentPath.endsWith('index.html'))) {
            item.classList.add('active');
        }
    });

    if (currentPath.includes('direcao/index.html')) {
        const relatoriosLink = document.querySelector('a[onclick*="verRelatorios"]');
        if (relatoriosLink) relatoriosLink.classList.add('active');
    }
}

/**
 * Sidebar User Profile Population and Accessibility Loading
 */
function initSidebarProfile() {
    const updateProfile = () => {
        const user = window.auth ? window.auth.getCurrentUser() : null;
        if (!user) return;

        const avatar = document.getElementById('sidebarAvatar');
        const name = document.getElementById('sidebarUserName');
        const role = document.getElementById('sidebarUserRole');
        const escola = document.getElementById('sidebarUserEscola');

        if (avatar) {
            avatar.src = window.getPhotoUrl ? window.getPhotoUrl(user.foto, user.fotoGoogle) : (user.foto || user.fotoGoogle || '/img/default-avatar.png');
        }
        if (name) name.textContent = user.nome || 'Usuário';
        if (role) {
            role.textContent = user.perfil === 'diretor' ? 'Diretor(a)' : 'Professor(a)';
        }
        if (escola) {
            escola.textContent = user.escola || 'Escola Padrão';
        }

        // --- CARREGAMENTO DE PREFERÊNCIAS (MONGODB - SOURCE OF TRUTH) ---
        
        // 1. Narração/Display Mode
        const mode = user.settings?.narrationMode || user.preferenciaNarracao || 'texto_audio';
        localStorage.setItem('user_narration_mode', mode);
        applyDisplayModeClass(mode);
        const modeSelect = document.getElementById('voice-mode-select');
        if (modeSelect) modeSelect.value = mode;

        // 2. Velocidade da Voz (FIXADA em 1.0x conforme solicitado)
        localStorage.setItem('user_voice_speed', 1.0);

        // 3. Provedor TTS preferido (Fixo em ElevenLabs)
        localStorage.setItem('user_tts_provider', 'elevenlabs');
        
        // 4. Voz ElevenLabs (persiste preferência do usuário)
        if (!localStorage.getItem('user_elevenlabs_voice')) {
            localStorage.setItem('user_elevenlabs_voice', 'adam');
        }
        // Gênero fixo Masculino
        localStorage.setItem('user_voice_preference', 'male');
        
        // --- ENSURE VISIBILITY ---
        // Ensure voice selector is never hidden by "Apenas Texto" mode initialization
        const wrapper = document.querySelector('.voice-selector-wrapper');
        if (wrapper) wrapper.style.display = 'block';


        // 5. Tamanho da Fonte
        const fontSize = user.accessibilityFontSize || '100%';
        document.documentElement.style.fontSize = fontSize;
        
        // 6. Modo Leitura
        const reading = !!user.accessibilityReadingMode;
        document.body.classList.toggle('reading-mode', reading);
        const readingBtn = document.getElementById('btn-toggle-reading');
        if (readingBtn) readingBtn.classList.toggle('active', reading);
    };

    updateProfile();

    // Novo: escuta atualizações de perfil (ex: vindo do auth.refreshUser)
    window.addEventListener('auth:updated', updateProfile);
}

/**
 * Global Voice Synthesis (TTS) Helper
 *
 * Preferências salvas no localStorage:
 *   user_voice_preference  → 'female' | 'male' | 'off'
 *   user_tts_provider      → 'auto' | 'gemini' | 'elevenlabs'
 *
 * O campo `provider` é enviado ao backend que tenta o provedor escolhido
 * e faz fallback automático para o outro caso falhe.
 * Se o backend falhar por completo, exibe um alerta de erro.
 */
let currentAudio = null;

window.speak = async (text, forceSpeak = false) => {
    if (!text) return null;
    
    // Cancela áudio anterior
    if (window.stopTtsAudio) window.stopTtsAudio();

    try {
        console.log('[Voice] Enviando texto para TTS backend:', text.substring(0, 60) + '...');
        
        const response = await fetch(`${window.API_BASE_URL || '/api'}/tts/speak`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] || ''
            },
            body: JSON.stringify({ 
                text: text,
                voice: 'male',
                provider: 'elevenlabs',
                voiceId: localStorage.getItem('user_elevenlabs_voice') || 'adam'
            }),
            credentials: 'include'
        });

        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            console.error(`[Voice] TTS falhou: HTTP ${response.status}`, errBody);
            // Mostrar erro visível ao usuário
            if (window.showToast) {
                window.showToast(`Erro na voz: ${response.status === 401 ? 'Sessão expirada' : 'Servidor indisponível'}`, 'error');
            }
            return null;
        }

        const blob = await response.blob();
        if (blob.size < 100) {
            console.warn('[Voice] Áudio retornado muito pequeno:', blob.size, 'bytes');
            return null;
        }
        
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        
        window.currentTtsAudio = audio;
        currentAudio = audio;
        
        audio.onended = () => {
            window.dispatchEvent(new CustomEvent('tts:ended'));
            URL.revokeObjectURL(url);
            currentAudio = null;
        };

        await audio.play();
        console.log('[Voice] ✅ Áudio reproduzindo com sucesso');
        window.dispatchEvent(new CustomEvent('tts:started'));
        return audio;

    } catch (error) {
        console.error('[Voice] Erro no pipeline TTS:', error.message);
        if (window.showToast) {
            window.showToast('Erro ao reproduzir áudio. Verifique a conexão.', 'error');
        }
        return null;
    }
};

window.stopTtsAudio = () => {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    document.querySelectorAll('.voice-wave-container, .voice-animation-container').forEach(el => el.style.display = 'none');
    if (window.VoiceOrbManager) window.VoiceOrbManager.destroy();
};

function initVoiceCommand() {
    // REMOVIDO: Proibição de uso da Web Speech API nativa
    console.log('[Voice] Comandos de voz via navegador desativados por política de segurança.');
}

document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action], [data-href]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const href = target.getAttribute('data-href');
    if (action === 'sair') {
        if (typeof window.sair === 'function') window.sair();
        else if (window.auth) window.auth.logout();
    } else if (href) { window.location.href = href; }
});

function initVoiceToggles() {
    const btnSettings = document.getElementById('btn-voice-settings');
    const panel = document.getElementById('voice-settings-panel');
    const btnActivate = document.getElementById('btn-activate-voice');
    const optBtns = document.querySelectorAll('.voice-opt-btn');
    const modeSelect = document.getElementById('voice-mode-select');

    if (btnSettings && panel) {
        btnSettings.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
        });
        // Botão "Configurações Voz" do sidebar abre o mesmo painel.
        // Precisa de stopPropagation próprio: sem isso o clique sobe até o
        // document e o listener global abaixo fecha o painel no mesmo clique.
        const sidebarVoiceBtn = document.getElementById('sidebar-voice-btn');
        if (sidebarVoiceBtn) {
            sidebarVoiceBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
            });
        }
        document.addEventListener('click', () => { if (panel) panel.style.display = 'none'; });
        panel.addEventListener('click', (e) => e.stopPropagation());
    }

    // --- Seletor de voz ElevenLabs ---
    const voiceSelect = document.getElementById('voice-provider-select');
    if (voiceSelect) {
        // Injeta as opções de voz se ainda não existirem
        const hasVoiceOptions = voiceSelect.querySelector('option[data-elevenlabs-voice]');
        if (!hasVoiceOptions) {
            const voices = [
                { id: 'adam',   label: 'Adam — Firme e Dominante' },
                { id: 'brian',  label: 'Brian — Profundo e Tranquilo' },
                { id: 'eric',   label: 'Eric — Suave e Confiável' },
                { id: 'george', label: 'George — Caloroso e Narrativo' },
            ];
            // Substitui o select pelo de vozes
            voiceSelect.innerHTML = voices.map(v =>
                `<option value="${v.id}" data-elevenlabs-voice="1">${v.label}</option>`
            ).join('');
        }

        // Restaura a preferência salva
        const saved = localStorage.getItem('user_elevenlabs_voice') || 'adam';
        voiceSelect.value = saved;

        voiceSelect.addEventListener('change', () => {
            const chosen = voiceSelect.value;
            localStorage.setItem('user_elevenlabs_voice', chosen);
            window.dispatchEvent(new CustomEvent('voiceChanged', { detail: { voice: chosen } }));
            // Preview: fala um texto rápido com a nova voz
            if (window.speak) window.speak('Voz alterada com sucesso!');
        });
    }

    const updateVoiceUI = () => {
        optBtns.forEach(btn => {
            const v = btn.getAttribute('data-voice');
            if (v === 'female') { btn.style.display = 'none'; return; }
            if (v === 'male') {
                btn.style.borderColor = '#10b981';
                btn.style.background = 'rgba(16, 185, 129, 0.1)';
            }
        });
    };

    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            const mode = modeSelect.value;
            localStorage.setItem('user_narration_mode', mode);
            applyDisplayModeClass(mode);
        });
    }

    if (btnActivate) {
        btnActivate.addEventListener('click', () => {
            window.speak('Voz masculina ativada. Posso te ajudar?');
        });
    }

    updateVoiceUI();
}

async function saveAccessibilityPreference(prefs = {}) {
    // Mantido para compatibilidade, mas o sistema agora é travado no ElevenLabs Masculino no backend
}

function applyDisplayModeClass(mode) {
    document.body.classList.remove('preference-texto', 'preference-texto-audio', 'preference-audio');
    if (mode === 'texto') document.body.classList.add('preference-texto');
    else if (mode === 'audio') document.body.classList.add('preference-audio');
    else document.body.classList.add('preference-texto-audio');
}


function getCsrfToken() {
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}
