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

        if (avatar) avatar.src = user.foto || user.fotoGoogle || '../img/default-avatar.png';
        if (name) name.textContent = user.nome || 'Usuário';
        if (role) {
            role.textContent = user.perfil === 'diretor' ? 'Diretor(a)' : 'Professor(a)';
        }
        if (escola) {
            escola.textContent = user.escola || 'Escola Padrão';
        }

        // --- CARREGAMENTO DE PREFERÊNCIAS (MONGODB ATLAS) ---
        
        // 1. Narração/Display Mode
        const mode = user.preferenciaNarracao || 'texto_audio';
        applyDisplayModeClass(mode);
        const modeSelect = document.getElementById('voice-mode-select');
        if (modeSelect) modeSelect.value = mode;

        // 2. Velocidade da Voz
        const speed = user.voiceSpeed || 1.0;
        const speedSelect = document.getElementById('voice-speed-select');
        if (speedSelect) speedSelect.value = speed;

        // 3. Provedor TTS preferido
        const ttsProvider = user.ttsProvider || 'auto';
        localStorage.setItem('user_tts_provider', ttsProvider);
        const providerSelect = document.getElementById('voice-provider-select');
        if (providerSelect) providerSelect.value = ttsProvider;

        // 4. Gênero da voz (banco sobrescreve localStorage se salvo)
        if (user.voiceGender) {
            localStorage.setItem('user_voice_preference', user.voiceGender);
        }

        // 5. Tamanho da Fonte
        const fontSize = user.accessibilityFontSize || '100%';
        document.documentElement.style.fontSize = fontSize;
        
        // 6. Modo Leitura
        const reading = !!user.accessibilityReadingMode;
        document.body.classList.toggle('reading-mode', reading);
        const readingBtn = document.getElementById('btn-toggle-reading');
        if (readingBtn) readingBtn.classList.toggle('active', reading);
    };

    setTimeout(updateProfile, 500);
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
 * Se o backend falhar por completo, usa a Web Speech API do navegador.
 */
let currentAudio = null;

window.speak = async (text) => {
    const pref     = localStorage.getItem('user_voice_preference') || 'female';
    const provider = localStorage.getItem('user_tts_provider')     || 'auto';

    if (pref === 'off') return;
    if (!text || !text.trim()) return;

    // Para narração em andamento
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

    const speedSelect = document.getElementById('voice-speed-select');
    const speed = speedSelect ? parseFloat(speedSelect.value) : 1.0;

    try {
        const response = await fetch(`${window.API_BASE_URL}/tts`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                text:     text.substring(0, 500),
                gender:   pref,
                provider: provider   // 'auto' | 'gemini' | 'elevenlabs'
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.warn(`[TTS] Backend indisponível (${errData.error || response.status}). Usando voz nativa.`);
            _speakNative(text, speed, pref);
            return;
        }

        const blob = await response.blob();
        if (!blob || blob.size === 0) {
            console.warn('[TTS] Blob vazio. Usando voz nativa.');
            _speakNative(text, speed, pref);
            return;
        }

        const usedProvider = response.headers.get('X-Provider') || provider;
        console.info(`[TTS] Áudio recebido via ${usedProvider} (${blob.size} bytes)`);

        const url   = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = speed;
        currentAudio = audio;

        audio.addEventListener('play', () => {
            document.querySelectorAll('.voice-wave-container').forEach(el => el.classList.add('playing'));
        });
        audio.addEventListener('ended', () => {
            document.querySelectorAll('.voice-wave-container').forEach(el => el.classList.remove('playing'));
            URL.revokeObjectURL(url);
            currentAudio = null;
            window.dispatchEvent(new Event('tts:ended'));
        });
        audio.addEventListener('pause', () => {
            document.querySelectorAll('.voice-wave-container').forEach(el => el.classList.remove('playing'));
        });
        audio.addEventListener('error', () => {
            console.warn('[TTS] Erro ao reproduzir. Usando voz nativa.');
            _speakNative(text, speed, pref);
        });

        await audio.play();

    } catch (err) {
        console.warn('[TTS] Falha ao conectar ao backend:', err.message, '— usando voz nativa.');
        _speakNative(text, speed, pref);
    }
};

/**
 * Fallback: Web Speech API (voz nativa do navegador)
 * Silencioso — não mostra erros ao usuário
 */
