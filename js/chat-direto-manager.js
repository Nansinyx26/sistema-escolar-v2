/**
 * chat-direto-manager.js
 * Gerenciador de Chat Flutuante Estilo WhatsApp Desktop (Multi-Janelas)
 *
 * Recursos: texto, emojis, anexos (com pré-visualização e compressão de
 * imagem), áudio gravado com prévia antes do envio, reações, responder,
 * editar, apagar, encaminhar, copiar, seleção múltipla, busca por termo/data/
 * anexos, lazy loading do histórico, status online/ausente/offline,
 * "digitando…", "gravando áudio…", confirmação de leitura e notificações —
 * tudo sincronizado por Socket.IO.
 *
 * Endpoints usados (backend/src/routes/api.js):
 *   POST   /chat-direto/enviar
 *   POST   /chat-direto/upload            (anexos e áudios do chat)
 *   GET    /chat-direto/anexo/:id         (download autorizado aos 2 lados)
 *   GET    /chat-direto/historico/:id     (?before,&search,&data,&filter,&limit)
 *   GET    /chat-direto/presenca/:id
 *   PATCH  /chat-direto/lidas/:id         (marca a conversa inteira)
 *   PUT    /chat-direto/mensagem/:id      (editar)
 *   DELETE /chat-direto/mensagem/:id      (?tipo=para_mim|para_todos)
 *   POST   /chat-direto/reagir
 *   POST   /chat-direto/encaminhar
 */
