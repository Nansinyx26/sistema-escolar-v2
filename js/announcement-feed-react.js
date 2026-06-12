/**
 * js/announcement-feed-react.js
 * Sistema Social de Comunicados 3.0 - Comentários, Reações e Notificações Realtime
 */

(function () {
    'use strict';

    function waitForLibs(callback) {
        if (window.React && window.ReactDOM && (window.Motion || window.framerMotion)) {
            callback();
        } else {
            setTimeout(function () { waitForLibs(callback); }, 80);
        }
    }

    waitForLibs(function () {
        const { createElement: h, useState, useEffect, useRef, useMemo } = window.React;
        const { createRoot } = window.ReactDOM;
        const motion = (window.Motion || window.framerMotion).motion;
        const AnimatePresence = (window.Motion || window.framerMotion).AnimatePresence;

        const BASE_URL = window.API_BASE_URL || '/api';
        const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🎉'];

        // --- HELPERS ---
        const normalizeId = (id) => (id == null ? '' : String(id));

        const getCsrfToken = () => {
            const match = document.cookie.match(/csrf_token=([^;]+)/);
            return match ? decodeURIComponent(match[1]) : null;
        };

        const apiHeaders = (extra) => {
            const headers = { 'Content-Type': 'application/json', ...(extra || {}) };
            const csrf = getCsrfToken();
            if (csrf) headers['X-CSRF-Token'] = csrf;
            return headers;
        };

        const showFeedToast = (message, type) => {
            if (window.showToast) {
                window.showToast(message, type === 'error' ? 'error' : 'success');
                return;
            }
            const el = document.createElement('div');
            el.className = `feed-toast feed-toast-${type}`;
            el.textContent = message;
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 3200);
        };
        const formatDate = (date) => {
            if (!date) return '';
            return new Date(date).toLocaleString('pt-BR', { 
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
            });
        };

        const getBadgeClass = (perfil) => {
            if (perfil === 'diretor' || perfil === 'admin') return 'badge-diretor';
            if (perfil === 'professor') return 'badge-professor';
            return 'badge-responsavel';
        };

        const getRoleName = (perfil) => {
            if (perfil === 'diretor' || perfil === 'admin') return 'Direção';
            if (perfil === 'professor') return 'Professor';
            return 'Responsável';
        };

        const stripHtml = (html) => {
            const tmp = document.createElement("DIV");
            tmp.innerHTML = html;
            return tmp.textContent || tmp.innerText || "";
        };

        // --- COMPONENTE DE VOZ (TTS) ---
        function SpeakButton({ text }) {
            const [speaking, setSpeaking] = useState(false);

            const toggleSpeak = () => {
                // Garante que window.speak está disponível (carregado pelo sidebar-voice.js)
                if (typeof window.speak !== 'function') {
                    console.warn('[SpeakButton] window.speak não está disponível.');
                    return;
                }

                if (speaking) {
                    // Para reprodução em andamento
                    if (window.speechSynthesis) window.speechSynthesis.cancel();
                    setSpeaking(false);
                    return;
                }

                const cleanText = stripHtml(text);
                if (!cleanText || !cleanText.trim()) return;

                setSpeaking(true);
                window.speak(cleanText);

                // Observa o fim da reprodução via evento global
                const onEnd = () => {
                    setSpeaking(false);
                    window.removeEventListener('tts:ended', onEnd);
                };
                window.addEventListener('tts:ended', onEnd);

                // Segurança: reseta após 60s caso o evento não dispare
                setTimeout(() => {
                    setSpeaking(false);
                    window.removeEventListener('tts:ended', onEnd);
                }, 60000);
            };

            return h('button', {
                className: `action-btn-legacy${speaking ? ' active' : ''}`,
                onClick: toggleSpeak,
                title: speaking ? 'Parar leitura' : 'Ouvir comunicado',
                'aria-label': speaking ? 'Parar leitura' : 'Ouvir comunicado em voz alta'
            },
                h('i', { className: `bi ${speaking ? 'bi-stop-fill' : 'bi-megaphone'}` }),
                speaking ? ' Parar' : ' Ouvir'
            );
        }

        let currentPlayingAudio = null;

        // --- COMPONENTE DE REAÇÕES PREMIUM ---
        function ReactionArea({ messageId, initialReactions, type = 'post' }) {
            const [reactions, setReactions] = useState(initialReactions || []);
            const [showPicker, setShowPicker] = useState(false);
            const user = window.auth?.getCurrentUser();
            const pickerRef = useRef(null);

            useEffect(() => {
                const handleClickOutside = (e) => {
                    if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false);
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, []);

            useEffect(() => {
                const socket = window.socket;
                if (socket) {
                    const handleReaction = (data) => {
                        if (data.messageId === messageId) {
                            setReactions(data.allReactions || []);
                        }
                    };
                    socket.on('reaction:add', handleReaction);
                    socket.on('reaction:update', handleReaction);
                    socket.on('reaction:remove', handleReaction);
                    return () => {
                        socket.off('reaction:add');
                        socket.off('reaction:update');
                        socket.off('reaction:remove');
                    };
                }
            }, [messageId]);

            const submitReaction = async (emoji) => {
                try {
                    const res = await fetch(`${BASE_URL}/reactions`, {
                        method: 'POST',
                        headers: apiHeaders(),
                        body: JSON.stringify({ messageId, emoji }),
                        credentials: 'include'
                    });
                    const json = await res.json();
                    if (json.success) {
                        setReactions(json.allReactions || []);
                        setShowPicker(false);
                    }
                } catch (e) { console.error('Erro ao reagir:', e); }
            };

            const removeReaction = async () => {
                try {
                    const res = await fetch(`${BASE_URL}/reactions/${messageId}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    const json = await res.json();
                    if (json.success) setReactions(json.allReactions || []);
                } catch (e) { console.error('Erro ao remover reação:', e); }
            };

            const reactionSummary = useMemo(() => {
                const summary = {};
                reactions.forEach(r => {
                    if (!summary[r.emoji]) summary[r.emoji] = 0;
                    summary[r.emoji]++;
                });
                return summary;
            }, [reactions]);

            const myReaction = reactions.find(r => normalizeId(r.senderId) === normalizeId(user?.id || user?._id));

            return h('div', { className: 'reaction-container-premium' },
                h('button', { 
                    className: `action-btn-legacy ${myReaction ? 'active' : ''}`,
                    onClick: () => setShowPicker(!showPicker)
                }, 
                    h('i', { className: 'bi bi-hand-thumbs-up' }),
                    myReaction ? ' Reagido' : ' Reagir'
                ),
                h(AnimatePresence, null,
                    showPicker && h(motion.div, {
                        ref: pickerRef,
                        initial: { opacity: 0, y: 10, scale: 0.9 },
                        animate: { opacity: 1, y: 0, scale: 1 },
                        exit: { opacity: 0, y: 10, scale: 0.9 },
                        className: 'emoji-picker-premium'
                    },
                        EMOJIS.map(e => h('button', {
                            key: e, className: 'emoji-btn-premium',
                            onClick: () => submitReaction(e)
                        }, e))
                    )
                ),
                Object.keys(reactionSummary).length > 0 && h('div', { className: 'social-status-bar' },
                    Object.entries(reactionSummary).map(([emoji, count]) => h('div', {
                        key: emoji,
                        className: `reaction-pill-premium ${myReaction?.emoji === emoji ? 'active' : ''}`,
                        onClick: myReaction?.emoji === emoji ? removeReaction : () => submitReaction(emoji)
                    }, emoji, h('span', null, count)))
                )
            );
        }

        // --- COMPONENTE DE COMENTÁRIO INDIVIDUAL (Recursivo) ---
        function CommentItem({ comment, allComments, onReply, onDelete, onEdit }) {
            const [showReplyInput, setShowReplyInput] = useState(false);
            const [replyText, setReplyText] = useState('');
            const [isEditing, setIsEditing] = useState(false);
            const [editText, setEditText] = useState(comment.texto);
            const user = window.auth?.getCurrentUser();
            const isAuthor = user && normalizeId(user.id || user._id) === normalizeId(comment.usuarioId);
            const isDirector = user && (user.perfil === 'diretor' || user.perfil === 'admin');

            const replies = allComments.filter(c => normalizeId(c.parentId) === normalizeId(comment._id));

            const handleReplySubmit = () => {
                if (!replyText.trim()) return;
                onReply(comment._id, replyText);
                setReplyText('');
                setShowReplyInput(false);
            };

            const handleEditSubmit = () => {
                if (!editText.trim()) return;
                onEdit(comment._id, editText);
                setIsEditing(false);
            };

            return h('div', { className: 'comment-container-node' },
                h('div', { className: 'comment-item-premium' },
                    h('img', { src: comment.usuarioFoto || '/img/default-avatar.png', className: 'comment-avatar-premium' }),
                    h('div', { className: 'comment-content-premium' },
                        h('div', { className: 'comment-meta-premium' },
                            h('span', { className: 'comment-author-premium' }, comment.usuarioNome),
                            h('span', { className: `profile-badge-premium ${getBadgeClass(comment.usuarioPerfil)}` }, getRoleName(comment.usuarioPerfil)),
                            h('span', { className: 'comment-date-legacy', style: { marginLeft: 'auto' } }, formatDate(comment.dataCriacao))
                        ),
                        isEditing ? h('div', null,
                            h('textarea', { 
                                className: 'comment-input-legacy', 
                                value: editText, 
                                onChange: e => setEditText(e.target.value),
                                style: { width: '100%', minHeight: '60px', marginTop: '0.5rem' }
                            }),
                            h('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
                                h('button', { className: 'comment-action-btn', onClick: handleEditSubmit }, 'Salvar'),
                                h('button', { className: 'comment-action-btn', onClick: () => setIsEditing(false) }, 'Cancelar')
                            )
                        ) : h('p', { className: 'comment-text-premium' }, comment.texto),
                        
                        h('div', { className: 'comment-actions-premium' },
                            h('button', { className: 'comment-action-btn', onClick: () => setShowReplyInput(!showReplyInput) }, 'Responder'),
                            isAuthor && h('button', { className: 'comment-action-btn', onClick: () => setIsEditing(true) }, 'Editar'),
                            (isAuthor || isDirector) && h('button', { className: 'comment-action-btn delete', onClick: () => onDelete(comment._id) }, 'Excluir'),
                            h(ReactionArea, { messageId: comment._id, type: 'comment', initialReactions: [] })
                        )
                    )
                ),
                showReplyInput && h('div', { className: 'reply-input-wrapper' },
                    h('input', { 
                        className: 'comment-input-legacy', 
                        placeholder: 'Escreva uma resposta...', 
                        value: replyText, 
                        onChange: e => setReplyText(e.target.value),
                        onKeyPress: e => e.key === 'Enter' && handleReplySubmit()
                    }),
                    h('button', { className: 'comment-submit-legacy', onClick: handleReplySubmit }, h('i', { className: 'bi bi-send' }))
                ),
                replies.length > 0 && h('div', { className: 'replies-thread' },
                    replies.map(r => h(CommentItem, { key: r._id, comment: r, allComments, onReply, onDelete, onEdit }))
                )
            );
        }

        // --- SEÇÃO DE COMENTÁRIOS COMPLETA ---
        function CommentSection({ comunicadoId, initialComments, onCountUpdate }) {
            const [comments, setComments] = useState(initialComments || []);
            const [mainText, setMainText] = useState('');
            const [loading, setLoading] = useState(true);
            const [submitting, setSubmitting] = useState(false);
            const [feedback, setFeedback] = useState(null);
            const inputRef = useRef(null);

            const loadComments = async () => {
                try {
                    setLoading(true);
                    const res = await fetch(`${BASE_URL}/comentarios/comunicado/${comunicadoId}`, { credentials: 'include' });
                    const json = await res.json();
                    if (json.success && Array.isArray(json.data)) {
                        setComments(json.data);
                    }
                } catch (e) {
                    console.error('Erro ao carregar comentários:', e);
                    setFeedback({ type: 'error', text: 'Não foi possível carregar os comentários.' });
                } finally {
                    setLoading(false);
                }
            };

            useEffect(() => {
                loadComments();
                setTimeout(() => inputRef.current?.focus(), 60);
            }, [comunicadoId]);

            useEffect(() => {
                if (feedback) {
                    const timer = setTimeout(() => setFeedback(null), 3500);
                    return () => clearTimeout(timer);
                }
            }, [feedback]);

            useEffect(() => {
                const socket = window.socket;
                if (socket) {
                    const sameComunicado = (id) => normalizeId(id) === normalizeId(comunicadoId);

                    const handleNew = (data) => {
                        if (sameComunicado(data.comunicadoId)) {
                            setComments(prev => {
                                if (prev.some(c => normalizeId(c._id) === normalizeId(data.comentario._id))) return prev;
                                return [...prev, data.comentario];
                            });
                            onCountUpdate(1);
                        }
                    };
                    const handleRemove = (data) => {
                        if (sameComunicado(data.comunicadoId)) {
                            setComments(prev => prev.filter(c => normalizeId(c._id) !== normalizeId(data.id)));
                            onCountUpdate(-1);
                        }
                    };
                    const handleUpdate = (data) => {
                        if (sameComunicado(data.comentario.comunicadoId)) {
                            setComments(prev => prev.map(c => normalizeId(c._id) === normalizeId(data.comentario._id) ? data.comentario : c));
                        }
                    };
                    socket.on('comentario:new', handleNew);
                    socket.on('comentario:remove', handleRemove);
                    socket.on('comentario:update', handleUpdate);
                    return () => {
                        socket.off('comentario:new', handleNew);
                        socket.off('comentario:remove', handleRemove);
                        socket.off('comentario:update', handleUpdate);
                    };
                }
            }, [comunicadoId]);

            const postComment = async (parentId = null, texto) => {
                if (!texto || !texto.trim() || submitting) return;
                setSubmitting(true);
                setFeedback(null);
                try {
                    const res = await fetch(`${BASE_URL}/comentarios`, {
                        method: 'POST',
                        headers: apiHeaders(),
                        body: JSON.stringify({ comunicadoId, texto: texto.trim(), parentId }),
                        credentials: 'include'
                    });
                    const json = await res.json();
                    if (json.success) {
                        if (parentId === null) setMainText('');
                        setComments(prev => {
                            if (prev.some(c => normalizeId(c._id) === normalizeId(json.data._id))) return prev;
                            if (!window.socket || !window.socket.connected) onCountUpdate(1);
                            return [...prev, json.data];
                        });
                        setFeedback({ type: 'success', text: parentId ? 'Resposta enviada!' : 'Comentário enviado!' });
                        showFeedToast(parentId ? 'Resposta enviada!' : 'Comentário enviado!', 'success');
                    } else {
                        const msg = json.error || 'Erro ao enviar comentário.';
                        setFeedback({ type: 'error', text: msg });
                        showFeedToast(msg, 'error');
                    }
                } catch (e) {
                    console.error('Erro ao postar:', e);
                    setFeedback({ type: 'error', text: 'Erro de conexão ao enviar comentário.' });
                    showFeedToast('Erro de conexão ao enviar comentário.', 'error');
                } finally {
                    setSubmitting(false);
                }
            };

            const deleteComment = async (id) => {
                if (!confirm('Deseja excluir este comentário?')) return;
                try {
                    const res = await fetch(`${BASE_URL}/comentarios/${id}`, {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: apiHeaders()
                    });
                    const json = await res.json();
                    if (json.success) {
                        setComments(prev => prev.filter(c => normalizeId(c._id) !== normalizeId(id)));
                        onCountUpdate(-1);
                        showFeedToast('Comentário excluído.', 'success');
                    } else {
                        showFeedToast(json.error || 'Erro ao excluir comentário.', 'error');
                    }
                } catch (e) {
                    console.error('Erro ao excluir:', e);
                    showFeedToast('Erro ao excluir comentário.', 'error');
                }
            };

            const editComment = async (id, texto) => {
                try {
                    const res = await fetch(`${BASE_URL}/comentarios/${id}`, {
                        method: 'PUT',
                        headers: apiHeaders(),
                        body: JSON.stringify({ texto }),
                        credentials: 'include'
                    });
                    const json = await res.json();
                    if (json.success) {
                        setComments(prev => prev.map(c => normalizeId(c._id) === normalizeId(id) ? json.data : c));
                        showFeedToast('Comentário atualizado!', 'success');
                    } else {
                        showFeedToast(json.error || 'Erro ao editar comentário.', 'error');
                    }
                } catch (e) {
                    console.error('Erro ao editar:', e);
                    showFeedToast('Erro ao editar comentário.', 'error');
                }
            };

            const rootComments = comments.filter(c => !c.parentId);

            return h('div', { className: 'comments-section-legacy' },
                feedback && h('div', { className: `comment-feedback comment-feedback-${feedback.type}` }, feedback.text),
                loading ? h('p', { className: 'comments-loading-text' }, 'Carregando comentários...') :
                h('div', { className: 'comments-list-premium' },
                    rootComments.length === 0
                        ? h('p', { className: 'comments-empty-text' }, 'Seja o primeiro a comentar.')
                        : rootComments.map(c => h(CommentItem, {
                            key: c._id, comment: c, allComments: comments,
                            onReply: postComment, onDelete: deleteComment, onEdit: editComment
                        }))
                ),
                h('div', { className: 'comment-form-legacy' },
                    h('textarea', {
                        ref: inputRef,
                        className: 'comment-input-legacy',
                        placeholder: 'Escreva um comentário público...',
                        value: mainText,
                        onChange: e => setMainText(e.target.value),
                        onKeyDown: e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                postComment(null, mainText);
                            }
                        },
                        rows: 2
                    }),
                    h('button', {
                        className: 'comment-submit-legacy',
                        onClick: () => postComment(null, mainText),
                        disabled: !mainText.trim() || submitting
                    }, h('i', { className: `bi ${submitting ? 'bi-hourglass-split' : 'bi-send-fill'}` }))
                )
            );
        }

        // --- CARD DE COMUNICADO ---
        function AnnouncementCard({ comunicado }) {
            const [showComments, setShowComments] = useState(false);
            const [commentsCount, setCommentsCount] = useState(comunicado.comentariosCount || 0);

            const toggleComments = () => setShowComments(prev => !prev);
            
            const isImportante = comunicado.prioridade === 'Importante' || comunicado.prioridade === 'Urgente';

            return h(motion.div, {
                layout: true,
                initial: { opacity: 0, y: 20 },
                animate: { opacity: 1, y: 0 },
                className: `comunicado-card-premium ${isImportante ? 'card-priority-' + comunicado.prioridade.toLowerCase() : ''}`
            },
                h('div', { className: 'card-header-premium' },
                    h('img', { src: comunicado.diretorFoto || '/img/default-avatar.png', className: 'card-avatar-premium' }),
                    h('div', { className: 'author-info-mural' },
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                            h('h4', { className: 'card-author-premium' }, comunicado.diretorNome || "Direção"),
                            h('span', { className: `category-pill-card cat-${(comunicado.categoria || 'Direção').toLowerCase()}` }, comunicado.categoria || 'Direção')
                        ),
                        h('span', { className: 'card-date-premium' }, formatDate(comunicado.dataCriacao))
                    ),
                    isImportante && h('div', { className: `priority-badge pulse-${comunicado.prioridade.toLowerCase()}` }, 
                        h('i', { className: 'bi bi-exclamation-triangle-fill' }), 
                        comunicado.prioridade
                    )
                ),
                h('div', { className: 'card-body-premium' },
                    h('h3', { className: 'card-title-premium' }, comunicado.titulo),
                    h('div', { className: 'card-text-premium', dangerouslySetInnerHTML: { __html: comunicado.conteudo } }),
                    
                    // Grade de Imagens
                    comunicado.imagens?.length > 0 && h('div', { className: `card-media-grid-premium grid-${Math.min(comunicado.imagens.length, 3)}` },
                        comunicado.imagens.map((img, i) => h('img', { key: i, src: img, className: 'media-item-premium', onClick: () => window.open(img, '_blank') }))
                    ),

                    // Anexos de Arquivo (PDF/Docs)
                    comunicado.arquivos?.length > 0 && h('div', { className: 'card-files-container' },
                        comunicado.arquivos.map((file, i) => h('a', { 
                            key: i, href: file.url, target: '_blank', className: 'file-attachment-card' 
                        }, 
                            h('i', { className: 'bi bi-file-earmark-pdf' }),
                            h('span', null, file.nome)
                        ))
                    )
                ),
                h('div', { className: 'card-actions-premium' },
                    h(ReactionArea, { messageId: comunicado._id, initialReactions: [] }),
                    h(SpeakButton, { text: `${comunicado.titulo}. ${stripHtml(comunicado.conteudo)}` }),
                    h('button', {
                        className: `action-btn-legacy ${showComments ? 'active' : ''}`,
                        type: 'button',
                        onClick: toggleComments
                    },
                        h('i', { className: 'bi bi-chat-left-text' }),
                        h('span', { className: 'count-badge-legacy' }, commentsCount),
                        showComments ? ' Ocultar' : ' Comentários'
                    )
                ),
                showComments && h('div', { className: 'comments-wrapper-premium' },
                    h(CommentSection, {
                        comunicadoId: comunicado._id,
                        initialComments: comunicado.comentariosData || [],
                        onCountUpdate: (delta) => setCommentsCount(prev => Math.max(0, prev + delta))
                    })
                )
            );
        }

        // --- COMPONENTE DE HEADER DO FEED ---
        function FeedHeader({ onSearch, onFilterChange, currentFilter }) {
            const [localQuery, setLocalQuery] = useState('');
            const categories = ['Todos', 'Direção', 'Acadêmico', 'Financeiro', 'Geral'];

            const handleSearchChange = (e) => {
                const val = e.target.value;
                setLocalQuery(val);
                onSearch(val);
            };

            return h('div', { className: 'feed-header-social' },
                h('div', { className: 'feed-header-top' },
                    h('div', { className: 'feed-title-wrapper' },
                        h('h2', { className: 'feed-main-title' }, 'Mural da Comunidade'),
                        h('p', { className: 'feed-subtitle' }, 'Fique por dentro das novidades da sua escola')
                    ),
                    h('div', { className: 'feed-search-wrapper' },
                        h('i', { className: 'bi bi-search search-icon' }),
                        h('input', {
                            type: 'text',
                            placeholder: 'Buscar no mural...',
                            value: localQuery,
                            onChange: handleSearchChange,
                            className: 'feed-search-input'
                        })
                    )
                ),
                h('div', { className: 'feed-filters-bar' },
                    categories.map(cat => h('button', {
                        key: cat,
                        className: `feed-filter-tab ${currentFilter === cat ? 'active' : ''}`,
                        onClick: () => onFilterChange(cat)
                    }, cat))
                )
            );
        }

        // --- FEED PRINCIPAL ---
        function AnnouncementFeed() {
            const [comunicados, setComunicados] = useState([]);
            const [loading, setLoading] = useState(true);
            const [filters, setFilters] = useState({ busca: '', categoria: 'Todos' });
            const [error, setError] = useState(null);

            const loadFeed = async (f = filters) => {
                try {
                    setLoading(true);
                    setError(null);
                    const url = new URL(`${BASE_URL}/comunicados`, window.location.origin);
                    if (f.busca) url.searchParams.append('busca', f.busca);
                    if (f.categoria !== 'Todos') url.searchParams.append('categoria', f.categoria);

                    const res = await fetch(url, { credentials: 'include' });
                    const json = await res.json();
                    if (json.success) {
                        setComunicados(json.data);
                    } else {
                        throw new Error(json.error || 'Erro ao carregar avisos');
                    }
                } catch (e) { 
                    console.error('Erro ao carregar feed:', e);
                    setError('Não foi possível conectar ao servidor para carregar o mural.');
                } finally { 
                    setLoading(false); 
                }
            };

            useEffect(() => {
                loadFeed();
                
                const socket = window.socket;
                if (socket) {
                    const handleNew = (comunicado) => {
                        // Check if it matches existing filters locally
                        const matchesBusca = !filters.busca || 
                            comunicado.titulo.toLowerCase().includes(filters.busca.toLowerCase()) || 
                            comunicado.conteudo.toLowerCase().includes(filters.busca.toLowerCase());
                        const matchesCat = filters.categoria === 'Todos' || comunicado.categoria === filters.categoria;
                        
                        if (matchesBusca && matchesCat) {
                            setComunicados(prev => [comunicado, ...prev]);
                        }
                    };
                    const handleRemove = (data) => setComunicados(prev => prev.filter(c => c._id !== data.id));
                    
                    socket.on('comunicado:new', handleNew);
                    socket.on('comunicado:remove', handleRemove);
                    return () => {
                        socket.off('comunicado:new', handleNew);
                        socket.off('comunicado:remove', handleRemove);
                    };
                }
            }, [filters]);

            const handleSearch = (q) => {
                // Debounce manual ou via setFilters que dipara useEffect
                setFilters(prev => ({ ...prev, busca: q }));
            };

            const handleCategory = (cat) => {
                setFilters(prev => ({ ...prev, categoria: cat }));
            };

            return h('section', { className: 'announcement-feed-premium' },
                h(FeedHeader, { 
                    onSearch: handleSearch, 
                    onFilterChange: handleCategory, 
                    currentFilter: filters.categoria 
                }),
                
                loading && comunicados.length === 0 ? h('div', { className: 'feed-loading-premium' }, 
                    h('div', { className: 'spinner-premium' }),
                    h('p', null, 'Atualizando seu feed...')
                ) :
                error ? h('div', { className: 'feed-error-premium' },
                    h('i', { className: 'bi bi-wifi-off' }),
                    h('p', null, error),
                    h('button', { onClick: () => loadFeed(), className: 'btn-retry' }, 'Tentar novamente')
                ) :
                comunicados.length === 0 ? h('div', { className: 'feed-empty-social' }, 
                    h('div', { className: 'empty-artwork' }, 
                        h('i', { className: 'bi bi-chat-square-dots' })
                    ),
                    h('h3', null, 'O mural está vazio'),
                    h('p', null, 'Não encontramos avisos com os filtros selecionados.')
                ) :
                h('div', { className: 'feed-list-premium' },
                    h(AnimatePresence, { mode: 'popLayout' },
                        comunicados.map(c => h(AnnouncementCard, { key: c._id, comunicado: c }))
                    )
                )
            );
        }

        const container = document.getElementById('announcement-feed-container');
        if (container) createRoot(container).render(h(AnnouncementFeed, null));
    });
})();