function _speakNative(text, speed = 1.0, pref = 'female') {
    if (!('speechSynthesis' in window)) return;
    try {
        const utterance = new SpeechSynthesisUtterance(text.substring(0, 300));
        utterance.lang = 'pt-BR';
        utterance.rate = speed;
        utterance.pitch = 1;

        const voices = window.speechSynthesis.getVoices();
        const ptVoices = voices.filter(v => v.lang && v.lang.startsWith('pt'));
        if (ptVoices.length > 0) {
            const preferred = ptVoices.find(v =>
                pref === 'female'
                    ? /female|feminina|mulher|Luciana|Francisca/i.test(v.name)
                    : /male|masculino|homem|Ricardo|Daniel/i.test(v.name)
            );
            utterance.voice = preferred || ptVoices[0];
        }

        utterance.onstart = () => {
            document.querySelectorAll('.voice-wave-container').forEach(el => el.classList.add('playing'));
        };
        utterance.onend = () => {
            document.querySelectorAll('.voice-wave-container').forEach(el => el.classList.remove('playing'));
            window.dispatchEvent(new Event('tts:ended'));
        };
        utterance.onerror = () => {
            document.querySelectorAll('.voice-wave-container').forEach(el => el.classList.remove('playing'));
        };

        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.warn('[TTS] Voz nativa também falhou:', e.message);
        document.querySelectorAll('.voice-wave-container').forEach(el => el.classList.remove('playing'));
    }
}

/**
 * Voice Command System (Web Speech API)
 */
function initVoiceCommand() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('Speech Recognition not supported in this browser.');
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    recognition.continuous = false;

    const micBtn = document.getElementById('btn-start-voice');
    const searchBar = document.getElementById('voiceSearchBar');
    const statusText = document.getElementById('voiceStatus');
    const transcription = document.getElementById('voiceTranscription');

    if (!micBtn) return;

    let isListening = false;

    micBtn.addEventListener('click', () => {
        if (isListening) {
            recognition.stop();
        } else {
            try {
                recognition.start();
            } catch (e) {
                console.error('Error starting recognition:', e);
            }
        }
    });

    recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add('voice-btn-active');
        searchBar.style.display = 'flex';
        statusText.textContent = 'Ouvindo...';
        transcription.textContent = 'Fale agora...';
    };

    recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(result => result[0])
            .map(result => result.transcript)
            .join('');

        transcription.textContent = transcript;

        if (event.results[0].isFinal) {
            handleVoiceCommand(transcript.toLowerCase());
            setTimeout(() => {
                recognition.stop();
            }, 1000);
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        statusText.textContent = 'Erro';
        transcription.textContent = getErrorMessage(event.error);
        setTimeout(() => recognition.stop(), 2000);
    };

    recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove('voice-btn-active');
        setTimeout(() => {
            if (!isListening) searchBar.style.display = 'none';
        }, 2000);
    };

    function getErrorMessage(error) {
        switch (error) {
            case 'not-allowed': return 'Microfone bloqueado';
            case 'no-speech': return 'Nenhuma voz detectada';
            case 'network': return 'Sem conexão com a rede';
            default: return 'Falha na captura';
        }
    }

    function handleVoiceCommand(cmd) {
        console.log('Voice Command:', cmd);
        
        if (cmd.includes('turma') || cmd.includes('alunos')) {
            window.location.href = 'selecionar.html';
        } else if (cmd.includes('perfil')) {
            window.location.href = 'perfil.html';
        } else if (cmd.includes('freq') || cmd.includes('chamada')) {
            window.location.href = 'frequencia-professores.html';
        } else if (cmd.includes('horário') || cmd.includes('aula')) {
            const sidebarHorario = document.getElementById('sidebar-horario');
            if (sidebarHorario && sidebarHorario.style.display !== 'none') {
                window.location.href = sidebarHorario.getAttribute('href');
            } else {
                window.location.href = 'meu-horario.html';
            }
        } else if (cmd.includes('dado') || cmd.includes('lgpd')) {
            window.location.href = 'meus-dados.html';
        } else if (cmd.includes('notificação') || cmd.includes('aviso')) {
            if (window.location.pathname.includes('direcao')) {
                window.location.href = 'direcao-notificacoes.html';
            }
        } else if (cmd.includes('sair')) {
            if (typeof window.sair === 'function') window.sair();
        }
    }
}

/**
 * Handle Clicks on data-action and data-href
 */