(function () {
    'use strict';

    const API = () => (window.API_BASE_URL || '/api').replace(/\/$/, '');
    const PREF_SOM = 'chatSomAtivo'; // preferência persistida do som
    const PREF_AVISO_LGPD = 'chatAvisoLgpdVisto'; // ciência do aviso de armazenamento
    const MAX_UPLOAD_MB = 10; // espelha LIMITE_ARQUIVO do backend
    const MAX_AUDIO_MB = 5; // espelha LIMITE_AUDIO do backend
    const IMG_MAX_LADO = 1600; // px — teto para compressão de imagem
    const IMG_QUALIDADE = 0.82;
    const COMPRIMIR_ACIMA_DE = 300 * 1024; // só comprime imagem maior que isso

    const REACOES_RAPIDAS = ['👍', '❤️', '😂', '😮', '😢', '👏', '🎉'];

    /* ------------------------------------------------------------------ *
     * Utilitários
     * ------------------------------------------------------------------ */

    /**
     * Sons do chat. A síntese vive em js/som-notificacao.js (contexto de áudio
     * único e compartilhado com o mural). O fallback abaixo mantém o chat
     * sonoro em páginas que ainda não carregam aquele arquivo.
     */
    function playNotificationSound() {
        if (window.SomNotificacao) return window.SomNotificacao.receber();
        if (!somAtivo()) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
        } catch (e) {
            /* áudio desativado */
        }
    }

    /** Confirmação sonora do envio — timbre distinto do som de chegada. */
    function playSendSound() {
        if (window.SomNotificacao) window.SomNotificacao.enviar();
    }

    /** Som configurável: ligado por padrão, alternável pelo ícone do cabeçalho. */
    function somAtivo() {
        try {
            return localStorage.getItem(PREF_SOM) !== '0';
        } catch (e) {
            return true;
        }
    }
    function definirSom(ativo) {
        try {
            localStorage.setItem(PREF_SOM, ativo ? '1' : '0');
        } catch (e) {
            /* storage off */
        }
    }

    /**
     * Formato de gravação suportado pelo navegador.
     *
     * `new MediaRecorder(stream)` sem mimeType usa o padrão do navegador, e o
     * código gravava o Blob fixo como 'audio/webm'. No Safari/iOS o padrão é
     * audio/mp4 — o arquivo saía rotulado errado, era recusado pela validação de
     * assinatura do servidor e o áudio simplesmente não ia. Aqui o formato é
     * negociado e o rótulo acompanha o conteúdo real.
     *
     * @returns {{mimeType: string, extensao: string}|null} null se o navegador
     *          não suporta gravação — nesse caso o botão de microfone some.
     */
    function formatoDeGravacao() {
        if (typeof MediaRecorder === 'undefined') return null;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;

        const candidatos = [
            { mimeType: 'audio/webm;codecs=opus', extensao: 'webm' }, // Chrome, Edge, Firefox
            { mimeType: 'audio/webm', extensao: 'webm' },
            { mimeType: 'audio/mp4', extensao: 'm4a' }, // Safari / iOS
            { mimeType: 'audio/ogg;codecs=opus', extensao: 'ogg' },
            { mimeType: 'audio/ogg', extensao: 'ogg' },
        ];

        // isTypeSupported não existe em navegadores mais antigos que expõem
        // MediaRecorder; nesse caso deixamos o navegador escolher o padrão dele.
        if (typeof MediaRecorder.isTypeSupported !== 'function') {
            return { mimeType: '', extensao: 'webm' };
        }

        const escolhido = candidatos.find((c) => MediaRecorder.isTypeSupported(c.mimeType));
        return escolhido || { mimeType: '', extensao: 'webm' };
    }

    /** Teto de gravação: 5 minutos, alinhado ao limite de 5 MB do servidor. */
    const MAX_GRAVACAO_SEG = 5 * 60;

    // Espelham as janelas do ChatDiretoController. Aqui servem só para não
    // oferecer um botão que o servidor vai recusar — a regra que vale é a de lá.
    const JANELA_EDICAO_MS = 15 * 60 * 1000;
    const JANELA_APAGAR_TODOS_MS = 60 * 60 * 1000;

    function dentroDaJanela(criadaEm, janelaMs) {
        if (!criadaEm) return false;
        const t = new Date(criadaEm).getTime();
        if (!Number.isFinite(t)) return false;
        return Date.now() - t <= janelaMs;
    }

    function esc(txt) {
        return String(txt == null ? '' : txt).replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
        );
    }

    function formatTime(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    /** Rótulo do separador de dias: Hoje / Ontem / 12 de março. */
    function labelDia(dateStr) {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '';
        const hoje = new Date();
        const ontem = new Date();
        ontem.setDate(ontem.getDate() - 1);
        const mesmoDia = (a, b) => a.toDateString() === b.toDateString();
        if (mesmoDia(d, hoje)) return 'Hoje';
        if (mesmoDia(d, ontem)) return 'Ontem';
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    }

    function formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function formatDuracao(segundos) {
        const s = Math.max(0, Math.round(Number(segundos) || 0));
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    /** "visto por último hoje às 14:32" para o cabeçalho da conversa. */
    function textoUltimoAcesso(iso) {
        if (!iso) return 'offline';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return 'offline';
        const dia = labelDia(iso);
        const hora = formatTime(iso);
        return dia === 'Hoje'
            ? `visto hoje às ${hora}`
            : dia === 'Ontem'
              ? `visto ontem às ${hora}`
              : `visto em ${d.toLocaleDateString('pt-BR')} às ${hora}`;
    }

    /** Ícone do Bootstrap Icons conforme a extensão/mimetype do anexo. */
    function iconePorArquivo(nome, tipo) {
        const t = String(tipo || '').toLowerCase();
        const ext = String(nome || '')
            .split('.')
            .pop()
            .toLowerCase();
        if (t.startsWith('image/')) return 'bi-file-earmark-image';
        if (t.startsWith('video/')) return 'bi-file-earmark-play';
        if (t.startsWith('audio/')) return 'bi-file-earmark-music';
        if (t === 'application/pdf' || ext === 'pdf') return 'bi-file-earmark-pdf';
        if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'bi-file-earmark-word';
        if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'bi-file-earmark-spreadsheet';
        if (['ppt', 'pptx', 'odp'].includes(ext)) return 'bi-file-earmark-slides';
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'bi-file-earmark-zip';
        if (['txt', 'md', 'log'].includes(ext)) return 'bi-file-earmark-text';
        return 'bi-file-earmark';
    }

    /** Resolve a foto de perfil pelo helper global (api-config.js). */
    function resolverFoto(foto) {
        if (!foto) return '';
        if (/^(https?:|data:|blob:|\/)/i.test(foto)) return foto;
        return window.getPhotoUrl ? window.getPhotoUrl(foto, '') : foto;
    }

    /**
     * O banco guarda o anexo como caminho relativo (`/api/chat-direto/anexo/…`).
     * Em desenvolvimento o front roda numa porta e a API em outra, então o
     * caminho cru apontaria para o servidor errado — aqui ele é reancorado na
     * API_BASE_URL configurada.
     */
    function urlAnexo(u) {
        if (!u) return '';
        if (/^(https?:|data:|blob:)/i.test(u)) return u;
        const base = API();
        if (u.startsWith('/api/')) return base + u.slice(4);
        if (u.startsWith('/')) return base + u;
        return u;
    }

    /** Iniciais seguras para o avatar de fallback (entram num atributo HTML). */
    function iniciais(nome) {
        const letras = String(nome || '?')
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p[0] || '')
            .join('')
            .toUpperCase();
        return letras.replace(/[^A-ZÀ-Ý0-9]/g, '') || '?';
    }

    /**
     * Comprime imagens antes do upload (requisito de performance): redimensiona
     * para no máximo IMG_MAX_LADO e reencoda em JPEG. GIF e imagens pequenas
     * passam intactas — recomprimir GIF perderia a animação.
     */
    function comprimirImagem(file) {
        return new Promise((resolve) => {
            const tipo = String(file.type || '').toLowerCase();
            if (
                !tipo.startsWith('image/') ||
                tipo === 'image/gif' ||
                file.size <= COMPRIMIR_ACIMA_DE
            ) {
                resolve(file);
                return;
            }
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                try {
                    const escala = Math.min(1, IMG_MAX_LADO / Math.max(img.width, img.height));
                    const w = Math.round(img.width * escala);
                    const h = Math.round(img.height * escala);
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    canvas.toBlob(
                        (blob) => {
                            URL.revokeObjectURL(url);
                            // Se a "compressão" engordou o arquivo, fica o original.
                            if (!blob || blob.size >= file.size) {
                                resolve(file);
                                return;
                            }
                            const nome =
                                String(file.name || 'imagem').replace(/\.[^.]+$/, '') + '.jpg';
                            resolve(new File([blob], nome, { type: 'image/jpeg' }));
                        },
                        'image/jpeg',
                        IMG_QUALIDADE
                    );
                } catch (e) {
                    URL.revokeObjectURL(url);
                    resolve(file);
                }
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(file);
            };
            img.src = url;
        });
    }

    // Lista de emojis populares para o seletor
    const EMOJI_LIST = [
        '😀',
        '😃',
        '😄',
        '😁',
        '😆',
        '😅',
        '😂',
        '🤣',
        '😊',
        '😇',
        '🙂',
        '🙃',
        '😉',
        '😌',
        '😍',
        '🥰',
        '😘',
        '😗',
        '😙',
        '😚',
        '😋',
        '😛',
        '😝',
        '😜',
        '🤪',
        '🤨',
        '🧐',
        '🤓',
        '😎',
        '🤩',
        '🥳',
        '😏',
        '😒',
        '😞',
        '😔',
        '😟',
        '😕',
        '🙁',
        '☹️',
        '😣',
        '😖',
        '😫',
        '😩',
        '🥺',
        '😢',
        '😭',
        '😤',
        '😠',
        '😡',
        '🤬',
        '🤯',
        '😳',
        '🥵',
        '🥶',
        '😱',
        '😨',
        '😰',
        '😥',
        '😓',
        '🤗',
        '🤔',
        '🤭',
        '🤫',
        '🤥',
        '😶',
        '😐',
        '😑',
        '😬',
        '🙄',
        '😯',
        '😦',
        '😧',
        '😮',
        '😲',
        '🥱',
        '😴',
        '🤤',
        '😪',
        '😵',
        '🤐',
        '🥴',
        '🤢',
        '🤮',
        '🤧',
        '😷',
        '🤒',
        '🤕',
        '🤑',
        '🤠',
        '😈',
        '👿',
        '👹',
        '👺',
        '🤡',
        '💩',
        '👻',
        '💀',
        '☠️',
        '👽',
        '👾',
        '🤖',
        '🎃',
        '😺',
        '😸',
        '😹',
        '😻',
        '😼',
        '😽',
        '🙀',
        '😿',
        '😾',
        '👋',
        '🤚',
        '🖐',
        '✋',
        '🖖',
        '👌',
        '🤏',
        '✌️',
        '🤞',
        '🤟',
        '🤘',
        '🤙',
        '👈',
        '👉',
        '👆',
        '🖕',
        '👇',
        '☝️',
        '👍',
        '👎',
        '✊',
        '👊',
        '🤛',
        '🤜',
        '👏',
        '🙌',
        '👐',
        '🤲',
        '🤝',
        '🙏',
        '✍️',
        '💅',
        '🤳',
        '💪',
        '🦾',
        '🦵',
        '🦿',
        '🦶',
        '👂',
        '🦻',
        '👃',
        '🧠',
        '🦷',
        '🦴',
        '👀',
        '👁',
        '👅',
        '👄',
        '💋',
        '🩸',
        '❤️',
        '🧡',
        '💛',
        '💚',
        '💙',
        '💜',
        '🖤',
        '🤍',
        '🤎',
        '💔',
        '❣️',
        '💕',
        '💞',
        '💓',
        '💗',
        '💖',
        '💘',
        '💝',
        '💟',
        '☮️',
        '✝️',
        '☪️',
        '🕉',
        '☸️',
        '✡️',
        '🔯',
        '🕎',
        '☯️',
        '☦️',
        '🛐',
        '⛎',
        '♈️',
        '♉️',
        '♊️',
        '♋️',
        '♌️',
        '♍️',
        '♎️',
        '♏️',
        '♐️',
        '♑️',
        '♒️',
        '♓️',
        '🆔',
        '⚛️',
        '🉑',
        '☢️',
        '☣️',
        '📴',
        '📳',
        '🈶',
        '🈚️',
        '🈸',
        '🈺',
        '🈷️',
        '✴️',
        '🆚',
        '💮',
        '🉐',
        '㊙️',
        '㊗️',
        '🈴',
        '🈵',
        '🈲',
        '🅰️',
        '🅱️',
        '🆎',
        '🆏',
        '🅾️',
        '💦',
        '🔥',
        '✨',
        '🎉',
        '🎊',
        '🚀',
        '⭐',
        '🌟',
        '💥',
    ];

    /* ------------------------------------------------------------------ *
     * Janela de conversa
     * ------------------------------------------------------------------ */

    class ChatWindowInstance {
        constructor(targetUserId, targetUserData, manager) {
            this.targetUserId = String(targetUserId);
            this.targetUserData = targetUserData || {};
            this.manager = manager;
            this.messages = [];
            this.isMinimized = false;
            this.replyingToMsg = null;
            this.editingMsgId = null;
            this.typingTimer = null;

            // Gravação de áudio
            this.isRecording = false;
            this.mediaRecorder = null;
            this.audioChunks = [];
            this.recTimerInterval = null;
            this.recSeconds = 0;
            this.audioPreview = null; // { blob, url, duracao }

            // Anexos aguardando confirmação de envio
            this.pendingFiles = []; // [{ file, url, ehImagem }]

            // Histórico paginado
            this.hasMore = true;
            this.carregandoMais = false;
            this.busca = { termo: '', data: '', filtro: '' };

            // Seleção múltipla
            this.modoSelecao = false;
            this.selecionadas = new Set();

            this.createDom();
            this.bindEvents();
            this.loadHistory();
            this.atualizarPresenca();
        }

        /* ---------------- DOM ---------------- */

        createDom() {
            const w = document.createElement('div');
            w.className = 'chat-window';
            w.id = `chatWindow_${this.targetUserId}`;
            // Janela flutuante sem semântica nenhuma: o leitor de tela lia um monte
            // de divs soltas sem dizer que aquilo era uma conversa nem com quem.
            w.setAttribute('role', 'dialog');
            w.setAttribute('aria-label', `Conversa com ${this.targetUserData.nome || 'contato'}`);

            const avatarUrl = resolverFoto(this.targetUserData.foto);
            const initials = iniciais(this.targetUserData.nome);
            const status = this.targetUserData.status || 'offline';

            const avatarHtml = avatarUrl
                ? `<img src="${esc(avatarUrl)}" class="chat-header-avatar" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'chat-header-avatar-fallback',textContent:'${initials}'}))">`
                : `<div class="chat-header-avatar-fallback">${esc(initials)}</div>`;

            w.innerHTML = `
        <div class="chat-header">
          <button class="chat-btn-icon btn-mobile-back" id="btnBack_${this.targetUserId}" title="Voltar" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
          <div class="chat-header-user" id="chatHeaderUser_${this.targetUserId}">
            <div class="chat-header-avatar-wrap">
              ${avatarHtml}
              <span class="chat-header-dot ${esc(status)}" id="chatDot_${this.targetUserId}"></span>
            </div>
            <div class="chat-header-info">
              <span class="chat-header-name">${esc(this.targetUserData.nome || 'Conversa')}</span>
              <span class="chat-header-status" id="chatStatus_${this.targetUserId}"></span>
            </div>
          </div>
          <div class="chat-header-actions">
            <button class="chat-btn-icon" id="btnToggleSom_${this.targetUserId}" title="Som das notificações" aria-label="Som das notificações"><i class="bi ${somAtivo() ? 'bi-volume-up' : 'bi-volume-mute'}"></i></button>
            <button class="chat-btn-icon" id="btnToggleSearch_${this.targetUserId}" title="Buscar na conversa" aria-label="Buscar na conversa"><i class="bi bi-search"></i></button>
            <button class="chat-btn-icon btn-minimize" id="btnMinimize_${this.targetUserId}" title="Minimizar" aria-label="Minimizar"><i class="bi bi-dash-lg"></i></button>
            <button class="chat-btn-icon close" id="btnClose_${this.targetUserId}" title="Fechar" aria-label="Fechar"><i class="bi bi-x-lg"></i></button>
          </div>
        </div>

        <div class="chat-search-bar" id="searchBar_${this.targetUserId}" hidden>
          <div class="chat-search-row">
            <input type="text" class="chat-search-input" id="searchInput_${this.targetUserId}" placeholder="Buscar por palavra...">
            <button class="chat-btn-icon" id="btnCloseSearch_${this.targetUserId}" title="Fechar busca" aria-label="Fechar busca"><i class="bi bi-x"></i></button>
          </div>
          <div class="chat-search-row">
            <input type="date" class="chat-search-input chat-search-date" id="searchDate_${this.targetUserId}" title="Buscar por data">
            <select class="chat-search-input chat-search-filter" id="searchFilter_${this.targetUserId}" title="Filtrar por tipo">
              <option value="">Tudo</option>
              <option value="anexos">Anexos</option>
              <option value="imagens">Imagens</option>
              <option value="audios">Áudios</option>
            </select>
            <button class="chat-btn-icon" id="btnClearSearch_${this.targetUserId}" title="Limpar filtros" aria-label="Limpar filtros"><i class="bi bi-eraser"></i></button>
          </div>
        </div>

        <div class="chat-selection-bar" id="selectionBar_${this.targetUserId}" hidden>
          <button class="chat-btn-icon" id="btnCancelSel_${this.targetUserId}" title="Cancelar seleção" aria-label="Cancelar seleção"><i class="bi bi-x-lg"></i></button>
          <span class="chat-selection-count" id="selCount_${this.targetUserId}">0 selecionada(s)</span>
          <button class="chat-btn-icon" id="btnSelCopy_${this.targetUserId}" title="Copiar texto" aria-label="Copiar texto"><i class="bi bi-clipboard"></i></button>
          <button class="chat-btn-icon" id="btnSelForward_${this.targetUserId}" title="Encaminhar" aria-label="Encaminhar"><i class="bi bi-arrow-right-circle"></i></button>
          <button class="chat-btn-icon" id="btnSelDelete_${this.targetUserId}" title="Apagar para mim" aria-label="Apagar para mim" style="color:#ef4444;"><i class="bi bi-trash"></i></button>
        </div>

        <div class="chat-body" id="chatBody_${this.targetUserId}" role="log" aria-label="Mensagens da conversa">
          <div class="chat-loading">Carregando histórico...</div>
        </div>

        <!-- Região exclusiva para anunciar mensagem NOVA ao leitor de tela.
             Marcar a lista inteira como aria-live faria o leitor despejar as
             30 mensagens do histórico a cada abertura; aqui entra só o que
             chega depois, uma linha por vez. -->
        <div class="sr-only" aria-live="polite" aria-atomic="true"
             id="chatAnuncio_${this.targetUserId}"></div>

        <div class="chat-reply-preview" id="replyPreview_${this.targetUserId}" hidden>
          <span id="replyText_${this.targetUserId}">Citação...</span>
          <button class="chat-btn-icon" id="btnCancelReply_${this.targetUserId}" title="Cancelar" aria-label="Cancelar"><i class="bi bi-x"></i></button>
        </div>

        <div class="chat-attach-preview" id="attachPreview_${this.targetUserId}" hidden></div>

        <div class="chat-emoji-picker-popover" id="emojiPicker_${this.targetUserId}" hidden>
          ${EMOJI_LIST.map((e) => `<span class="chat-emoji-item">${e}</span>`).join('')}
        </div>

        <div class="chat-footer">
          <div class="chat-input-row" id="inputRowNormal_${this.targetUserId}">
            <button class="chat-btn-icon" id="btnAttach_${this.targetUserId}" title="Anexar arquivo" aria-label="Anexar arquivo"><i class="bi bi-paperclip"></i></button>
            <button class="chat-btn-icon" id="btnEmoji_${this.targetUserId}" title="Emojis" aria-label="Emojis"><i class="bi bi-emoji-smile"></i></button>
            <textarea class="chat-textarea" id="chatInput_${this.targetUserId}" rows="1" placeholder="Digite uma mensagem..." aria-label="Mensagem"></textarea>
            <button class="chat-btn-icon chat-btn-mic" id="btnMic_${this.targetUserId}" title="Gravar áudio" aria-label="Gravar áudio"><i class="bi bi-mic-fill"></i></button>
            <button class="chat-btn-send" id="btnSend_${this.targetUserId}" title="Enviar" aria-label="Enviar"><i class="bi bi-send-fill"></i></button>
          </div>

          <div class="chat-audio-recorder-bar" id="recorderBar_${this.targetUserId}" hidden>
            <div class="chat-rec-dot"></div>
            <span class="chat-rec-timer" id="recTimer_${this.targetUserId}">00:00</span>
            <span class="chat-rec-label">Gravando áudio...</span>
            <button class="chat-btn-icon" id="btnCancelRec_${this.targetUserId}" title="Cancelar" aria-label="Cancelar" style="color:#ef4444;"><i class="bi bi-trash"></i></button>
            <button class="chat-btn-icon" id="btnStopRec_${this.targetUserId}" title="Parar e ouvir" aria-label="Parar e ouvir"><i class="bi bi-stop-fill"></i></button>
          </div>

          <div class="chat-audio-preview-bar" id="audioPreviewBar_${this.targetUserId}" hidden>
            <button class="chat-btn-icon" id="btnPlayPreview_${this.targetUserId}" title="Ouvir" aria-label="Ouvir"><i class="bi bi-play-fill"></i></button>
            <span class="chat-rec-timer" id="previewTimer_${this.targetUserId}">00:00</span>
            <span class="chat-rec-label">Ouça antes de enviar</span>
            <button class="chat-btn-icon" id="btnDiscardPreview_${this.targetUserId}" title="Descartar" aria-label="Descartar" style="color:#ef4444;"><i class="bi bi-trash"></i></button>
            <button class="chat-btn-send" id="btnSendAudio_${this.targetUserId}" title="Enviar áudio" aria-label="Enviar áudio"><i class="bi bi-send-fill"></i></button>
          </div>

          <input type="file" id="fileInput_${this.targetUserId}" hidden multiple
                 accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z">
        </div>
      `;

            this.manager.container.appendChild(w);
            this.el = w;
            this.bodyEl = w.querySelector(`#chatBody_${this.targetUserId}`);
            this.inputEl = w.querySelector(`#chatInput_${this.targetUserId}`);
            this.atualizarStatusHeader();
        }

        q(prefixo) {
            return this.el.querySelector(`#${prefixo}_${this.targetUserId}`);
        }

        bindEvents() {
            const w = this.el;

            this.q('btnBack')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
            });
            this.q('btnMinimize').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMinimize();
            });
            this.q('chatHeaderUser').addEventListener('click', () => {
                if (this.isMinimized) this.toggleMinimize();
            });
            this.q('btnClose').addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
            });

            // Som configurável
            this.q('btnToggleSom').addEventListener('click', () => {
                const novo = !somAtivo();
                definirSom(novo);
                this.manager.sincronizarIconeSom();
                if (novo) playNotificationSound();
            });

            /* Busca: termo, data e tipo de anexo — resolvida no servidor para
         alcançar o histórico inteiro, não só as mensagens já carregadas. */
            const searchBar = this.q('searchBar');
            const searchInput = this.q('searchInput');
            this.q('btnToggleSearch').addEventListener('click', () => {
                searchBar.hidden = !searchBar.hidden;
                if (!searchBar.hidden) searchInput.focus();
                else this.limparBusca();
            });
            this.q('btnCloseSearch').addEventListener('click', () => {
                searchBar.hidden = true;
                this.limparBusca();
            });
            this.q('btnClearSearch').addEventListener('click', () => this.limparBusca());

            let buscaTimer = null;
            const dispararBusca = () => {
                clearTimeout(buscaTimer);
                buscaTimer = setTimeout(() => {
                    this.busca = {
                        termo: searchInput.value.trim(),
                        data: this.q('searchDate').value,
                        filtro: this.q('searchFilter').value,
                    };
                    this.loadHistory();
                }, 350);
            };
            searchInput.addEventListener('input', dispararBusca);
            this.q('searchDate').addEventListener('change', dispararBusca);
            this.q('searchFilter').addEventListener('change', dispararBusca);

            // Barra de seleção múltipla
            this.q('btnCancelSel').addEventListener('click', () => this.sairModoSelecao());
            this.q('btnSelCopy').addEventListener('click', () => this.copiarSelecionadas());
            this.q('btnSelForward').addEventListener('click', () =>
                this.manager.abrirModalEncaminhar([...this.selecionadas])
            );
            this.q('btnSelDelete').addEventListener('click', () => this.apagarSelecionadas());

            // Enviar com Enter (Shift+Enter quebra linha) + auto-resize
            this.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                } else if (e.key === 'Escape' && this.editingMsgId) {
                    this.cancelarEdicao();
                } else {
                    this.emitTyping();
                }
            });
            this.inputEl.addEventListener('input', () => {
                this.inputEl.style.height = 'auto';
                this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 90) + 'px';
            });

            this.q('btnSend').addEventListener('click', () => this.sendMessage());

            // Emojis
            const emojiPicker = this.q('emojiPicker');
            this.q('btnEmoji').addEventListener('click', (e) => {
                e.stopPropagation();
                emojiPicker.hidden = !emojiPicker.hidden;
            });
            emojiPicker.addEventListener('click', (e) => {
                if (e.target.classList.contains('chat-emoji-item')) {
                    this.inputEl.value += e.target.textContent;
                    this.inputEl.focus();
                    emojiPicker.hidden = true;
                }
            });

            // Escape fecha o que estiver aberto, do mais interno para o mais externo.
            // Antes só existia saída por clique: quem navega por teclado ficava preso
            // no seletor de emoji e na barra de busca.
            w.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                e.stopPropagation();

                if (!emojiPicker.hidden) {
                    emojiPicker.hidden = true;
                    this.inputEl.focus();
                    return;
                }
                if (this.audioPreview) {
                    this.descartarPreviaAudio();
                    return;
                }
                if (this.isRecording) {
                    this.cancelRecording();
                    return;
                }
                if (this.replyingToMsg) {
                    this.cancelReply();
                    return;
                }
                const searchBar = this.q('searchBar');
                if (searchBar && !searchBar.hidden) {
                    searchBar.hidden = true;
                    this.limparBusca();
                    this.inputEl.focus();
                    return;
                }
                this.close();
            });

            // Seletor de emoji operável por teclado: os itens eram <span> sem foco
            // nem papel, invisíveis para quem navega com Tab.
            emojiPicker.querySelectorAll('.chat-emoji-item').forEach((item) => {
                item.setAttribute('role', 'button');
                item.setAttribute('tabindex', '0');
                item.setAttribute('aria-label', `Emoji ${item.textContent}`);
                item.addEventListener('keydown', (ev) => {
                    if (ev.key !== 'Enter' && ev.key !== ' ') return;
                    ev.preventDefault();
                    this.inputEl.value += item.textContent;
                    this.inputEl.focus();
                    emojiPicker.hidden = true;
                });
            });

            // Anexos: seleção, arrastar-e-soltar e colar da área de transferência
            const fileInput = this.q('fileInput');
            this.q('btnAttach').addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                this.enfileirarArquivos(e.target.files);
                fileInput.value = '';
            });

            ['dragenter', 'dragover'].forEach((ev) => {
                w.addEventListener(ev, (e) => {
                    e.preventDefault();
                    w.classList.add('drag-over');
                });
            });
            ['dragleave', 'drop'].forEach((ev) => {
                w.addEventListener(ev, (e) => {
                    e.preventDefault();
                    if (ev === 'dragleave' && w.contains(e.relatedTarget)) return;
                    w.classList.remove('drag-over');
                });
            });
            w.addEventListener('drop', (e) => {
                if (e.dataTransfer?.files?.length) this.enfileirarArquivos(e.dataTransfer.files);
            });

            this.inputEl.addEventListener('paste', (e) => {
                const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items || [];
                const imagens = [];
                for (const item of items) {
                    if (item.type && item.type.indexOf('image') !== -1) {
                        const blob = item.getAsFile();
                        if (blob) imagens.push(blob);
                    }
                }
                if (imagens.length) {
                    e.preventDefault();
                    this.enfileirarArquivos(imagens);
                }
            });

            // Gravador de voz. Sem suporte a MediaRecorder (Safari antigo, WebView
            // restrita), o botão some em vez de abrir um erro no clique.
            const btnMic = this.q('btnMic');
            if (formatoDeGravacao()) {
                btnMic.addEventListener('click', () => this.startRecording());
            } else {
                btnMic.hidden = true;
                btnMic.setAttribute('aria-hidden', 'true');
            }
            this.q('btnCancelRec').addEventListener('click', () => this.cancelRecording());
            this.q('btnStopRec').addEventListener('click', () => this.pararGravacaoParaPrevia());
            this.q('btnPlayPreview').addEventListener('click', () => this.tocarPreviaAudio());
            this.q('btnDiscardPreview').addEventListener('click', () =>
                this.descartarPreviaAudio()
            );
            this.q('btnSendAudio').addEventListener('click', () => this.enviarAudioGravado());

            // A mesma barra serve para "respondendo" e "editando": o X precisa saber
            // qual dos dois cancelar, senão sair de uma edição deixava o
            // editingMsgId ativo e a próxima mensagem digitada sobrescrevia a antiga.
            this.q('btnCancelReply').addEventListener('click', () => {
                if (this.editingMsgId) this.cancelarEdicao();
                else this.cancelReply();
            });

            // Lazy loading: chegou ao topo, carrega a página anterior do histórico
            this.bodyEl.addEventListener('scroll', () => {
                if (this.bodyEl.scrollTop <= 40) this.carregarMaisAntigas();
            });
        }

        toggleMinimize() {
            this.isMinimized = !this.isMinimized;
            this.el.classList.toggle('minimized', this.isMinimized);
            if (!this.isMinimized) {
                this.el.classList.remove('tem-novidade');
                this.scrollToBottom();
                // Só agora o usuário de fato viu o que chegou enquanto estava fechada.
                this.marcarConversaLida();
            }
        }

        close() {
            if (this.isRecording) this.cancelRecording();
            this.descartarPreviaAudio();
            this.pendingFiles.forEach((p) => {
                if (p.url) URL.revokeObjectURL(p.url);
            });
            this.el.remove();
            this.manager.removeWindow(this.targetUserId);
        }

        /* ---------------- Presença e status ---------------- */

        async atualizarPresenca() {
            try {
                const res = await fetch(`${API()}/chat-direto/presenca/${this.targetUserId}`, {
                    credentials: 'include',
                });
                if (!res.ok) return;
                const json = await res.json();
                if (!json.success) return;
                this.targetUserData.status = json.data.status;
                this.targetUserData.ultimoAcesso = json.data.ultimoAcesso;
                this.atualizarStatusHeader();
            } catch (e) {
                /* mantém o status recebido do card */
            }
        }

        /** Repõe o texto padrão do cabeçalho (cargo + status / visto por último). */
        atualizarStatusHeader() {
            const statusEl = this.q('chatStatus');
            const dot = this.q('chatDot');
            if (!statusEl) return;

            const status = String(this.targetUserData.status || 'offline').toLowerCase();
            if (dot) dot.className = `chat-header-dot ${status}`;

            const cargo = this.targetUserData.cargo ? `${this.targetUserData.cargo} • ` : '';
            const rotulo =
                status === 'online'
                    ? '🟢 Online'
                    : status === 'ausente'
                      ? '🟡 Ausente'
                      : `🔴 ${textoUltimoAcesso(this.targetUserData.ultimoAcesso)}`;

            statusEl.className = 'chat-header-status';
            statusEl.textContent = `${cargo}${rotulo}`;
        }

        onPresenca(status, ultimoAcesso) {
            this.targetUserData.status = status;
            if (ultimoAcesso) this.targetUserData.ultimoAcesso = ultimoAcesso;
            else if (status === 'offline')
                this.targetUserData.ultimoAcesso = new Date().toISOString();
            this.atualizarStatusHeader();
        }

        onTyping(isTyping) {
            const statusEl = this.q('chatStatus');
            if (!isTyping) {
                this.atualizarStatusHeader();
                return;
            }
            statusEl.className = 'chat-header-status typing';
            statusEl.textContent = '✍️ digitando...';
            clearTimeout(this._typingReset);
            // Rede de segurança: se o "parou de digitar" se perder, o status volta.
            this._typingReset = setTimeout(() => this.atualizarStatusHeader(), 6000);
        }

        onRecording(isRecording) {
            const statusEl = this.q('chatStatus');
            if (!isRecording) {
                this.atualizarStatusHeader();
                return;
            }
            statusEl.className = 'chat-header-status typing';
            statusEl.textContent = '🎤 gravando áudio...';
            clearTimeout(this._recReset);
            this._recReset = setTimeout(() => this.atualizarStatusHeader(), 30000);
        }

        emitTyping() {
            if (!window.socket) return;
            window.socket.emit('chat:typing', {
                destinatarioId: this.targetUserId,
                isTyping: true,
            });
            clearTimeout(this.typingTimer);
            this.typingTimer = setTimeout(() => {
                window.socket.emit('chat:typing', {
                    destinatarioId: this.targetUserId,
                    isTyping: false,
                });
            }, 2000);
        }

        /* ---------------- Histórico ---------------- */

        paramsBusca(extra) {
            const p = new URLSearchParams(extra || {});
            if (this.busca.termo) p.set('search', this.busca.termo);
            if (this.busca.data) p.set('data', this.busca.data);
            if (this.busca.filtro) p.set('filter', this.busca.filtro);
            const s = p.toString();
            return s ? `?${s}` : '';
        }

        limparBusca() {
            this.q('searchInput').value = '';
            this.q('searchDate').value = '';
            this.q('searchFilter').value = '';
            this.busca = { termo: '', data: '', filtro: '' };
            this.loadHistory();
        }

        get buscaAtiva() {
            return !!(this.busca.termo || this.busca.data || this.busca.filtro);
        }

        async loadHistory() {
            try {
                const res = await fetch(
                    `${API()}/chat-direto/historico/${this.targetUserId}${this.paramsBusca()}`,
                    { credentials: 'include' }
                );
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const json = await res.json();
                this.messages = json.data || [];
                this.hasMore = !!json.hasMore;
                this.renderMessages();
                this.scrollToBottom();
                this.marcarConversaLida();
            } catch (e) {
                this.bodyEl.innerHTML = `<div class="chat-erro">Falha ao carregar mensagens.</div>`;
            }
        }

        /**
         * Recupera as mensagens perdidas enquanto o socket esteve fora do ar.
         *
         * O Socket.IO reconecta sozinho, mas o que passou durante a queda não é
         * reenviado: a janela ficava aberta mostrando um histórico furado até o
         * usuário fechar e reabrir a conversa. No plano free do Render, que
         * hiberna por inatividade, isso não é exceção — é rotina.
         *
         * Busca a página mais recente e deixa o `appendMessage` decidir o que é
         * novo (ele já deduplica por _id, insere só a bolha nova e preserva a
         * rolagem de quem está lendo mensagem antiga).
         */
        async resincronizar() {
            // Com busca ativa a lista está filtrada de propósito; recarregar aqui
            // jogaria mensagens fora do recorte que o usuário pediu.
            if (this.buscaAtiva || this._resincronizando) return;
            this._resincronizando = true;

            try {
                const res = await fetch(
                    `${API()}/chat-direto/historico/${this.targetUserId}${this.paramsBusca()}`,
                    { credentials: 'include' }
                );
                if (!res.ok) return;
                const json = await res.json();

                const conhecidas = new Set(this.messages.map((m) => String(m._id)));
                const perdidas = (json.data || []).filter((m) => !conhecidas.has(String(m._id)));
                if (perdidas.length === 0) return;

                // Chegam em ordem cronológica: appendMessage empilha no fim na ordem certa.
                perdidas.forEach((m) => {
                    this.appendMessage(m);
                });

                // Só avisa se havia mensagem do OUTRO lado — reconexão silenciosa
                // quando não perdeu nada relevante.
                const deOutrem = perdidas.some((m) => String(m.remetenteId) !== this.manager.meuId);
                if (deOutrem) {
                    this.manager.toast(
                        perdidas.length === 1
                            ? 'Você recebeu 1 mensagem enquanto estava offline.'
                            : `Você recebeu ${perdidas.length} mensagens enquanto estava offline.`
                    );
                    playNotificationSound();
                }
            } catch (e) {
                /* rede ainda instável — a próxima reconexão tenta de novo */
            } finally {
                this._resincronizando = false;
            }
        }

        /**
         * Lazy loading: busca a página anterior usando o createdAt da mensagem
         * mais antiga já carregada e preserva a posição visual da rolagem.
         */
        async carregarMaisAntigas() {
            if (this.carregandoMais || !this.hasMore || this.messages.length === 0) return;
            this.carregandoMais = true;

            const alturaAntes = this.bodyEl.scrollHeight;
            const antiga = this.messages[0];
            const sentinela = this.q('btnMaisAntigas');
            if (sentinela) {
                sentinela.textContent = 'Carregando…';
                sentinela.disabled = true;
            }

            try {
                const res = await fetch(
                    `${API()}/chat-direto/historico/${this.targetUserId}${this.paramsBusca({ before: antiga.createdAt || antiga.dataEnvio })}`,
                    { credentials: 'include' }
                );
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const json = await res.json();
                const antigas = json.data || [];
                this.hasMore = !!json.hasMore;

                if (antigas.length > 0) {
                    const conhecidas = new Set(this.messages.map((m) => String(m._id)));
                    this.messages = antigas
                        .filter((m) => !conhecidas.has(String(m._id)))
                        .concat(this.messages);
                    this.renderMessages();
                    // Mantém a mensagem que o usuário estava lendo sob os olhos dele.
                    this.bodyEl.scrollTop = this.bodyEl.scrollHeight - alturaAntes;
                }
            } catch (e) {
                // O histórico já visível continua utilizável; só devolve a sentinela.
                const s = this.q('btnMaisAntigas');
                if (s) {
                    s.textContent = '↑ Ver mensagens anteriores';
                    s.disabled = false;
                }
            } finally {
                this.carregandoMais = false;
            }
        }

        /**
         * Marca a conversa inteira como lida numa única requisição.
         *
         * Janela minimizada NÃO marca: o usuário não viu a mensagem, e confirmar
         * leitura ali é mentir para o outro lado. A marcação acontece quando ele
         * restaura a janela.
         *
         * O agendamento com debounce evita um PATCH por mensagem numa rajada.
         */
        marcarConversaLida() {
            if (this.isMinimized) return;
            clearTimeout(this._lidaTimer);
            this._lidaTimer = setTimeout(() => this.enviarLeitura(), 400);
        }

        async enviarLeitura() {
            const meuId = this.manager.meuId;
            const temNaoLidas = this.messages.some(
                (m) => String(m.destinatarioId) === meuId && !m.lida
            );
            if (!temNaoLidas) return;

            this.messages.forEach((m) => {
                if (String(m.destinatarioId) === meuId) {
                    m.lida = true;
                    m.status = 'lida';
                }
            });

            try {
                await fetch(`${API()}/chat-direto/lidas/${this.targetUserId}`, {
                    method: 'PATCH',
                    credentials: 'include',
                });
                if (window.refreshProfsOnline) window.refreshProfsOnline();
            } catch (e) {
                /* nova tentativa na próxima abertura */
            }
        }

        /* ---------------- Renderização ---------------- */

        renderMessages() {
            if (this.messages.length === 0) {
                this.bodyEl.innerHTML = this.buscaAtiva
                    ? `<div class="chat-vazio">Nenhuma mensagem encontrada para esta busca. 🔍</div>`
                    : `<div class="chat-vazio">Nenhuma mensagem ainda. Inicie a conversa! 👋</div>`;
                return;
            }

            // Sentinela do lazy loading: rolar até ela dispara a página anterior, e
            // o clique cobre quem prefere (ou precisa) do teclado.
            let html = this.hasMore
                ? `<button type="button" class="chat-loading-mais" id="btnMaisAntigas_${this.targetUserId}">↑ Ver mensagens anteriores</button>`
                : '';
            let diaAtual = null;

            this.messages.forEach((m) => {
                const dia = labelDia(m.createdAt || m.dataEnvio);
                if (dia && dia !== diaAtual) {
                    diaAtual = dia;
                    html += `<div class="chat-day-divider"><span>${esc(dia)}</span></div>`;
                }
                html += this.renderSingleBubble(m);
            });

            this.bodyEl.innerHTML = html;
            this.bindBubbleEvents();
            this.q('btnMaisAntigas')?.addEventListener('click', () => this.carregarMaisAntigas());
        }

        renderSingleBubble(m) {
            const meuId = this.manager.meuId;
            const isSent = String(m.remetenteId) === meuId;
            const time = formatTime(m.createdAt || m.dataEnvio);
            const isRead = m.lida || m.status === 'lida';
            const ticks = isSent
                ? `<span class="chat-msg-ticks ${isRead ? 'read' : ''}" title="${isRead ? 'Lida' : 'Enviada'}">${isRead ? '✓✓' : '✓'}</span>`
                : '';
            const selecionada = this.selecionadas.has(String(m._id));

            let replyHtml = '';
            if (m.respostaParaId) {
                const ref = this.messages.find((x) => String(x._id) === String(m.respostaParaId));
                if (ref) {
                    const autor =
                        String(ref.remetenteId) === meuId
                            ? 'Você'
                            : this.targetUserData.nome || 'Contato';
                    replyHtml = `<div class="chat-reply-quote" data-goto="${esc(String(ref._id))}"><strong>${esc(autor)}</strong>: ${esc(this.resumoMensagem(ref))}</div>`;
                }
            }

            const encaminhadaTag = m.encaminhada
                ? `<div class="chat-encaminhada"><i class="bi bi-arrow-return-right"></i> Encaminhada</div>`
                : '';

            let contentHtml = '';
            if (m.apagadaParaTodos) {
                contentHtml = `<span class="chat-msg-apagada"><i class="bi bi-slash-circle"></i> Esta mensagem foi apagada.</span>`;
            } else {
                if (m.mensagem)
                    contentHtml += `<div class="chat-msg-texto">${esc(m.mensagem)}</div>`;
                if (m.anexo && m.anexo.url) contentHtml += this.renderAnexo(m.anexo);
                if (m.audio && m.audio.url) {
                    contentHtml += `
            <div class="chat-audio-player" data-audio-url="${esc(urlAnexo(m.audio.url))}">
              <button type="button" class="btn-audio-play" aria-label="Reproduzir áudio"><i class="bi bi-play-fill"></i></button>
              <div class="chat-audio-wave"><div class="chat-audio-progress"></div></div>
              <span class="chat-audio-time">${m.audio.duracao ? formatDuracao(m.audio.duracao) : 'Áudio'}</span>
            </div>`;
                }
            }

            // Reações agrupadas por emoji, com a contagem de cada uma
            let reacoesHtml = '';
            if (Array.isArray(m.reacoes) && m.reacoes.length > 0) {
                const counts = {};
                const quem = {};
                m.reacoes.forEach((r) => {
                    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
                    quem[r.emoji] =
                        (quem[r.emoji] ? quem[r.emoji] + ', ' : '') + (r.usuarioNome || 'Usuário');
                });
                reacoesHtml = `<div class="chat-reacoes-list">${Object.keys(counts)
                    .map(
                        (emoji) =>
                            `<span class="chat-reacao-badge" data-msg-id="${esc(String(m._id))}" data-emoji="${esc(emoji)}" title="${esc(quem[emoji])}">${emoji} ${counts[emoji]}</span>`
                    )
                    .join('')}</div>`;
            }

            const editedTag = m.editada ? `<span class="chat-editada-tag">(editada)</span>` : '';
            const checkbox = this.modoSelecao
                ? `<input type="checkbox" class="chat-msg-check" data-msg-id="${esc(String(m._id))}" ${selecionada ? 'checked' : ''} aria-label="Selecionar mensagem">`
                : '';

            return `
        <div class="chat-message-row ${isSent ? 'sent' : 'received'} ${selecionada ? 'selecionada' : ''}" id="msgRow_${esc(String(m._id))}" data-msg-id="${esc(String(m._id))}">
          ${checkbox}
          <div class="chat-bubble">
            ${encaminhadaTag}
            ${replyHtml}
            ${contentHtml}
            <div class="chat-msg-meta">
              ${editedTag}
              <span>${time}</span>
              ${ticks}
            </div>
            ${reacoesHtml}
            <div class="chat-msg-actions-trigger" data-msg-id="${esc(String(m._id))}" title="Opções"><i class="bi bi-chevron-down"></i></div>
          </div>
        </div>`;
        }

        /** Anexo: imagem/vídeo inline; demais formatos como cartão com download. */
        renderAnexo(anexo) {
            const tipo = String(anexo.tipo || '').toLowerCase();
            const url = esc(urlAnexo(anexo.url));
            const nome = esc(anexo.nome || 'Arquivo');

            if (tipo.startsWith('image/')) {
                return `<a href="${url}" target="_blank" rel="noopener" class="chat-anexo-img-link">
                  <img src="${url}" class="chat-anexo-img" alt="${nome}" loading="lazy">
                </a>`;
            }
            if (tipo.startsWith('video/')) {
                return `<video class="chat-anexo-video" src="${url}" controls preload="metadata"></video>
                <div class="chat-anexo-legenda">${nome} • ${formatFileSize(anexo.tamanho)}</div>`;
            }
            if (tipo.startsWith('audio/')) {
                return `<audio class="chat-anexo-audio" src="${url}" controls preload="metadata"></audio>
                <div class="chat-anexo-legenda">${nome} • ${formatFileSize(anexo.tamanho)}</div>`;
            }
            return `
        <a href="${url}" target="_blank" rel="noopener" download="${nome}" class="chat-anexo-card">
          <i class="bi ${iconePorArquivo(anexo.nome, anexo.tipo)} chat-anexo-icon"></i>
          <div class="chat-anexo-info">
            <span class="chat-anexo-nome">${nome}</span>
            <span class="chat-anexo-size">${formatFileSize(anexo.tamanho)}</span>
          </div>
          <i class="bi bi-download chat-anexo-download"></i>
        </a>`;
        }

        resumoMensagem(m) {
            if (m.mensagem) return m.mensagem.slice(0, 80);
            if (m.audio && m.audio.url) return '🎤 Áudio';
            if (m.anexo && m.anexo.nome) return `📎 ${m.anexo.nome}`;
            return 'Mensagem';
        }

        /**
         * `escopo` limita a ligação a uma bolha específica: ao repintar uma única
         * mensagem, revarrer o corpo inteiro empilharia um listener extra em cada
         * bolha já ligada (áudio tocando duas vezes, menu abrindo duplicado).
         */
        bindBubbleEvents(escopo) {
            const raiz = escopo || this.bodyEl;

            // Players de áudio — um por vez, como no WhatsApp
            raiz.querySelectorAll('.btn-audio-play').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const player = btn.closest('.chat-audio-player');
                    const url = player?.dataset.audioUrl;
                    if (!url) return;

                    if (this._audioAtual && !this._audioAtual.paused) {
                        this._audioAtual.pause();
                        if (this._audioBtn)
                            this._audioBtn.innerHTML = `<i class="bi bi-play-fill"></i>`;
                        if (this._audioBtn === btn) {
                            this._audioAtual = null;
                            this._audioBtn = null;
                            return;
                        }
                    }

                    const audio = new Audio(url);
                    const prog = player.querySelector('.chat-audio-progress');
                    this._audioAtual = audio;
                    this._audioBtn = btn;
                    btn.innerHTML = `<i class="bi bi-pause-fill"></i>`;
                    audio.play().catch(() => {
                        btn.innerHTML = `<i class="bi bi-play-fill"></i>`;
                    });
                    audio.ontimeupdate = () => {
                        if (audio.duration)
                            prog.style.width = (audio.currentTime / audio.duration) * 100 + '%';
                    };
                    audio.onended = () => {
                        btn.innerHTML = `<i class="bi bi-play-fill"></i>`;
                        prog.style.width = '0%';
                        this._audioAtual = null;
                    };
                });
            });

            // Menu de ações da mensagem
            raiz.querySelectorAll('.chat-msg-actions-trigger').forEach((trig) => {
                trig.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showMsgActionMenu(trig.dataset.msgId, trig);
                });
            });

            // Toque longo abre o mesmo menu no celular
            raiz.querySelectorAll('.chat-bubble').forEach((bolha) => {
                let timer = null;
                bolha.addEventListener(
                    'touchstart',
                    () => {
                        timer = setTimeout(() => {
                            const row = bolha.closest('.chat-message-row');
                            if (row) this.showMsgActionMenu(row.dataset.msgId, bolha);
                        }, 550);
                    },
                    { passive: true }
                );
                ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => {
                    bolha.addEventListener(ev, () => clearTimeout(timer), { passive: true });
                });
            });

            // Reagir/desreagir clicando na própria contagem
            raiz.querySelectorAll('.chat-reacao-badge').forEach((badge) => {
                badge.addEventListener('click', () =>
                    this.sendReaction(badge.dataset.msgId, badge.dataset.emoji)
                );
            });

            // Citação leva até a mensagem original
            raiz.querySelectorAll('.chat-reply-quote[data-goto]').forEach((quote) => {
                quote.addEventListener('click', () => {
                    const alvo = this.bodyEl.querySelector(
                        `#msgRow_${CSS.escape(quote.dataset.goto)}`
                    );
                    if (!alvo) return;
                    alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    alvo.classList.add('destacada');
                    setTimeout(() => alvo.classList.remove('destacada'), 1600);
                });
            });

            // Caixas de seleção múltipla
            raiz.querySelectorAll('.chat-msg-check').forEach((chk) => {
                chk.addEventListener('change', () => {
                    const id = chk.dataset.msgId;
                    if (chk.checked) this.selecionadas.add(id);
                    else this.selecionadas.delete(id);
                    chk.closest('.chat-message-row')?.classList.toggle('selecionada', chk.checked);
                    this.atualizarContadorSelecao();
                });
            });
        }

        /**
         * Atualiza uma bolha específica sem recarregar a conversa inteira —
         * reação, edição e leitura chegam a todo momento e um re-render completo
         * jogava a rolagem fora de lugar e piscava a tela.
         */
        substituirBolha(msg) {
            const idx = this.messages.findIndex((m) => String(m._id) === String(msg._id));
            if (idx === -1) return false;
            this.messages[idx] = { ...this.messages[idx], ...msg };

            const row = this.bodyEl.querySelector(`#msgRow_${CSS.escape(String(msg._id))}`);
            if (!row) return false;

            const temp = document.createElement('div');
            temp.innerHTML = this.renderSingleBubble(this.messages[idx]);
            const nova = temp.firstElementChild;
            row.replaceWith(nova);
            this.bindBubbleEvents(nova);
            return true;
        }

        /* ---------------- Menu de ações ---------------- */

        showMsgActionMenu(msgId, targetEl) {
            const msg = this.messages.find((x) => String(x._id) === String(msgId));
            if (!msg) return;
            const isSent = String(msg.remetenteId) === this.manager.meuId;

            document.getElementById('chatMsgMenu')?.remove();

            const menu = document.createElement('div');
            menu.id = 'chatMsgMenu';
            menu.className = 'chat-msg-menu';
            menu.innerHTML = `
        <div class="chat-msg-menu-reacoes">
          ${REACOES_RAPIDAS.map((emoji) => `<span class="emoji-opt" data-emoji="${emoji}" role="button" tabindex="0">${emoji}</span>`).join('')}
        </div>
        <button type="button" class="menu-opt" data-acao="responder"><i class="bi bi-reply-fill"></i> Responder</button>
        ${!msg.apagadaParaTodos && msg.mensagem ? `<button type="button" class="menu-opt" data-acao="copiar"><i class="bi bi-clipboard"></i> Copiar texto</button>` : ''}
        ${!msg.apagadaParaTodos ? `<button type="button" class="menu-opt" data-acao="encaminhar"><i class="bi bi-arrow-right-circle"></i> Encaminhar</button>` : ''}
        <button type="button" class="menu-opt" data-acao="selecionar"><i class="bi bi-check2-square"></i> Selecionar</button>
        ${isSent && !msg.apagadaParaTodos && msg.mensagem && dentroDaJanela(msg.createdAt, JANELA_EDICAO_MS) ? `<button type="button" class="menu-opt" data-acao="editar"><i class="bi bi-pencil-fill"></i> Editar</button>` : ''}
        ${isSent && !msg.apagadaParaTodos && dentroDaJanela(msg.createdAt, JANELA_APAGAR_TODOS_MS) ? `<button type="button" class="menu-opt perigo" data-acao="apagar-todos"><i class="bi bi-trash-fill"></i> Apagar para todos</button>` : ''}
        <button type="button" class="menu-opt perigo" data-acao="apagar-mim"><i class="bi bi-trash"></i> Apagar para mim</button>
      `;
            document.body.appendChild(menu);

            // Posiciona junto ao gatilho, sem sair da viewport
            const rect = targetEl.getBoundingClientRect();
            const largura = 190;
            menu.style.left =
                Math.max(8, Math.min(rect.left - 40, window.innerWidth - largura - 8)) + 'px';
            const alturaMenu = menu.offsetHeight;
            menu.style.top =
                (rect.bottom + alturaMenu > window.innerHeight
                    ? Math.max(8, rect.top - alturaMenu)
                    : rect.bottom + 4) + 'px';

            const fechar = () => menu.remove();
            setTimeout(() => document.addEventListener('click', fechar, { once: true }), 50);

            menu.querySelectorAll('.emoji-opt').forEach((opt) => {
                opt.addEventListener('click', () => {
                    this.sendReaction(msgId, opt.dataset.emoji);
                    fechar();
                });
            });

            menu.querySelectorAll('.menu-opt').forEach((opt) => {
                opt.addEventListener('click', () => {
                    const acao = opt.dataset.acao;
                    if (acao === 'responder') this.startReply(msg);
                    else if (acao === 'copiar') this.copiarTexto(msg.mensagem);
                    else if (acao === 'encaminhar')
                        this.manager.abrirModalEncaminhar([String(msg._id)]);
                    else if (acao === 'selecionar') this.entrarModoSelecao(String(msg._id));
                    else if (acao === 'editar') this.startEdit(msg);
                    else if (acao === 'apagar-todos') this.deleteMsg(msgId, 'para_todos');
                    else if (acao === 'apagar-mim') this.deleteMsg(msgId, 'para_mim');
                    fechar();
                });
            });
        }

        async copiarTexto(texto) {
            if (!texto) return;
            try {
                await navigator.clipboard.writeText(texto);
                this.manager.toast('Texto copiado.');
            } catch (e) {
                // clipboard API exige HTTPS/permissão — textarea temporária cobre o resto
                const ta = document.createElement('textarea');
                ta.value = texto;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try {
                    document.execCommand('copy');
                    this.manager.toast('Texto copiado.');
                } catch (err) {
                    this.manager.toast('Não foi possível copiar.');
                }
                ta.remove();
            }
        }

        /* ---------------- Seleção múltipla ---------------- */

        entrarModoSelecao(msgId) {
            this.modoSelecao = true;
            if (msgId) this.selecionadas.add(String(msgId));
            this.q('selectionBar').hidden = false;
            this.el.classList.add('modo-selecao');
            this.renderMessages();
            this.atualizarContadorSelecao();
        }

        sairModoSelecao() {
            this.modoSelecao = false;
            this.selecionadas.clear();
            this.q('selectionBar').hidden = true;
            this.el.classList.remove('modo-selecao');
            this.renderMessages();
        }

        atualizarContadorSelecao() {
            const n = this.selecionadas.size;
            this.q('selCount').textContent = `${n} selecionada${n === 1 ? '' : 's'}`;
        }

        copiarSelecionadas() {
            const textos = this.messages
                .filter((m) => this.selecionadas.has(String(m._id)) && m.mensagem)
                .map(
                    (m) =>
                        `[${formatTime(m.createdAt || m.dataEnvio)}] ${String(m.remetenteId) === this.manager.meuId ? 'Você' : this.targetUserData.nome || 'Contato'}: ${m.mensagem}`
                );
            if (textos.length === 0) {
                this.manager.toast('Nenhum texto nas mensagens selecionadas.');
                return;
            }
            this.copiarTexto(textos.join('\n'));
            this.sairModoSelecao();
        }

        async apagarSelecionadas() {
            const ids = [...this.selecionadas];
            if (ids.length === 0) return;
            if (!confirm(`Apagar ${ids.length} mensagem(ns) para você?`)) return;
            for (const id of ids) {
                try {
                    await fetch(`${API()}/chat-direto/mensagem/${id}?tipo=para_mim`, {
                        method: 'DELETE',
                        credentials: 'include',
                    });
                } catch (e) {
                    /* segue para as demais */
                }
            }
            this.sairModoSelecao();
            this.loadHistory();
        }

        /* ---------------- Responder / editar / apagar / reagir ---------------- */

        startReply(msg) {
            // Responder e editar disputam a mesma barra e o mesmo campo: entrar num
            // encerra o outro para os dois estados não ficarem ativos ao mesmo tempo.
            if (this.editingMsgId) this.cancelarEdicao();
            this.replyingToMsg = msg;
            this.q('replyText').textContent = `Respondendo: ${this.resumoMensagem(msg)}`;
            this.q('replyPreview').hidden = false;
            this.inputEl.focus();
        }

        cancelReply() {
            this.replyingToMsg = null;
            this.q('replyPreview').hidden = true;
        }

        startEdit(msg) {
            if (this.replyingToMsg) this.cancelReply();
            this.editingMsgId = msg._id;
            this.inputEl.value = msg.mensagem || '';
            this.inputEl.focus();
            this.el.classList.add('editando');
            this.q('replyText').textContent = 'Editando mensagem (Esc para cancelar)';
            this.q('replyPreview').hidden = false;
        }

        cancelarEdicao() {
            this.editingMsgId = null;
            this.inputEl.value = '';
            this.el.classList.remove('editando');
            this.q('replyPreview').hidden = true;
        }

        async deleteMsg(msgId, tipo) {
            const paraTodos = tipo === 'para_todos';
            if (
                !confirm(
                    paraTodos
                        ? 'Apagar esta mensagem para todos?'
                        : 'Apagar esta mensagem para você?'
                )
            )
                return;
            try {
                const res = await fetch(`${API()}/chat-direto/mensagem/${msgId}?tipo=${tipo}`, {
                    method: 'DELETE',
                    credentials: 'include',
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                this.removerOuMarcarApagada(msgId, paraTodos);
            } catch (e) {
                this.manager.toast('Erro ao apagar mensagem.');
            }
        }

        removerOuMarcarApagada(msgId, paraTodos) {
            if (paraTodos) {
                const msg = this.messages.find((m) => String(m._id) === String(msgId));
                if (msg) {
                    msg.apagadaParaTodos = true;
                    msg.mensagem = 'Esta mensagem foi apagada.';
                    msg.anexo = undefined;
                    msg.audio = undefined;
                    this.substituirBolha(msg);
                }
            } else {
                this.messages = this.messages.filter((m) => String(m._id) !== String(msgId));
                this.renderMessages();
            }
        }

        async sendReaction(msgId, emoji) {
            // Toggle local: clicar no mesmo emoji já reagido remove a reação.
            const msg = this.messages.find((m) => String(m._id) === String(msgId));
            const minha =
                msg && (msg.reacoes || []).find((r) => String(r.usuarioId) === this.manager.meuId);
            const enviar = minha && minha.emoji === emoji ? 'REMOVE' : emoji;
            try {
                const res = await fetch(`${API()}/chat-direto/reagir`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ mensagemId: msgId, emoji: enviar }),
                });
                const json = await res.json();
                if (json.success && msg) {
                    msg.reacoes = json.data || [];
                    this.substituirBolha(msg);
                }
            } catch (e) {
                /* o evento de socket ainda pode chegar */
            }
        }

        /* ---------------- Envio ---------------- */

        scrollToBottom() {
            requestAnimationFrame(() => {
                this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
            });
        }

        async sendMessage() {
            const text = this.inputEl.value.trim();

            // Edição em andamento
            if (this.editingMsgId) {
                if (!text) return;
                try {
                    const res = await fetch(`${API()}/chat-direto/mensagem/${this.editingMsgId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ novaMensagem: text }),
                    });
                    const json = await res.json();
                    if (json.success && json.data) this.substituirBolha(json.data);
                    else this.manager.toast(json.error || 'Erro ao editar mensagem.');
                } catch (e) {
                    this.manager.toast('Erro ao editar mensagem.');
                }
                this.cancelarEdicao();
                return;
            }

            // Anexos na fila são enviados com o texto como legenda da primeira peça
            if (this.pendingFiles.length > 0) {
                await this.enviarAnexosPendentes(text);
                return;
            }

            if (!text) return;

            this.inputEl.value = '';
            this.inputEl.style.height = 'auto';
            const respostaParaId = this.replyingToMsg ? this.replyingToMsg._id : undefined;
            this.cancelReply();

            try {
                const res = await fetch(`${API()}/chat-direto/enviar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        destinatarioId: this.targetUserId,
                        mensagem: text,
                        respostaParaId,
                    }),
                });
                const json = await res.json();
                if (json.success && json.data) {
                    this.appendMessage(json.data);
                    playSendSound();
                } else {
                    this.inputEl.value = text; // devolve o texto para não perder a digitação
                    this.manager.toast(json.error || 'Erro ao enviar mensagem.');
                }
            } catch (e) {
                this.inputEl.value = text;
                this.manager.toast('Erro ao enviar mensagem.');
            }
        }

        /* ---------------- Anexos com pré-visualização ---------------- */

        /**
         * Coloca os arquivos numa fila visível ANTES do envio: o usuário confere,
         * remove o que não quis e só então dispara. Antes o arquivo subia no
         * instante em que era escolhido, sem chance de revisão.
         */
        async enfileirarArquivos(files) {
            const lista = Array.from(files || []);
            if (lista.length === 0) return;

            for (const original of lista) {
                if (original.size > MAX_UPLOAD_MB * 1024 * 1024) {
                    this.manager.toast(`"${original.name}" excede ${MAX_UPLOAD_MB} MB.`);
                    continue;
                }
                const file = await comprimirImagem(original);
                const ehImagem = String(file.type || '').startsWith('image/');
                this.pendingFiles.push({
                    file,
                    ehImagem,
                    url: ehImagem ? URL.createObjectURL(file) : null,
                });
            }
            this.renderPendingFiles();
        }

        renderPendingFiles() {
            const box = this.q('attachPreview');
            if (this.pendingFiles.length === 0) {
                box.hidden = true;
                box.innerHTML = '';
                return;
            }

            box.hidden = false;
            box.innerHTML =
                this.pendingFiles
                    .map((p, i) => {
                        const nome = esc(p.file.name || 'arquivo');
                        const tamanho = formatFileSize(p.file.size);
                        const miniatura = p.ehImagem
                            ? `<img src="${p.url}" alt="${nome}" class="chat-pending-thumb">`
                            : `<i class="bi ${iconePorArquivo(p.file.name, p.file.type)} chat-pending-icon"></i>`;
                        return `
          <div class="chat-pending-item" title="${nome}">
            ${miniatura}
            <div class="chat-pending-info">
              <span class="chat-pending-nome">${nome}</span>
              <span class="chat-pending-size">${tamanho}</span>
            </div>
            <button type="button" class="chat-btn-icon chat-pending-remove" data-idx="${i}" title="Remover" aria-label="Remover"><i class="bi bi-x-lg"></i></button>
          </div>`;
                    })
                    .join('') +
                `<div class="chat-pending-dica">Pressione enviar para confirmar</div>`;

            box.querySelectorAll('.chat-pending-remove').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.idx);
                    const item = this.pendingFiles[idx];
                    if (item?.url) URL.revokeObjectURL(item.url);
                    this.pendingFiles.splice(idx, 1);
                    this.renderPendingFiles();
                });
            });
        }

        async enviarAnexosPendentes(legenda) {
            const pendentes = this.pendingFiles.slice();
            this.pendingFiles = [];
            this.renderPendingFiles();
            this.inputEl.value = '';
            this.inputEl.style.height = 'auto';

            const respostaParaId = this.replyingToMsg ? this.replyingToMsg._id : undefined;
            this.cancelReply();
            this.manager.toast(`Enviando ${pendentes.length} arquivo(s)…`);

            for (let i = 0; i < pendentes.length; i++) {
                const p = pendentes[i];
                try {
                    const anexo = await this.uploadArquivo(p.file);
                    const res = await fetch(`${API()}/chat-direto/enviar`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            destinatarioId: this.targetUserId,
                            // A legenda acompanha só o primeiro anexo, como no WhatsApp
                            mensagem: i === 0 ? legenda || '' : '',
                            anexo,
                            respostaParaId: i === 0 ? respostaParaId : undefined,
                        }),
                    });
                    const json = await res.json();
                    if (json.success && json.data) {
                        this.appendMessage(json.data);
                        playSendSound();
                    } else this.manager.toast(json.error || `Falha ao enviar ${p.file.name}.`);
                } catch (e) {
                    this.manager.toast(e.message || `Erro no envio de ${p.file.name}.`);
                } finally {
                    if (p.url) URL.revokeObjectURL(p.url);
                }
            }
        }

        /** Sobe um arquivo pela rota do chat e devolve o objeto `anexo`. */
        async uploadArquivo(file, nomeForcado) {
            const formData = new FormData();
            // destinatarioId ANTES do arquivo: o multer preenche req.body na ordem em
            // que os campos chegam, e um campo depois do arquivo não estaria
            // disponível para validações que rodem durante o parse.
            formData.append('destinatarioId', this.targetUserId);
            formData.append('arquivos', file, nomeForcado || file.name);

            const res = await fetch(`${API()}/chat-direto/upload`, {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });
            const json = await res.json();
            if (!json.success || !json.data || !json.data[0]) {
                throw new Error(json.error || 'Falha no upload do arquivo.');
            }
            return json.data[0];
        }

        /* ---------------- Gravação de áudio ---------------- */

        async startRecording() {
            if (this.isRecording) return;
            // Gravar de novo por cima de uma prévia não enviada descartava o áudio
            // antigo com a URL de blob vazando; limpa explicitamente antes.
            if (this.audioPreview) this.descartarPreviaAudio();
            const formato = formatoDeGravacao();
            if (!formato) {
                this.manager.toast('Este navegador não permite gravar áudio.');
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                // mimeType vazio = deixa o navegador escolher (caminho dos antigos).
                this.mediaRecorder = formato.mimeType
                    ? new MediaRecorder(stream, { mimeType: formato.mimeType })
                    : new MediaRecorder(stream);
                // O tipo REAL sai do recorder, não do que pedimos: se o navegador
                // ignorou a preferência, o Blob ainda é rotulado corretamente.
                this.gravacaoFormato = {
                    mimeType: (
                        this.mediaRecorder.mimeType ||
                        formato.mimeType ||
                        'audio/webm'
                    ).split(';')[0],
                    extensao: formato.extensao,
                };
                this.audioChunks = [];
                this.isRecording = true;

                this.mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) this.audioChunks.push(e.data);
                };
                this.mediaRecorder.start();

                this.q('inputRowNormal').hidden = true;
                this.q('audioPreviewBar').hidden = true;
                this.q('recorderBar').hidden = false;

                this.recSeconds = 0;
                const timerEl = this.q('recTimer');
                timerEl.textContent = '00:00';
                this.recTimerInterval = setInterval(() => {
                    this.recSeconds++;
                    timerEl.textContent = formatDuracao(this.recSeconds);
                    // Corta em 5 minutos abrindo a prévia: o usuário não perde o que já
                    // gravou, e o arquivo não estoura o limite de 5 MB do servidor.
                    if (this.recSeconds >= MAX_GRAVACAO_SEG) {
                        this.manager.toast('Limite de 5 minutos de gravação atingido.');
                        this.pararGravacaoParaPrevia();
                    }
                }, 1000);

                window.socket?.emit('chat:recording', {
                    destinatarioId: this.targetUserId,
                    isRecording: true,
                });
            } catch (e) {
                this.manager.toast('Permissão de microfone negada ou indisponível.');
            }
        }

        /** Encerra a captura e libera o microfone, sem mexer na UI. */
        encerrarCaptura() {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive')
                this.mediaRecorder.stop();
            this.mediaRecorder?.stream?.getTracks().forEach((t) => {
                t.stop();
            });
            clearInterval(this.recTimerInterval);
            this.isRecording = false;
            window.socket?.emit('chat:recording', {
                destinatarioId: this.targetUserId,
                isRecording: false,
            });
        }

        cancelRecording() {
            if (this.mediaRecorder) this.mediaRecorder.onstop = null;
            this.encerrarCaptura();
            this.audioChunks = [];
            this.q('recorderBar').hidden = true;
            this.q('audioPreviewBar').hidden = true;
            this.q('inputRowNormal').hidden = false;
        }

        /**
         * Para a gravação e abre a prévia: o áudio só sai depois que o usuário
         * ouve e confirma (requisito "ouvir antes de enviar").
         */
        pararGravacaoParaPrevia() {
            if (!this.mediaRecorder || !this.isRecording) return;
            const duracao = this.recSeconds;

            this.mediaRecorder.onstop = () => {
                const tipo = this.gravacaoFormato?.mimeType || 'audio/webm';
                const blob = new Blob(this.audioChunks, { type: tipo });
                this.audioPreview = { blob, url: URL.createObjectURL(blob), duracao };

                this.q('recorderBar').hidden = true;
                this.q('audioPreviewBar').hidden = false;
                this.q('previewTimer').textContent = formatDuracao(duracao);
            };
            this.encerrarCaptura();
        }

        tocarPreviaAudio() {
            if (!this.audioPreview) return;
            const btn = this.q('btnPlayPreview');
            if (this._previewAudio && !this._previewAudio.paused) {
                this._previewAudio.pause();
                btn.innerHTML = `<i class="bi bi-play-fill"></i>`;
                return;
            }
            this._previewAudio = new Audio(this.audioPreview.url);
            btn.innerHTML = `<i class="bi bi-pause-fill"></i>`;
            this._previewAudio.play().catch(() => {
                btn.innerHTML = `<i class="bi bi-play-fill"></i>`;
            });
            this._previewAudio.onended = () => {
                btn.innerHTML = `<i class="bi bi-play-fill"></i>`;
            };
        }

        descartarPreviaAudio() {
            if (this._previewAudio) {
                this._previewAudio.pause();
                this._previewAudio = null;
            }
            if (this.audioPreview) {
                URL.revokeObjectURL(this.audioPreview.url);
                this.audioPreview = null;
            }
            this.audioChunks = [];
            const bar = this.q('audioPreviewBar');
            if (bar) bar.hidden = true;
            const row = this.q('inputRowNormal');
            if (row) row.hidden = false;
        }

        async enviarAudioGravado() {
            if (!this.audioPreview) return;
            const { blob, duracao } = this.audioPreview;
            this.descartarPreviaAudio();

            try {
                // Nome e tipo acompanham o formato realmente gravado (webm no Chrome,
                // m4a no Safari) — o servidor confere a assinatura contra o mimetype.
                const ext = this.gravacaoFormato?.extensao || 'webm';
                const tipo = blob.type || this.gravacaoFormato?.mimeType || 'audio/webm';
                const arquivo = new File([blob], `audio_${Date.now()}.${ext}`, { type: tipo });

                if (blob.size > MAX_AUDIO_MB * 1024 * 1024) {
                    this.manager.toast(`O áudio excede ${MAX_AUDIO_MB} MB. Grave um trecho menor.`);
                    return;
                }
                const enviado = await this.uploadArquivo(arquivo);

                const res = await fetch(`${API()}/chat-direto/enviar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        destinatarioId: this.targetUserId,
                        mensagem: '',
                        audio: { url: enviado.url, duracao, gridfsId: enviado.gridfsId },
                    }),
                });
                const json = await res.json();
                if (json.success && json.data) {
                    this.appendMessage(json.data);
                    playSendSound();
                } else this.manager.toast(json.error || 'Falha ao enviar áudio.');
            } catch (e) {
                this.manager.toast(e.message || 'Falha ao enviar áudio.');
            }
        }

        /* ---------------- Recebimento ---------------- */

        appendMessage(msg) {
            if (this.messages.some((x) => String(x._id) === String(msg._id))) return;

            // Com busca ativa a lista está filtrada; a mensagem nova entraria fora
            // de contexto, então só o contador é atualizado.
            if (this.buscaAtiva) {
                if (String(msg.destinatarioId) === this.manager.meuId) this.marcarConversaLida();
                return;
            }

            // Mensagem recebida só rola se o usuário já estava no fim (não sequestra
            // a leitura do histórico); a que ele mesmo enviou sempre rola.
            const souRemetente = String(msg.remetenteId) === this.manager.meuId;
            const naBase =
                this.bodyEl.scrollHeight - this.bodyEl.scrollTop - this.bodyEl.clientHeight < 120;

            const anterior = this.messages[this.messages.length - 1];
            this.messages.push(msg);
            this.anexarBolha(msg, anterior);
            if (souRemetente || naBase) this.scrollToBottom();

            if (!souRemetente) this.anunciarParaLeitorDeTela(msg);
            if (String(msg.destinatarioId) === this.manager.meuId) this.marcarConversaLida();
        }

        /**
         * Dita a mensagem recebida na região aria-live.
         *
         * Sem isto, quem usa leitor de tela só descobria que chegou mensagem se
         * navegasse manualmente até o fim da lista — o som avisa que ALGO chegou,
         * mas não de quem nem o quê.
         */
        anunciarParaLeitorDeTela(msg) {
            const regiao = this.q('chatAnuncio');
            if (!regiao) return;

            const quem = this.targetUserData.nome || 'Contato';
            const conteudo = msg.mensagem
                ? msg.mensagem
                : msg.audio && msg.audio.url
                  ? 'enviou uma mensagem de voz'
                  : msg.anexo && msg.anexo.nome
                    ? `enviou o arquivo ${msg.anexo.nome}`
                    : 'enviou um anexo';

            // Texto idêntico em sequência não é reanunciado por parte dos leitores;
            // limpar antes garante que duas mensagens iguais sejam ditas as duas vezes.
            regiao.textContent = '';
            requestAnimationFrame(() => {
                regiao.textContent = `${quem}: ${conteudo}`;
            });
        }

        /**
         * Insere UMA bolha no fim da lista.
         *
         * Antes cada mensagem recebida chamava `renderMessages()`, que reescrevia
         * o innerHTML inteiro e religava os listeners de todas as bolhas — numa
         * conversa com 200 mensagens carregadas, uma mensagem nova repintava as
         * 200. Aqui só o nó novo entra no DOM.
         */
        anexarBolha(msg, anterior) {
            // Primeira mensagem da conversa: ainda há o estado vazio na tela.
            if (!anterior) {
                this.renderMessages();
                return;
            }

            const dia = labelDia(msg.createdAt || msg.dataEnvio);
            const diaAnterior = labelDia(anterior.createdAt || anterior.dataEnvio);

            const fragmento = document.createElement('div');
            fragmento.innerHTML =
                (dia && dia !== diaAnterior
                    ? `<div class="chat-day-divider"><span>${esc(dia)}</span></div>`
                    : '') + this.renderSingleBubble(msg);

            const novos = [...fragmento.children];
            novos.forEach((el) => {
                this.bodyEl.appendChild(el);
            });
            // Só o que acabou de entrar recebe listeners.
            novos.forEach((el) => {
                this.bindBubbleEvents(el);
            });
        }

        /** Confirmação de leitura chegando do outro lado. */
        marcarLidasLocalmente(ids) {
            const alvo = new Set((ids || []).map(String));
            let mudou = false;
            this.messages.forEach((m) => {
                if (alvo.has(String(m._id)) && !m.lida) {
                    m.lida = true;
                    m.status = 'lida';
                    this.substituirBolha(m);
                    mudou = true;
                }
            });
            return mudou;
        }
    }

    /* ------------------------------------------------------------------ *
     * Gerenciador global
     * ------------------------------------------------------------------ */

    class ChatManager {
        constructor() {
            this.activeWindows = new Map();
            this.meuId = this.getMeuId();
            this.createContainer();
            this.bindSocketEvents();
        }

        getMeuId() {
            try {
                const user =
                    (window.auth && window.auth.getCurrentUser && window.auth.getCurrentUser()) ||
                    JSON.parse(sessionStorage.getItem('currentUser') || '{}');
                const id = String(user.id || user._id || '');
                if (id) this.meuId = id;
                return id;
            } catch (e) {
                return '';
            }
        }

        createContainer() {
            let c = document.getElementById('chatWindowsContainer');
            if (!c) {
                c = document.createElement('div');
                c.id = 'chatWindowsContainer';
                c.className = 'chat-windows-container';
                document.body.appendChild(c);
            }
            this.container = c;
        }

        openChat(targetUserId, targetUserData) {
            if (!targetUserId) return;
            const uid = String(targetUserId);

            // O id só é conhecido depois do login carregar; revalida a cada abertura.
            if (!this.meuId) this.meuId = this.getMeuId();

            if (this.activeWindows.has(uid)) {
                const win = this.activeWindows.get(uid);
                if (win.isMinimized) win.toggleMinimize();
                if (targetUserData) {
                    win.targetUserData = { ...win.targetUserData, ...targetUserData };
                    win.atualizarStatusHeader();
                }
                win.inputEl.focus();
                return win;
            }

            // No celular a janela ocupa a tela toda: manter várias abertas empilharia
            // conversas invisíveis uma sobre a outra.
            if (window.matchMedia('(max-width: 768px)').matches) {
                this.activeWindows.forEach((w) => {
                    w.close();
                });
            }

            const instance = new ChatWindowInstance(uid, targetUserData, this);
            this.activeWindows.set(uid, instance);
            this.avisarSobreArmazenamento();
            return instance;
        }

        /**
         * Aviso LGPD, uma única vez por dispositivo.
         *
         * As conversas ficam gravadas no servidor e podem citar alunos pelo nome —
         * quem escreve precisa saber disso ANTES de escrever, não depois. Some
         * sozinho e não bloqueia a conversa; a ciência fica registrada localmente.
         */
        avisarSobreArmazenamento() {
            try {
                if (localStorage.getItem(PREF_AVISO_LGPD) === '1') return;
            } catch (e) {
                return;
            } // sem storage, não insiste a cada abertura
            if (document.getElementById('chatAvisoLgpd')) return;

            const aviso = document.createElement('div');
            aviso.id = 'chatAvisoLgpd';
            aviso.className = 'chat-aviso-lgpd';
            aviso.setAttribute('role', 'status');
            aviso.innerHTML = `
        <i class="bi bi-shield-lock-fill"></i>
        <div class="chat-aviso-lgpd-texto">
          <strong>Suas mensagens ficam registradas</strong>
          <small>As conversas são armazenadas no sistema da escola e podem ser
          consultadas em auditoria. Evite dados sensíveis desnecessários sobre alunos.</small>
        </div>
        <button type="button" class="chat-aviso-lgpd-ok">Entendi</button>`;

            aviso.querySelector('.chat-aviso-lgpd-ok').addEventListener('click', () => {
                try {
                    localStorage.setItem(PREF_AVISO_LGPD, '1');
                } catch (e) {
                    /* storage off */
                }
                aviso.remove();
            });

            // O banner de push (js/push-notifications.js) ancora no mesmo ponto —
            // rodapé centralizado. Sem desviar, os dois se sobrepõem e o de baixo
            // fica ilegível. Quem chega depois sobe.
            if (document.getElementById('push-enable-banner')) {
                aviso.classList.add('acima-do-banner');
            }

            document.body.appendChild(aviso);

            // `requestAnimationFrame` não dispara em aba de segundo plano: o aviso
            // era anexado e ficava em opacity:0 para sempre — presente no DOM,
            // invisível na tela. Ler offsetWidth força o reflow que a transição
            // precisa, sem depender do agendador de quadros.
            void aviso.offsetWidth;
            aviso.classList.add('visivel');
        }

        removeWindow(targetUserId) {
            this.activeWindows.delete(String(targetUserId));
        }

        /**
         * Manda toda janela aberta buscar o que perdeu durante a queda do socket.
         * Também atualiza a lista de quem está online, porque a presença é
         * mantida em memória no servidor e o refCount foi zerado na desconexão.
         */
        resincronizarTudo() {
            this.activeWindows.forEach((w) => {
                w.resincronizar();
            });
            if (window.refreshProfsOnline) window.refreshProfsOnline();
        }

        sincronizarIconeSom() {
            const classe = somAtivo() ? 'bi bi-volume-up' : 'bi bi-volume-mute';
            this.activeWindows.forEach((w) => {
                const i = w.q('btnToggleSom')?.querySelector('i');
                if (i) i.className = classe;
            });
            this.toast(
                somAtivo() ? 'Som das notificações ativado.' : 'Som das notificações desativado.'
            );
        }

        /** Aviso discreto e efêmero — não bloqueia como o `alert`. */
        toast(texto) {
            let t = document.getElementById('chatToast');
            if (!t) {
                t = document.createElement('div');
                t.id = 'chatToast';
                t.className = 'chat-toast';
                document.body.appendChild(t);
            }
            t.textContent = texto;
            t.classList.add('visivel');
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => t.classList.remove('visivel'), 2600);
        }

        /**
         * Aviso de mensagem nova quando a conversa não está à vista.
         *
         * Só o som não diz QUEM mandou, e com a aba em segundo plano não diz nada.
         * Aqui vão três camadas: som, um cartão clicável que abre a conversa e —
         * apenas se a permissão JÁ existir — a notificação do sistema.
         */
        notificarMensagem(msg, opcoes) {
            // `som: false` quando quem chamou já tocou (mensagem em conversa aberta),
            // para não disparar o mesmo aviso duas vezes.
            if (!opcoes || opcoes.som !== false) playNotificationSound();

            const nome = msg.remetenteNome || 'Nova mensagem';
            const previa = msg.mensagem
                ? msg.mensagem.slice(0, 90)
                : msg.audio && msg.audio.url
                  ? '🎤 Mensagem de voz'
                  : msg.anexo && msg.anexo.nome
                    ? `📎 ${msg.anexo.nome}`
                    : 'Enviou um anexo';

            this.mostrarCartaoMensagem(String(msg.remetenteId), nome, previa);

            // Notificação do sistema só com a aba fora de foco e permissão já
            // concedida — o chat não pede permissão por conta própria, isso é
            // decisão do usuário no fluxo de notificações do sistema.
            if (
                document.hidden &&
                'Notification' in window &&
                Notification.permission === 'granted'
            ) {
                try {
                    const n = new Notification(nome, {
                        body: previa,
                        tag: `chat-${msg.remetenteId}`,
                        renotify: false,
                    });
                    n.onclick = () => {
                        window.focus();
                        this.openChat(String(msg.remetenteId), { nome });
                        n.close();
                    };
                } catch (e) {
                    /* alguns navegadores exigem service worker */
                }
            }
        }

        /** Cartão clicável no canto — clicar abre a conversa daquele remetente. */
        mostrarCartaoMensagem(remetenteId, nome, previa) {
            let box = document.getElementById('chatAlertas');
            if (!box) {
                box = document.createElement('div');
                box.id = 'chatAlertas';
                box.className = 'chat-alertas';
                document.body.appendChild(box);
            }

            // Um cartão por remetente: rajada de mensagens não empilha a tela.
            box.querySelector(`[data-de="${CSS.escape(remetenteId)}"]`)?.remove();

            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'chat-alerta';
            card.dataset.de = remetenteId;
            card.innerHTML = `
        <i class="bi bi-chat-dots-fill chat-alerta-icone"></i>
        <span class="chat-alerta-texto">
          <strong>${esc(nome)}</strong>
          <small>${esc(previa)}</small>
        </span>`;

            card.addEventListener('click', () => {
                this.openChat(remetenteId, { nome });
                card.remove();
            });

            box.appendChild(card);

            // Mesmo motivo do aviso LGPD, e aqui o efeito é pior: este cartão só é
            // mostrado quando a aba está em segundo plano (ver notificarMensagem),
            // que é justamente quando o navegador congela o requestAnimationFrame.
            // O aviso de mensagem nova entrava no DOM e nunca aparecia; 6 segundos
            // depois o setTimeout o removia sem que ninguém tivesse visto nada.
            void card.offsetWidth;
            card.classList.add('visivel');

            setTimeout(() => {
                card.classList.remove('visivel');
                setTimeout(() => card.remove(), 300);
            }, 6000);
        }

        /* ---------------- Encaminhar ---------------- */

        async abrirModalEncaminhar(mensagemIds) {
            if (!mensagemIds || mensagemIds.length === 0) return;
            document.getElementById('chatForwardModal')?.remove();

            const modal = document.createElement('div');
            modal.id = 'chatForwardModal';
            modal.className = 'chat-forward-modal';
            modal.innerHTML = `
        <div class="chat-forward-box" role="dialog" aria-modal="true" aria-label="Encaminhar mensagens">
          <div class="chat-forward-header">
            <strong>Encaminhar ${mensagemIds.length} mensagem(ns)</strong>
            <button type="button" class="chat-btn-icon" id="fwdClose" aria-label="Fechar"><i class="bi bi-x-lg"></i></button>
          </div>
          <div class="chat-forward-list" id="fwdList"><div class="chat-loading">Carregando contatos…</div></div>
          <div class="chat-forward-footer">
            <button type="button" class="chat-forward-btn" id="fwdSend" disabled><i class="bi bi-send-fill"></i> Encaminhar</button>
          </div>
        </div>`;
            document.body.appendChild(modal);

            const fechar = () => modal.remove();
            modal.querySelector('#fwdClose').addEventListener('click', fechar);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) fechar();
            });

            const lista = modal.querySelector('#fwdList');
            const btnEnviar = modal.querySelector('#fwdSend');
            const escolhidos = new Set();

            try {
                const res = await fetch(`${API()}/professores/status-online`, {
                    credentials: 'include',
                });
                const json = await res.json();
                const contatos = (json.data || []).filter(
                    (c) => String(c.userId) !== String(this.meuId)
                );

                if (contatos.length === 0) {
                    lista.innerHTML = `<div class="chat-vazio">Nenhum contato disponível.</div>`;
                    return;
                }

                lista.innerHTML = contatos
                    .map((c) => {
                        const foto = resolverFoto(c.foto);
                        const inicial = esc((c.nome || '?').slice(0, 2).toUpperCase());
                        return `
            <label class="chat-forward-item">
              <input type="checkbox" value="${esc(String(c.userId))}">
              ${
                  foto
                      ? `<img src="${esc(foto)}" alt="" class="chat-forward-avatar">`
                      : `<span class="chat-forward-avatar chat-forward-avatar-fallback">${inicial}</span>`
}
              <span class="chat-forward-nome">${esc(c.nome || 'Usuário')}<small>${esc(c.cargo || '')}</small></span>
            </label>`;
                    })
                    .join('');

                lista.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
                    chk.addEventListener('change', () => {
                        if (chk.checked) escolhidos.add(chk.value);
                        else escolhidos.delete(chk.value);
                        btnEnviar.disabled = escolhidos.size === 0;
                    });
                });
            } catch (e) {
                lista.innerHTML = `<div class="chat-erro">Não foi possível carregar os contatos.</div>`;
                return;
            }

            btnEnviar.addEventListener('click', async () => {
                btnEnviar.disabled = true;
                btnEnviar.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando…';
                try {
                    const res = await fetch(`${API()}/chat-direto/encaminhar`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ mensagemIds, destinatarioIds: [...escolhidos] }),
                    });
                    const json = await res.json();
                    // `aviso` só vem quando a moderação reteve alguma das selecionadas.
                    // Sem ele, encaminhar 3 e ver o toast dizer "2" é sumiço sem
                    // explicação. O backend manda o texto pronto e genérico de propósito:
                    // não diz qual mensagem nem por quê, porque quem encaminha pode nem
                    // ser o autor do conteúdo retido.
                    const sucesso =
                        `${json.total} mensagem(ns) encaminhada(s).` +
                        (json.aviso ? ` ${json.aviso}` : '');
                    this.toast(json.success ? sucesso : json.error || 'Falha ao encaminhar.');
                } catch (e) {
                    this.toast('Falha ao encaminhar.');
                }
                fechar();
                this.activeWindows.forEach((w) => {
                    if (w.sairModoSelecao && w.modoSelecao) w.sairModoSelecao();
                });
            });
        }

        /* ---------------- Socket.IO ---------------- */

        bindSocketEvents() {
            const checkSocket = () => {
                const s = window.socket;
                if (!s || typeof s.on !== 'function') {
                    setTimeout(checkSocket, 2000);
                    return;
                }
                if (this._socketBound === s) return;
                this._socketBound = s;

                // Reconexão: o 'connect' também dispara na PRIMEIRA conexão, quando
                // o loadHistory de cada janela já vai buscar tudo. Só a partir da
                // segunda vez é que houve uma janela de tempo sem entrega.
                s.on('connect', () => {
                    if (this._jaConectou) this.resincronizarTudo();
                    this._jaConectou = true;
                });

                // Se o socket cai enquanto a janela está aberta, avisa em vez de
                // deixar a conversa parecendo simplesmente silenciosa.
                s.on('disconnect', (motivo) => {
                    // 'io client disconnect' é saída deliberada (logout, close) — não é falha.
                    if (motivo !== 'io client disconnect' && this.activeWindows.size > 0) {
                        this.toast('Conexão perdida. Reconectando…');
                    }
                });

                s.on('chat:mensagem', (msg) => {
                    const meuId = this.meuId || this.getMeuId();
                    const souDestinatario = String(msg.destinatarioId) === meuId;
                    const outroId = souDestinatario
                        ? String(msg.remetenteId)
                        : String(msg.destinatarioId);

                    const win = this.activeWindows.get(outroId);
                    if (win) {
                        win.appendMessage(msg);
                        if (souDestinatario) {
                            // Som sempre que chega algo para mim, inclusive com a conversa
                            // aberta e em foco — é o retorno de que a mensagem chegou.
                            playNotificationSound();
                            // Janela minimizada ou aba em segundo plano: a mensagem entrou na
                            // lista, mas o usuário não está olhando — precisa do cartão e da
                            // notificação do sistema, não só do som.
                            if (win.isMinimized || document.hidden) {
                                this.notificarMensagem(msg, { som: false });
                                win.el.classList.add('tem-novidade');
                                setTimeout(() => win.el.classList.remove('tem-novidade'), 3000);
                            }
                        }
                    } else if (souDestinatario) {
                        this.notificarMensagem(msg);
                        if (window.refreshProfsOnline) window.refreshProfsOnline();
                    }
                });

                s.on('chat:typing', ({ remetenteId, isTyping }) => {
                    this.activeWindows.get(String(remetenteId))?.onTyping(isTyping);
                });

                s.on('chat:recording', ({ remetenteId, isRecording }) => {
                    this.activeWindows.get(String(remetenteId))?.onRecording(isRecording);
                });

                s.on('chat:editada', (msg) => {
                    const outroId =
                        String(msg.remetenteId) === this.meuId
                            ? String(msg.destinatarioId)
                            : String(msg.remetenteId);
                    this.activeWindows.get(outroId)?.substituirBolha(msg);
                });

                s.on('chat:apagada', ({ mensagemId, paraTodos }) => {
                    this.activeWindows.forEach((w) => {
                        w.removerOuMarcarApagada(mensagemId, paraTodos);
                    });
                });

                s.on('chat:reacao', ({ mensagemId, reacoes }) => {
                    this.activeWindows.forEach((w) => {
                        const msg = w.messages.find((m) => String(m._id) === String(mensagemId));
                        if (msg) {
                            msg.reacoes = reacoes || [];
                            w.substituirBolha(msg);
                        }
                    });
                });

                // Leitura: uma mensagem específica ou a conversa inteira
                s.on('chat:lida', ({ mensagemId, destinatarioId }) => {
                    this.activeWindows
                        .get(String(destinatarioId))
                        ?.marcarLidasLocalmente([mensagemId]);
                });

                s.on('chat:lidas', ({ mensagemIds, destinatarioId }) => {
                    this.activeWindows
                        .get(String(destinatarioId))
                        ?.marcarLidasLocalmente(mensagemIds);
                });

                // Presença do contato reflete direto no cabeçalho da conversa aberta
                s.on('presence:professor', ({ userId, online, status }) => {
                    this.activeWindows
                        .get(String(userId))
                        ?.onPresenca(status || (online ? 'online' : 'offline'));
                });
            };

            checkSocket();
        }
    }

    function iniciar() {
        window.chatManager = new ChatManager();
        // Atalho estável para outros módulos abrirem uma conversa.
        window.abrirChatCom = (userId, dados) => window.chatManager.openChat(userId, dados);
        abrirConversaDaUrl();
    }

    /**
     * `?chat=<usuarioId>` abre a conversa daquele remetente.
     *
     * É o destino do clique na notificação do celular: sem isso o push levava
     * o usuário ao dashboard genérico e ele ainda tinha que procurar quem
     * mandou a mensagem. O parâmetro sai da barra de endereços depois de usado
     * para o F5 não reabrir a janela indefinidamente.
     */
    function abrirConversaDaUrl() {
        let id;
        try {
            id = new URLSearchParams(window.location.search).get('chat');
        } catch (e) {
            return;
        }
        if (!id) return;

        window.chatManager.openChat(String(id));

        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('chat');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        } catch (e) {
            /* history indisponível */
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
