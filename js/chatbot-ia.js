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

    // Fonte única em js/auth.js. Este mapa chamava o ADMIN de "Diretor(a)" —
    // divergia dos outros três e reforçava a impressão de perfil trocado.
    const getRoleName = (perfil) => {
        if (!window.rotuloPerfilAtivo) return '—';
        return window.rotuloPerfilAtivo({ perfil }, window.escolaAtivaId && window.escolaAtivaId());
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
                    <label for="voice-select">Voz:</label>
                    <!-- As opções são preenchidas por window.Vozes logo após a
                         montagem. Ficavam escritas aqui como uma única opção
                         morta, "Masculina (Standard)", que nem sequer era um
                         nome de voz que o backend reconhecesse. -->
                    <select id="voice-select"></select>
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
                <!-- O campo mora dentro de um contentor posicionado: a lista de
                     sugestões de aluno é ancorada nele e sobe por cima do chat. -->
                <div class="chatbot-input-field">
                    <input type="text" id="chat-input-ia" placeholder="Pergunte algo..." required
                           autocomplete="off" role="combobox" aria-expanded="false"
                           aria-controls="chatbot-sugestoes" aria-autocomplete="list">
                    <div class="chatbot-sugestoes" id="chatbot-sugestoes" role="listbox"
                         aria-label="Alunos encontrados" hidden></div>
                </div>
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

        // Responsável: chips voltados ao(s) filho(s) — o clique envia o rótulo
        // como pergunta, e o backend resolve/oferece a escolha do filho.
        if (perfil === 'responsavel') {
            return [
                { label: '📝 Notas do meu filho', value: '' },
                { label: '📅 Faltas do meu filho', value: '' },
                { label: '📊 Resumo do desempenho', value: '' },
                { label: '📢 Comunicados recentes', value: '' },
                { label: '🕐 Grade horária', value: '' },
            ];
        }

        const base = [
            { label: '📝 Notas e desempenho', value: '' },
            { label: '📅 Faltas e frequência', value: '' },
            { label: '📢 Comunicados recentes', value: '' },
            { label: '🕐 Grade horária', value: '' },
            { label: '👨‍🏫 Professores da turma', value: '' },
        ];
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
                    // Ordem invertida de propósito: `destroy()` agora faz o orb
                    // SAIR (220ms de opacidade). Esconder o palco antes cortava
                    // essa saída no primeiro quadro — o orb sumia de um golpe e
                    // a transição existia só no código.
                    window.VoiceOrbManager.destroy();
                    setTimeout(() => { orbContainer.style.display = 'none'; }, 240);
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

        const user = getCurrentUser();
        let escolaSelecionada = user?.escolaId || null;
        let escolaNome = user?.escolaNome || null;
        if (!escolaSelecionada) {
            try {
                const salva = JSON.parse(localStorage.getItem('escolaSelecionada'));
                if (salva) { escolaSelecionada = salva.id; escolaNome = salva.nome; }
            } catch(e) {}
        }
        let turmaSelecionada = null;
        try { turmaSelecionada = sessionStorage.getItem('turmaAtiva') || sessionStorage.getItem('turmaSelecionada'); } catch(e){}
        const userContext = { escolaId: escolaSelecionada, escolaNome: escolaNome, turmaId: turmaSelecionada, perfil: user?.perfil || null };

        addMessage(text, false);
        input.value = '';
        input.disabled = true;
        document.getElementById('chat-submit-btn').disabled = true;
        statusEl.textContent = 'Consultando...';
        addTypingIndicator();

        if (window.VoiceOrbManager && orbContainer) {
            orbContainer.style.display = 'block';
            window.VoiceOrbManager.ensureMounted(orbContainer, { mode: 'chat' });
            window.VoiceOrbManager.setState('thinking');
        }

        try {
            const res = await fetch(CONFIG.apiBase, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ message: text, alunoId: contextAlunoId, userContext: userContext }),
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


    // --- Seletor de voz ---
    //
    // O que havia aqui gravava a escolha em `user_voice_preference`. Essa
    // chave guarda GÊNERO ('male'), e não é a que `window.speak()` envia como
    // voiceId — ele lê `user_elevenlabs_voice`. Ou seja: mesmo que o seletor
    // tivesse mais de uma opção, trocar de voz não mudava voz nenhuma. O
    // catálogo cuida das duas chaves e da gravação no servidor.
    const voiceSelect = document.getElementById('voice-select');
    if (voiceSelect && window.Vozes) {
        window.Vozes.preencherSelect(voiceSelect);
        audioSettings.voice = window.Vozes.atual();

        voiceSelect.onchange = (e) => {
            // Com prévia: escolher voz sem ouvi-la é escolher no escuro. São
            // três palavras, e só toca quando a pessoa mexeu no seletor.
            audioSettings.voice = window.Vozes.definir(e.target.value, { previa: true });
        };
    } else if (voiceSelect) {
        // Página com o chatbot mas sem js/sidebar-voice.js: não há window.speak,
        // então não há narração para configurar. Esconder é mais honesto que
        // mostrar um seletor que não faz nada.
        voiceSelect.closest('.setting-item')?.remove();
    }
    document.getElementById('speed-range').oninput = (e) => {
        const s = e.target.value;
        audioSettings.speed = s;
        localStorage.setItem('user_voice_speed', s);
    };

    // A voz pode ser trocada na gaveta de configurações ou na barra lateral,
    // com o chat aberto ao lado. `voiceChanged` é o evento que essas duas telas
    // disparam; o `voicePreferenceChanged` que era ouvido aqui carregava gênero,
    // não nome de voz, e por isso zerava o seletor para um valor inexistente.
    window.addEventListener('voiceChanged', (e) => {
        const v = e.detail && e.detail.voice;
        if (!v) return;
        audioSettings.voice = v;
        const sel = document.getElementById('voice-select');
        if (sel && sel.value !== v) sel.value = v;
    });

    // ─── AUTOCOMPLETE DE ALUNO ────────────────────────────────────────────
    //
    // Enquanto a pessoa digita, o campo sugere alunos REAIS do banco, no mesmo
    // formato do autocomplete de um buscador: quem começa com o texto primeiro,
    // depois quem apenas o contém, no máximo 10, sem repetição.
    //
    // A filtragem é feita pelo servidor (`GET /api/ia/chatbot/alunos`), e não
    // aqui. Baixar a lista de alunos para filtrar no navegador não escala numa
    // escola com milhares de matrículas — e entregaria ao cliente justamente a
    // lista que o RBAC existe para recortar. O servidor devolve no máximo 10
    // nomes, já dentro do que este usuário pode consultar.
    //
    // O que o servidor devolve em `termo` é o TRECHO que casou: numa frase como
    // "notas do joão", `termo` é "joão". É esse pedaço que fica em negrito na
    // lista e é ele — não a frase inteira — que é substituído pelo nome completo
    // quando a pessoa escolhe um aluno.

    const SUGESTOES = {
        url: (window.API_BASE_URL || '/api') + '/ia/chatbot/alunos',
        // 300 ms: tempo suficiente para uma pessoa digitar a próxima letra sem
        // gerar uma requisição por tecla, e curto o bastante para a lista
        // parecer instantânea.
        atraso: 300,
        minimo: 1,
        maximo: 10,
    };

    const caixaSugestoes = document.getElementById('chatbot-sugestoes');

    let sugestoes = [];
    let sugestaoAtiva = -1;
    let termoDestacado = '';
    let temporizadorSugestoes = null;
    let requisicaoSugestoes = null;
    let sequenciaSugestoes = 0;
    let textoConsultado = null;

    const escaparHtml = (texto) => String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    /**
     * Versão sem acento e em minúsculas do texto, junto com o mapa de volta
     * para as posições do texto ORIGINAL.
     *
     * O mapa é o que permite comparar "joao" com "João" e ainda assim destacar
     * (e substituir) os caracteres certos no que a pessoa realmente digitou —
     * remover acentos muda o tamanho da string, então índices calculados na
     * versão normalizada não servem na original.
     */
    function mapearSemAcento(texto) {
        let normalizado = '';
        const posicoes = [];
        for (let i = 0; i < texto.length; i++) {
            const convertido = texto[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
            for (let k = 0; k < convertido.length; k++) {
                normalizado += convertido[k];
                posicoes.push(i);
            }
        }
        return { normalizado, posicoes };
    }

    /** Onde `termo` aparece em `texto`, ignorando acento e caixa. */
    function localizarTrecho(texto, termo) {
        if (!texto || !termo) return null;
        const alvo = mapearSemAcento(texto);
        const procurado = mapearSemAcento(termo).normalizado.trim();
        if (!procurado) return null;
        const inicio = alvo.normalizado.indexOf(procurado);
        if (inicio < 0) return null;
        return {
            inicio: alvo.posicoes[inicio],
            fim: alvo.posicoes[inicio + procurado.length - 1] + 1,
        };
    }

    /** Nome do aluno com o trecho digitado em negrito. */
    function destacarTrecho(nome, termo) {
        const faixa = localizarTrecho(nome, termo);
        if (!faixa) return escaparHtml(nome);
        return escaparHtml(nome.slice(0, faixa.inicio))
            + '<strong>' + escaparHtml(nome.slice(faixa.inicio, faixa.fim)) + '</strong>'
            + escaparHtml(nome.slice(faixa.fim));
    }

    function fecharSugestoes() {
        sugestoes = [];
        sugestaoAtiva = -1;
        caixaSugestoes.hidden = true;
        caixaSugestoes.innerHTML = '';
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    }

    function marcarAtiva(indice) {
        sugestaoAtiva = indice;
        const itens = caixaSugestoes.querySelectorAll('.chatbot-sugestao');
        itens.forEach((item, i) => {
            const ativo = i === indice;
            item.classList.toggle('ativa', ativo);
            item.setAttribute('aria-selected', ativo ? 'true' : 'false');
            if (ativo) item.scrollIntoView({ block: 'nearest' });
        });
        if (indice >= 0 && itens[indice]) {
            input.setAttribute('aria-activedescendant', itens[indice].id);
        } else {
            input.removeAttribute('aria-activedescendant');
        }
    }

    function renderizarSugestoes(lista, termo, vazioVisivel) {
        sugestoes = lista;
        termoDestacado = termo;
        sugestaoAtiva = -1;

        if (!lista.length) {
            if (!vazioVisivel) return fecharSugestoes();
            caixaSugestoes.innerHTML = '<div class="chatbot-sugestao-vazia">Nenhum aluno encontrado</div>';
            caixaSugestoes.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            input.removeAttribute('aria-activedescendant');
            return;
        }

        caixaSugestoes.innerHTML = lista.map((aluno, i) => {
            const turma = aluno.turma
                ? `<span class="chatbot-sugestao-turma">Turma ${escaparHtml(aluno.turma)}</span>`
                : '';
            return `<div class="chatbot-sugestao" id="chatbot-sugestao-${i}" role="option" aria-selected="false" data-indice="${i}">
                <i class="bi bi-person-circle" aria-hidden="true"></i>
                <span class="chatbot-sugestao-nome">${destacarTrecho(aluno.nome, termo)}</span>
                ${turma}
            </div>`;
        }).join('');
        caixaSugestoes.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    /** Escolher um aluno: o trecho digitado vira o nome completo e a lista fecha. */
    function selecionarSugestao(indice) {
        const aluno = sugestoes[indice];
        if (!aluno) return;

        const texto = input.value;
        const faixa = localizarTrecho(texto, termoDestacado);
        // Sem o trecho localizado (digitação com espaço duplo, por exemplo), o
        // campo recebe o nome inteiro — nunca fica com o texto pela metade.
        input.value = faixa
            ? texto.slice(0, faixa.inicio) + aluno.nome + texto.slice(faixa.fim)
            : aluno.nome;

        textoConsultado = input.value.trim();
        fecharSugestoes();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }

    async function consultarSugestoes(texto) {
        // Uma resposta lenta de uma tecla antiga não pode sobrescrever a lista
        // de uma tecla nova: a requisição anterior é abortada e, ainda assim, o
        // número de sequência descarta qualquer resposta fora de ordem.
        if (requisicaoSugestoes) requisicaoSugestoes.abort();
        const controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
        requisicaoSugestoes = controle;
        const sequencia = ++sequenciaSugestoes;

        try {
            const res = await fetch(
                `${SUGESTOES.url}?q=${encodeURIComponent(texto)}&limite=${SUGESTOES.maximo}`,
                {
                    headers: getHeaders(),
                    credentials: 'include',
                    signal: controle ? controle.signal : undefined,
                }
            );
            if (sequencia !== sequenciaSugestoes) return;
            if (!res.ok) return fecharSugestoes();

            const dados = await res.json();
            if (sequencia !== sequenciaSugestoes) return;

            const lista = (dados?.data?.alunos || []).slice(0, SUGESTOES.maximo);
            renderizarSugestoes(lista, dados?.data?.termo || texto, !!dados?.data?.buscavel);
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            fecharSugestoes();
        }
    }

    function agendarSugestoes() {
        clearTimeout(temporizadorSugestoes);
        const texto = input.value.trim();

        if (texto.length < SUGESTOES.minimo) {
            textoConsultado = null;
            return fecharSugestoes();
        }
        // Mesma consulta da última vez (a pessoa digitou e apagou uma letra, ou
        // acabou de escolher um nome): a lista na tela já está correta.
        if (texto === textoConsultado) return;

        temporizadorSugestoes = setTimeout(() => {
            textoConsultado = texto;
            consultarSugestoes(texto);
        }, SUGESTOES.atraso);
    }

    input.addEventListener('input', agendarSugestoes);

    input.addEventListener('keydown', (e) => {
        const aberta = !caixaSugestoes.hidden && sugestoes.length > 0;

        if (e.key === 'Escape') {
            clearTimeout(temporizadorSugestoes);
            fecharSugestoes();
            return;
        }
        if (!aberta) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            marcarAtiva((sugestaoAtiva + 1) % sugestoes.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            marcarAtiva((sugestaoAtiva - 1 + sugestoes.length) % sugestoes.length);
        } else if ((e.key === 'Enter' || e.key === 'Tab') && sugestaoAtiva >= 0) {
            // Só intercepta quando há um item ESCOLHIDO com as setas. Sem isso,
            // quem digitou a pergunta inteira e apertou Enter teria a mensagem
            // trocada por um nome que nunca selecionou.
            e.preventDefault();
            selecionarSugestao(sugestaoAtiva);
        }
    });

    // `mousedown` com preventDefault: o clique escolhe o aluno sem tirar o foco
    // do campo, então a lista não fecha por blur antes de o clique ser tratado.
    caixaSugestoes.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.chatbot-sugestao');
        if (!item) return;
        e.preventDefault();
        selecionarSugestao(Number(item.dataset.indice));
    });

    caixaSugestoes.addEventListener('mousemove', (e) => {
        const item = e.target.closest('.chatbot-sugestao');
        if (item) marcarAtiva(Number(item.dataset.indice));
    });

    input.addEventListener('blur', () => {
        // Atraso curto: cobre o caso em que o foco sai por um caminho que não
        // passa pelo mousedown acima (toque, leitor de tela).
        setTimeout(fecharSugestoes, 120);
    });

    form.addEventListener('submit', () => {
        clearTimeout(temporizadorSugestoes);
        textoConsultado = null;
        fecharSugestoes();
    });

    async function selectOption(label, value) {
        // Sem value = chip de tema (não é botão de aluno): a pergunta é o rótulo
        const isChipDeTema = !value;
        if (!isChipDeTema) contextAlunoId = value;
        const lastUserMsg = isChipDeTema
            ? label
            : (messages.filter(m => !m.isAi).slice(-1)[0]?.text || label);

        const user = getCurrentUser();
        let escolaSelecionada = user?.escolaId || null;
        let escolaNome = user?.escolaNome || null;
        if (!escolaSelecionada) {
            try {
                const salva = JSON.parse(localStorage.getItem('escolaSelecionada'));
                if (salva) { escolaSelecionada = salva.id; escolaNome = salva.nome; }
            } catch(e) {}
        }
        let turmaSelecionada = null;
        try { turmaSelecionada = sessionStorage.getItem('turmaAtiva') || sessionStorage.getItem('turmaSelecionada'); } catch(e){}
        const userContext = { escolaId: escolaSelecionada, escolaNome: escolaNome, turmaId: turmaSelecionada, perfil: user?.perfil || null };

        addMessage(label, false, null);
        input.disabled = true;
        document.getElementById('chat-submit-btn').disabled = true;
        statusEl.textContent = 'Consultando...';
        addTypingIndicator();
        try {
            const res = await fetch(CONFIG.apiBase, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ message: lastUserMsg, alunoId: isChipDeTema ? (contextAlunoId || null) : value, userContext: userContext }),
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