document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action], [data-href]');
    if (!target) return;

    const action = target.getAttribute('data-action');
    const href = target.getAttribute('data-href');

    if (action === 'sair') {
        if (typeof window.sair === 'function') window.sair();
        else if (window.auth) window.auth.logout();
    } else if (action === 'irParaTurmas') {
        window.location.href = 'selecionar.html';
    } else if (action === 'verPerfil') {
        window.location.href = 'perfil.html';
    } else if (href) {
        window.location.href = href;
    }
});

/**
 * Voice Toggles and Activation
 * Gerencia: preferência de voz (female/male/off), provedor TTS (gemini/elevenlabs/auto),
 * velocidade, modo de exibição e acessibilidade.
 */
function initVoiceToggles() {
    const btnSettings  = document.getElementById('btn-voice-settings');
    const panel        = document.getElementById('voice-settings-panel');
    const btnActivate  = document.getElementById('btn-activate-voice');
    const optBtns      = document.querySelectorAll('.voice-opt-btn');
    const speedSelect  = document.getElementById('voice-speed-select');
    const modeSelect   = document.getElementById('voice-mode-select');
    // Seletor de provedor TTS (gemini / elevenlabs / auto)
    const providerSelect = document.getElementById('voice-provider-select');

    // ── Painel de configurações ──────────────────────────────────────────────
    if (btnSettings && panel) {
        btnSettings.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
        });
        document.addEventListener('click', () => {
            if (panel) panel.style.display = 'none';
        });
        panel.addEventListener('click', (e) => e.stopPropagation());
    }

    // ── Destaca botão de voz ativo ───────────────────────────────────────────
    const updateVoiceUI = () => {
        const current = localStorage.getItem('user_voice_preference') || 'female';
        optBtns.forEach(btn => {
            if (btn.getAttribute('data-voice') === current) {
                btn.style.borderColor = '#10b981';
                btn.style.background  = 'rgba(16, 185, 129, 0.1)';
            } else {
                btn.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                btn.style.background  = 'rgba(255, 255, 255, 0.04)';
            }
        });
    };

    // ── Destaca provedor ativo ───────────────────────────────────────────────
    const updateProviderUI = () => {
        const currentProvider = localStorage.getItem('user_tts_provider') || 'auto';
        if (providerSelect) providerSelect.value = currentProvider;

        // Botões opcionais data-provider="gemini|elevenlabs|auto"
        document.querySelectorAll('.voice-provider-btn').forEach(btn => {
            const active = btn.getAttribute('data-provider') === currentProvider;
            btn.style.borderColor = active ? '#6366f1' : 'rgba(255,255,255,0.08)';
            btn.style.background  = active ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)';
        });
    };

    // ── Clique nos botões de voz (female / male / off) ───────────────────────
    optBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const voice = btn.getAttribute('data-voice');
            localStorage.setItem('user_voice_preference', voice);
            updateVoiceUI();

            if (voice !== 'off') {
                const msg = voice === 'male' ? 'Voz masculina selecionada.' : 'Voz feminina selecionada.';
                window.speak(msg);
            }

            if (typeof window.showToast === 'function') {
                window.showToast(`Voz ${voice === 'off' ? 'desativada' : (voice === 'male' ? 'masculina' : 'feminina')} selecionada!`, 'success');
            }

            saveAccessibilityPreference({ voiceGender: voice });
            window.dispatchEvent(new CustomEvent('voicePreferenceChanged', { detail: voice }));
        });
    });

    // ── Clique nos botões de provedor (se existirem no HTML) ─────────────────
    document.querySelectorAll('.voice-provider-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prov = btn.getAttribute('data-provider');
            localStorage.setItem('user_tts_provider', prov);
            updateProviderUI();
            saveAccessibilityPreference({ ttsProvider: prov });

            const labels = { gemini: 'Google Gemini', elevenlabs: 'ElevenLabs', auto: 'automático' };
            if (window.showToast) window.showToast(`Provedor de voz: ${labels[prov] || prov}`, 'success');
        });
    });

    // ── Select de provedor (se existir no HTML) ──────────────────────────────
    if (providerSelect) {
        providerSelect.addEventListener('change', () => {
            const prov = providerSelect.value;
            localStorage.setItem('user_tts_provider', prov);
            updateProviderUI();
            saveAccessibilityPreference({ ttsProvider: prov });
        });
    }

    // ── Velocidade ───────────────────────────────────────────────────────────
    if (speedSelect) {
        speedSelect.addEventListener('change', () => {
            const speed = parseFloat(speedSelect.value);
            saveAccessibilityPreference({ voiceSpeed: speed });
            if (window.speak) window.speak(`Velocidade ajustada para ${speed}x`);
            if (window.showToast) window.showToast(`Velocidade ajustada para ${speed}x`, 'success');
        });
    }

    // ── Modo de exibição (texto / texto+audio / audio) ───────────────────────
    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            const mode = modeSelect.value;
            saveAccessibilityPreference({ preferenciaNarracao: mode });
            applyDisplayModeClass(mode);
            if (window.showToast) window.showToast('Preferência de exibição salva!', 'success');
        });
    }

    // ── Acessibilidade: tamanho de fonte ─────────────────────────────────────
    document.getElementById('btn-font-increase')?.addEventListener('click', () => {
        let currentSize = parseInt(getComputedStyle(document.documentElement).fontSize);
        if (currentSize < 24) {
            const newSize = (currentSize + 2) + 'px';
            document.documentElement.style.fontSize = newSize;
            saveAccessibilityPreference({ accessibilityFontSize: newSize });
        }
    });

    document.getElementById('btn-font-decrease')?.addEventListener('click', () => {
        let currentSize = parseInt(getComputedStyle(document.documentElement).fontSize);
        if (currentSize > 12) {
            const newSize = (currentSize - 2) + 'px';
            document.documentElement.style.fontSize = newSize;
            saveAccessibilityPreference({ accessibilityFontSize: newSize });
        }
    });

    // ── Modo leitura ─────────────────────────────────────────────────────────
    const readingBtn = document.getElementById('btn-toggle-reading');
    readingBtn?.addEventListener('click', () => {
        const active = document.body.classList.toggle('reading-mode');
        readingBtn.classList.toggle('active', active);
        saveAccessibilityPreference({ accessibilityReadingMode: active });
    });

    // ── Reset de acessibilidade ──────────────────────────────────────────────
    document.getElementById('btn-reset-accessibility')?.addEventListener('click', () => {
        document.documentElement.style.fontSize = '100%';
        document.body.classList.remove('reading-mode');
        readingBtn?.classList.remove('active');
        localStorage.setItem('user_tts_provider', 'auto');

        saveAccessibilityPreference({
            accessibilityFontSize:    '100%',
            accessibilityReadingMode: false,
            voiceSpeed:               1.0,
            preferenciaNarracao:      'texto_audio',
            ttsProvider:              'auto'
        });

        updateProviderUI();
        if (window.showToast) window.showToast('Configurações resetadas!', 'info');
    });

    // ── Botão ativar voz ─────────────────────────────────────────────────────
    if (btnActivate) {
        btnActivate.addEventListener('click', () => {
            saveAccessibilityPreference({ preferenciaNarracao: 'texto_audio', voiceSpeed: 1.0 });
            updateVoiceUI();
            window.speak('Voz ativada no sistema escolar.');
            if (window.showToast) window.showToast('Voz ativada! Escolha o perfil agora.', 'success');
        });
    }

    // ── Inicialização ─────────────────────────────────────────────────────────
    updateVoiceUI();
    updateProviderUI();
}

