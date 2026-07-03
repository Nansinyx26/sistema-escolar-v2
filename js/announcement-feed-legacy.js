/* js/announcement-feed-legacy.js */
(function() {
    const feedContainer = document.getElementById('announcement-feed-container');
    if (!feedContainer) return;

    let currentUser = null;
    let socket = null;

    async function init() {
        if (window.auth) {
            currentUser = window.auth.getCurrentUser();
        }

        // Setup HTML base
        feedContainer.innerHTML = `
            <section class="announcement-feed-section">
                <div class="feed-header">
                    <h2 class="feed-title">
                        <i class="bi bi-megaphone-fill" style="color: var(--primary-color);"></i>
                        Comunicados da Direção
                    </h2>
                </div>
                <div id="feed-list" class="feed-list">
                    <div class="empty-message" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                        <div class="spinner-border text-primary" role="status"></div>
                        <p style="margin-top: 1rem;">Carregando comunicados...</p>
                    </div>
                </div>
            </section>
        `;

        await carregarComunicados();
        setupSocket();
    }

    async function carregarComunicados() {
        try {
            const res = await fetch(`${API_BASE_URL}/comunicados`, { credentials: 'include' });
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
                renderFeed(json.data);
            } else {
                mostrarErro("Não foi possível carregar os comunicados.");
            }
        } catch (e) {
            console.error('[Feed Legacy] Erro ao carregar:', e);
            mostrarErro("Erro de conexão com o servidor.");
        }
    }

    function renderFeed(comunicados) {
        const list = document.getElementById('feed-list');
        if (!list) return;

        if (comunicados.length === 0) {
            list.innerHTML = '<div class="empty-message" style="text-align: center; padding: 3rem; color: var(--text-secondary);">Nenhum comunicado disponível.</div>';
            return;
        }

        list.innerHTML = '';
        comunicados.forEach(c => {
            const card = createComunicadoCard(c);
            list.appendChild(card);
        });
    }

    function createComunicadoCard(c) {
        const div = document.createElement('div');
        div.className = 'comunicado-card';
        div.dataset.id = c._id;
        
        const dataStr = new Date(c.criadoEm).toLocaleString('pt-BR');
        const userReactions = c.reacoes || [];
        const hasReacted = currentUser && userReactions.some(r => r.usuarioId === currentUser.id || r.usuarioId === currentUser._id);
        
        div.innerHTML = `
            <div class="comunicado-meta">
                <span>Direção — ${c.autorNome || 'Escola Jaguari'}</span>
                <span class="comunicado-data">${dataStr}</span>
            </div>
            <h3 class="comunicado-titulo">${c.titulo}</h3>
            <div class="comunicado-texto">${c.texto}</div>
            ${c.imagens && c.imagens.length > 0 ? `
                <div class="comunicado-media">
                    ${c.imagens.map(img => `<img src="${img}" class="media-item" onclick="window.open('${img}', '_blank')">`).join('')}
                </div>
            ` : ''}
            
            <div class="comunicado-actions">
                <button class="action-btn ${hasReacted ? 'active' : ''}" onclick="window.LegacyFeed.toggleReacao('${c._id}')">
                    <i class="bi ${hasReacted ? 'bi-heart-fill' : 'bi-heart'}"></i>
                    <span class="reacoes-count">${userReactions.length}</span>
                </button>
                <button class="action-btn" onclick="window.LegacyFeed.toggleComentarios('${c._id}')">
                    <i class="bi bi-chat-text"></i>
                    <span>${(c.comentarios && c.comentarios.length) || 0}</span>
                </button>
            </div>

            <div id="comentarios-${c._id}" class="comentarios-section" style="display: none;">
                <div class="comentarios-list">
                    ${(c.comentarios || []).map(com => `
                        <div class="comentario-item">
                            <div class="comentario-header">
                                <span class="comentario-autor">${com.autorNome}</span>
                                <span class="comentario-data">${new Date(com.criadoEm).toLocaleDateString()}</span>
                            </div>
                            <div class="comentario-texto">${com.texto || ''}</div>
                            ${com.audioUrl ? `
                                <div class="comentario-audio">
                                    <audio src="${com.audioUrl}" controls controlsList="nodownload" class="mini-audio-player"></audio>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
                <div class="comentario-input-group">
                    <input type="text" placeholder="Escreva um comentário..." class="comentario-input" id="input-${c._id}">
                    <button class="btn btn-primary btn-sm" onclick="window.LegacyFeed.enviarComentario('${c._id}')">
                        <i class="bi bi-send"></i>
                    </button>
                </div>
            </div>
        `;

        return div;
    }

    function setupSocket() {
        if (typeof io === 'undefined') return;
        
        socket = io(API_BASE_URL.replace('/api', ''), {
            withCredentials: true,
            transports: ['websocket', 'polling']
        });

        socket.on('novo-comunicado', (comunicado) => {
            const list = document.getElementById('feed-list');
            if (list) {
                // Se era vazio, limpa a mensagem
                if (list.querySelector('.empty-message')) list.innerHTML = '';
                const card = createComunicadoCard(comunicado);
                card.style.opacity = '0';
                card.style.transform = 'translateY(20px)';
                list.prepend(card);
                setTimeout(() => {
                    card.style.transition = 'all 0.5s ease';
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                }, 50);
            }
        });

        socket.on('nova-reacao', ({ comunicadoId, reacoes }) => {
            const card = document.querySelector(`.comunicado-card[data-id="${comunicadoId}"]`);
            if (card) {
                const countSpan = card.querySelector('.reacoes-count');
                if (countSpan) countSpan.textContent = reacoes.length;
                
                const heartBtn = card.querySelector('.bi-heart, .bi-heart-fill').parentElement;
                const userHasReacted = currentUser && reacoes.some(r => r.usuarioId === (currentUser.id || currentUser._id));
                
                if (userHasReacted) {
                    heartBtn.classList.add('active');
                    heartBtn.querySelector('i').className = 'bi bi-heart-fill';
                } else {
                    heartBtn.classList.remove('active');
                    heartBtn.querySelector('i').className = 'bi bi-heart';
                }
            }
        });

        socket.on('novo-comentario', ({ comunicadoId, comentario }) => {
            const card = document.querySelector(`.comunicado-card[data-id="${comunicadoId}"]`);
            if (card) {
                const list = card.querySelector('.comentarios-list');
                if (list) {
                    const comDiv = document.createElement('div');
                    comDiv.className = 'comentario-item';
                    comDiv.innerHTML = `
                        <div class="comentario-header">
                            <span class="comentario-autor">${comentario.autorNome}</span>
                            <span class="comentario-data">Agora</span>
                        </div>
                        <div class="comentario-texto">${comentario.texto || ''}</div>
                        ${comentario.audioUrl ? `
                            <div class="comentario-audio">
                                <audio src="${comentario.audioUrl}" controls controlsList="nodownload" class="mini-audio-player"></audio>
                            </div>
                        ` : ''}
                    `;
                    list.appendChild(comDiv);
                }
                
                const chatCount = card.querySelector('.bi-chat-text').nextElementSibling;
                if (chatCount) chatCount.textContent = parseInt(chatCount.textContent || '0') + 1;
            }
        });
    }

    // Export variables and functions to window for onclick handlers
    window.LegacyFeed = {
        toggleComentarios: (id) => {
            const el = document.getElementById(`comentarios-${id}`);
            if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
        },
        enviarComentario: async (id) => {
            const input = document.getElementById(`input-${id}`);
            const texto = input?.value?.trim();
            if (!texto) return;

            try {
                const res = await fetch(`${API_BASE_URL}/comunicados/${id}/comentarios`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ texto }),
                    credentials: 'include'
                });
                if (res.ok) {
                    input.value = '';
                }
            } catch (e) {
                console.error('[Feed Legacy] Erro ao comentar:', e);
            }
        },
        toggleReacao: async (id) => {
            try {
                await fetch(`${API_BASE_URL}/comunicados/${id}/reagir`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tipo: 'heart' }),
                    credentials: 'include'
                });
            } catch (e) {
                console.error('[Feed Legacy] Erro ao reagir:', e);
            }
        }
    };

    function mostrarErro(msg) {
        const list = document.getElementById('feed-list');
        if (list) list.innerHTML = `<div class="alert alert-danger" style="margin: 2rem;">${msg}</div>`;
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
