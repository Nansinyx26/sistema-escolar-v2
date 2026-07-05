/**
 * chatbot-ia.js
 * Assistente Escolar Inteligente v4.0
 * Conectado ao banco de dados via API segura.
 * Features: Auth CSRF, Contexto conversacional, Avatar real, TTS, RGB Visualizer.
 */

(function() {
    'use strict';

    const CONFIG = {
        apiBase: (window.API_BASE_URL || '/api') + '/ia/chatbot',
        ttsBase: (window.API_BASE_URL || '/api') + '/tts',
        stylesUrl: '/css/chatbot-ia.css'
    };

    let isOpen = false;
    let messages = [];
    let contextAlunoId = null; // Contexto conversacional: aluno ativo
    // Forçar configurações fixas conforme solicitado
    localStorage.setItem('user_tts_provider', 'elevenlabs');
    localStorage.setItem('user_voice_preference', 'male');

    let audioSettings = { 
        voice: 'male', 
        speed: parseFloat(localStorage.getItem('user_voice_speed') || '1.0'), 
        provider: 'elevenlabs', 
        autoPlay: localStorage.getItem('user_preferencia_narracao') !== 'texto'
    };

    const connectedAudioElements = new WeakSet();

    let currentAudio = null;
    let audioContext = null;
    let analyser = null;
    let dataArray = null;
    let playingMsgIndex = null;
    let animationId = null;

    // --- HELPERS ---
    const getCsrfToken = () => {
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    };

    const getHeaders = () => {
        const headers = { 'Content-Type': 'application/json' };
        const csrfToken = getCsrfToken() || document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }
        return headers;
    };

    const getCurrentUser = () => {
        if (window.auth && window.auth.getCurrentUser) {
            return window.auth.getCurrentUser();
        }
        try {
            return JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        } catch { return {}; }
    };

    const getUserPhoto = (user) => {
        const foto = user?.foto || user?.fotoGoogle || '';
        if (foto && window.getPhotoUrl) return window.getPhotoUrl(foto);
        if (foto) return foto;
        return '';
    };

    const getInitials = (name) => {
        if (!name) return '?';
        const parts = name.trim().split(' ');
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    };

    const getRoleName = (perfil) => {
        if (!perfil) return 'Usuário';
        if (perfil === 'diretor' || perfil === 'admin') return 'Diretor(a)';
        if (perfil === 'professor') return 'Professor(a)';
        if (perfil === 'responsavel') return 'Responsável';
        if (perfil === 'secretaria') return 'Secretária';
        if (perfil === 'coordenador') return 'Coordenador(a)';
        return perfil;
    };

    // Initialize Web Audio API
    const initAudioContext = () => {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            const bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    };

    // Visualizador RGB removido conforme solicitação do usuário.

    // Load CSS
    if (!document.getElementById('chatbot-ia-style')) {
        const link = document.createElement('link');
        link.id = 'chatbot-ia-style';
        link.rel = 'stylesheet';
        link.href = CONFIG.stylesUrl;
        document.head.appendChild(link);
    }

    // Modal UI Structure
    const container = document.createElement('div');
    container.className = 'chatbot-container';
    container.innerHTML = `
        <button class="chatbot-fab" id="chatbot-fab" title="Assistente Escolar IA">
            <i class="bi bi-robot"></i>
        </button>
        <div class="chatbot-window" id="chatbot-window" style="display:none;">
            <div class="chatbot-header">
                <div class="chatbot-header-info">
                    <div class="chatbot-header-avatar" id="chatbot-header-avatar">
                        <i class="bi bi-robot"></i>
                    </div>
                    <div>
                        <h3>Assistente Escolar</h3>
                        <span class="chatbot-header-status" id="chatbot-status">Conectado</span>
                    </div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="chatbot-icon-btn" id="chatbot-clear" title="Limpar conversa"><i class="bi bi-trash3"></i></button>
                    <button class="chatbot-icon-btn" id="show-settings" title="Configurações"><i class="bi bi-gear"></i></button>
                    <button class="chatbot-icon-btn" id="close-chatbot" title="Fechar"><i class="bi bi-x-lg"></i></button>
                </div>
            </div>
            <div class="audio-settings-panel" id="settings-panel" style="display:none;">
                <!-- Seleção de Provedor Removida conforme solicitado -->
                <div class="setting-item">
                    <label>Voz:</label>
                    <select id="voice-select">
                        <option value="male">Masculina (Standard)</option>
                    </select>
                </div>
                <div class="setting-item">
                    <label>Velocidade:</label>
                    <input type="range" id="speed-range" min="0.5" max="2" step="0.1" value="1">
                </div>
            </div>
            <div class="chatbot-body" id="chat-body"></div>
            
            <!-- VoiceOrb Container (Modo 1) -->
            <div id="chatbot-voice-orb-container" style="display:none; padding: 1rem; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(255,255,255,0.05);"></div>


            <form class="chatbot-input" id="chat-form">
                <input type="text" id="chat-input-ia" placeholder="Pergunte algo..." required autocomplete="off">
                <button type="submit" id="chat-submit-btn" style="background: none; border: none; color: #60a5fa; cursor: pointer;"><i class="bi bi-send-fill"></i></button>
            </form>

        </div>
    `;
    document.body.appendChild(container);

    const fab = document.getElementById('chatbot-fab');
    const win = document.getElementById('chatbot-window');
    const body = document.getElementById('chat-body');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input-ia');
    const setPanel = document.getElementById('settings-panel');
    const statusEl = document.getElementById('chatbot-status');
    const orbContainer = document.getElementById('chatbot-voice-orb-container');

    // --- OPEN / CLOSE ---
    function openChat() {
        isOpen = true;
        win.style.display = 'flex';
        win.classList.add('open');
        fab.style.display = 'none';
        input.focus();

        if (messages.length === 0) {
            const user = getCurrentUser();
            const nome = user?.nome ? user.nome.split(' ')[0] : '';
            const perfil = getRoleName(user?.perfil);
            
            if (nome) {
                addMessage(`Olá, **${nome}**! Você está na conta **${perfil}**. Posso consultar informações do sistema escolar para você. Escolha um tema ou pergunte direto:`, true, getInitialSuggestions());
            } else {
                addMessage("Olá! Sou o Assistente Escolar IA. Escolha um tema ou pergunte direto:", true, getInitialSuggestions());
            }
        }
    }

    function closeChat() {
        isOpen = false;
        win.classList.remove('open');
        win.style.display = 'none';
        fab.style.display = 'flex';
    }

    function clearChat() {
        messages = [];
        contextAlunoId = null;
        body.innerHTML = '';
        addMessage("Conversa limpa. Escolha um tema ou pergunte direto:", true, getInitialSuggestions());
    }

    // Chips de sugestão iniciais, adequados ao perfil logado
    // (mesmos rótulos das sugestões do backend — o clique envia o rótulo como pergunta)
    function getInitialSuggestions() {
        const user = getCurrentUser();
        const perfil = (user?.perfil || '').toLowerCase();
        const base = [
            { label: '📝 Notas e desempenho', value: '' },
            { label: '📅 Faltas e frequência', value: '' },
            { label: '📢 Comunicados recentes', value: '' },
            { label: '🕐 Grade horária', value: '' },
        ];
        if (perfil === 'responsavel') return base;
        base.push({ label: '👨‍🏫 Professores da turma', value: '' });
        if (['diretor', 'admin', 'coordenador', 'secretaria'].includes(perfil)) {
            base.push({ label: '🏫 Resumo da escola', value: '' });
        }
        return base;
    }

    // Prevent clicks from propagating (safe to register immediately — no function calls)
    win.addEventListener('click', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    win.addEventListener('mousedown', (e) => e.stopPropagation());
    win.addEventListener('pointerdown', (e) => e.stopPropagation());
    fab.addEventListener('mousedown', (e) => e.stopPropagation());
    fab.addEventListener('pointerdown', (e) => e.stopPropagation());

    // --- MESSAGE RENDERING ---
    function formatBold(text) {
        return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    }

    function addMessage(text, isAi, options) {
        const index = messages.length;
        messages.push({ text, isAi });
        const div = document.createElement('div');
        div.className = `msg ${isAi ? 'msg-ai' : 'msg-user'}`;

        const user = getCurrentUser();
        let avatarHtml = '';
        
        if (isAi) {
            avatarHtml = '<div class="chat-avatar-bot"><i class="bi bi-robot"></i></div>';
        } else {
            const foto = getUserPhoto(user);
            const initials = getInitials(user?.nome);
            avatarHtml = foto 
                ? `<img src="${foto}" class="chat-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"><div class="chat-avatar-initials" style="display:none">${initials}</div>`
                : `<div class="chat-avatar-initials">${initials}</div>`;
        }

        const formattedText = formatBold(text);
        
        let html = `
            <div class="msg-content-wrapper">
                ${isAi ? avatarHtml : ''}
                <div class="msg-text-bubble">
                    <div>${formattedText}</div>
        `;

        if (isAi) {
            html += `
                    <div class="audio-controls">
                        <button class="audio-btn" onclick="window.chatbotIA.playAudio(${index})" title="Ouvir resposta">
                            <i class="bi bi-volume-up-fill" id="play-icon-${index}"></i>
                        </button>
                        <button class="audio-btn" onclick="window.chatbotIA.stopAudio()" title="Parar">
                            <i class="bi bi-stop-fill"></i>
                        </button>
                    </div>
            `;

            // Botões de opção (alunos ambíguos)
            if (options && options.length > 0) {
                html += `<div class="chatbot-options" style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">`;
                options.forEach((opt, oi) => {
                    const safeLabel = opt.label.replace(/'/g, "\\'");
                    const safeValue = (opt.value || opt.alunoId || '').replace(/'/g, "\\'");
                    html += `<button
                        class="chatbot-option-btn"
                        onclick="window.chatbotIA.selectOption('${safeLabel}','${safeValue}')"
                        style="padding:8px 14px;border-radius:10px;font-size:0.82rem;font-weight:600;cursor:pointer;background:rgba(16,185,129,0.12);color:#10b981;border:1px solid rgba(16,185,129,0.35);text-align:left;transition:all 0.15s;"
                        onmouseover="this.style.background='rgba(16,185,129,0.25)'"
                        onmouseout="this.style.background='rgba(16,185,129,0.12)'"
                    >${opt.label}</button>`;
                });
                html += `</div>`;
            }
        }
        
        html += `
                </div>
                ${!isAi ? avatarHtml : ''}
            </div>
        `;
        
        div.innerHTML = html;
        body.appendChild(div);
        body.scrollTop = body.scrollHeight;

        if (isAi && audioSettings.autoPlay) {
            playAudio(index);
        }
    }

    function addTypingIndicator() {
        const div = document.createElement('div');
        div.className = 'msg msg-ai msg-typing';
        div.id = 'typing-indicator';
        div.innerHTML = `
            <div class="msg-content-wrapper">
                <div class="chat-avatar-bot"><i class="bi bi-robot"></i></div>
                <div class="msg-text-bubble">
                    <div class="typing-dots">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            </div>
        `;
        body.appendChild(div);
        body.scrollTop = body.scrollHeight;
    }

    function removeTypingIndicator() {
        const el = document.getElementById('typing-indicator');
        if (el) el.remove();
    }

    // --- AUDIO ---
    // --- AUDIO ---
    async function playAudio(index) {
        stopAudio();
        initAudioContext();
        
        const msg = messages[index];
        const icon = document.getElementById(`play-icon-${index}`);
        if(icon) icon.className = 'bi bi-arrow-repeat bi-spin'; 

        try {
            // Usa window.speak (que agora aponta para /api/tts/speak e usa ElevenLabs)
            const audio = await window.speak(msg.text.replace(/\*\*/g, ''));
            
            if (!audio) {
                if (icon) icon.className = 'bi bi-volume-up-fill';
                return;
            }

            currentAudio = audio;
            playingMsgIndex = index;
            if(icon) icon.className = 'bi bi-pause-fill';

            if (window.VoiceOrbManager && orbContainer) {
                orbContainer.style.display = 'block';
                // ensureMounted reusa o orbe existente — recriar o DOM aqui
                // reiniciava todas as animações CSS a cada play
                window.VoiceOrbManager.ensureMounted(orbContainer, { mode: 'chat' });
                window.VoiceOrbManager.setState('speaking');
            }

            audio.addEventListener('ended', () => cleanupAudio(index));
        } catch (e) {
            console.warn('[TTS] Erro:', e.message);
            if (icon) icon.className = 'bi bi-volume-up-fill';
        }
    }

    function cleanupAudio(index) {
        if (animationId) cancelAnimationFrame(animationId);
        const icon = document.getElementById(`play-icon-${index}`);
        if(icon) icon.className = 'bi bi-volume-up-fill';
        playingMsgIndex = null;
        if (window.VoiceOrbManager) {
            window.VoiceOrbManager.setState('idle');
            setTimeout(() => {
                if (window.VoiceOrbManager && window.VoiceOrbManager.state === 'idle' && orbContainer) {
                    orbContainer.style.display = 'none';
                    window.VoiceOrbManager.destroy();
                }
            }, 3000);
        }
    }

    function stopAudio() {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    }

    // --- SPEECH RECOGNITION REMOVIDO POR SEGURANÇA ---
    function initSpeechRecognition() {
        console.log('[Chatbot] Reconhecimento de voz nativo removido por política de segurança.');
    }

    // --- EVENT LISTENERS ---
    fab.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openChat(); });
    document.getElementById('close-chatbot')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeChat(); });
    document.getElementById('chatbot-clear').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); clearChat(); });

    document.getElementById('show-settings').addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpenPanel = setPanel.classList.toggle('open');
        setPanel.style.display = isOpenPanel ? 'block' : 'none';
    });

    // Ocultar botão de microfone se não houver backend STT
    const micBtn = document.getElementById('chat-mic-ia');
    if (micBtn) micBtn.style.display = 'none';

    form.onsubmit = async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;

        addMessage(text, false);
        input.value = '';
        input.disabled = true;
        document.getElementById('chat-submit-btn').disabled = true;
        statusEl.textContent = 'Consultando...';
        addTypingIndicator();

        if (window.VoiceOrbManager && orbContainer) {
            orbContainer.style.display = 'block';
            // ensureMounted reusa o orbe existente (sem reiniciar animações)
            window.VoiceOrbManager.ensureMounted(orbContainer, { mode: 'chat' });
            window.VoiceOrbManager.setState('thinking');
        }

        try {
            const res = await fetch(CONFIG.apiBase, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ message: text, alunoId: contextAlunoId }),
                credentials: 'include'
            });
            
            let responseText = "";
            let responseOptions = null;
            if (res.ok) {
                const data = await res.json();
                responseText = data.data?.response;
                // persiste alunoId resolvido para o próximo turno
                if (data.data?.alunoId) contextAlunoId = data.data.alunoId;
                responseOptions = data.data?.options || null;
            }

            removeTypingIndicator();

            if (responseText) {
                addMessage(responseText, true, responseOptions);
                statusEl.textContent = 'Conectado';
                if (window.VoiceOrbManager) window.VoiceOrbManager.setState('idle');
            } else {
                addMessage("Não consegui processar sua pergunta.", true, null);
                statusEl.textContent = 'Conectado';
                if (window.VoiceOrbManager) window.VoiceOrbManager.setState('error');
            }
        } catch (err) {
            removeTypingIndicator();
            if (window.VoiceOrbManager) window.VoiceOrbManager.setState('error');
            addMessage("Ocorreu um erro de conexão. Verifique sua internet e tente novamente.", true, null);
        } finally {
            input.disabled = false;
            document.getElementById('chat-submit-btn').disabled = false;
            input.focus();
        }
    };


    // Settings listeners removidos ou simplificados
    document.getElementById('voice-select').onchange = (e) => { 
        const v = e.target.value;
        audioSettings.voice = v; 
        localStorage.setItem('user_voice_preference', v); 
        if (window.saveAccessibilityPreference) window.saveAccessibilityPreference({ voicePreference: v });
        window.dispatchEvent(new CustomEvent('voicePreferenceChanged', { detail: v }));
    };
    document.getElementById('speed-range').oninput = (e) => {
        const s = e.target.value;
        audioSettings.speed = s;
        localStorage.setItem('user_voice_speed', s);
    };

    // Listen for global voice changes from sidebar
    window.addEventListener('voicePreferenceChanged', (e) => {
        const v = e.detail;
        audioSettings.voice = v;
        const voiceSelect = document.getElementById('voice-select');
        if (voiceSelect) voiceSelect.value = v;
    });

    // Layer 1, Rule 4: click resolution uses ID (value), never re-searches by name
    async function selectOption(label, value) {
        // Sem value = chip de tema (não é botão de aluno): a pergunta é o rótulo
        const isChipDeTema = !value;
        if (!isChipDeTema) contextAlunoId = value;
        const lastUserMsg = isChipDeTema
            ? label
            : (messages.filter(m => !m.isAi).slice(-1)[0]?.text || label);
        addMessage(label, false, null);
        input.disabled = true;
        document.getElementById('chat-submit-btn').disabled = true;
        statusEl.textContent = 'Consultando...';
        addTypingIndicator();
        try {
            const res = await fetch(CONFIG.apiBase, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ message: lastUserMsg, alunoId: isChipDeTema ? (contextAlunoId || null) : value }),
                credentials: 'include'
            });
            let responseText = '';
            let responseOptions = null;
            if (res.ok) {
                const data = await res.json();
                responseText = data.data?.response;
                if (data.data?.alunoId) contextAlunoId = data.data.alunoId;
                responseOptions = data.data?.options || null;
            }
            removeTypingIndicator();
            addMessage(responseText || 'Não consegui processar sua pergunta.', true, responseOptions);
            statusEl.textContent = 'Conectado';
        } catch {
            removeTypingIndicator();
            addMessage('Erro de conexão.', true, null);
        } finally {
            input.disabled = false;
            document.getElementById('chat-submit-btn').disabled = false;
            input.focus();
        }
    }

    window.chatbotIA = { playAudio, stopAudio, openChat, closeChat, selectOption, isOpen: () => isOpen };
})();