/**
 * Persiste preferências de voz e acessibilidade no MongoDB Atlas via User Profile API.
 * Apenas os campos presentes em `prefs` são atualizados (PATCH parcial).
 */
async function saveAccessibilityPreference(prefs) {
    try {
        const res = await fetch(`${window.API_BASE_URL}/auth/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(prefs)
        });

        if (!res.ok) {
            console.warn('[Prefs] Falha ao salvar preferências — HTTP', res.status);
            return;
        }

        const json = await res.json();
        if (json.success && window.auth) {
            const user = window.auth.getCurrentUser();
            if (user) {
                Object.assign(user, prefs);
                // Atualiza as duas chaves de storage para garantir consistência
                try { localStorage.setItem('user_session', JSON.stringify(user)); } catch (_) {}
                try { sessionStorage.setItem('currentUser', JSON.stringify(user)); } catch (_) {}
            }
        }
    } catch (err) {
        console.warn('⚠️ [DB] Erro ao persistir acessibilidade no Atlas:', err);
    }
}

function applyDisplayModeClass(mode) {
    document.body.classList.remove('preference-texto', 'preference-texto-audio', 'preference-audio');
    if (mode === 'texto') {
        document.body.classList.add('preference-texto');
    } else if (mode === 'audio') {
        document.body.classList.add('preference-audio');
    } else {
        document.body.classList.add('preference-texto-audio');
    }
}

function getCsrfToken() {
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}
