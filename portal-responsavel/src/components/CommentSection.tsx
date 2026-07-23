import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTTS } from '../hooks/useTTS';
import { Comentario } from '../types';
import { getComentarios, addComentario, deleteComentario, updateComentario, getMe, uploadAudio } from '../services/apiService';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Send, Trash2, Reply, Pencil, Check, X, Mic } from 'lucide-react';
import { socket } from '../services/socket';
import VoiceRecorder from './VoiceRecorder';
import AudioPlayer from './AudioPlayer';
import { getPhotoUrl } from '../utils/photoUtils';

interface Props {
  comunicadoId?: string;
  notificacaoId?: string;
  onCountChange?: (delta: number) => void;
}

const normalizeId = (id: unknown) => (id == null ? '' : String(id));

const CommentSection: React.FC<Props> = ({ comunicadoId, notificacaoId, onCountChange }) => {
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentUserPhoto, setCurrentUserPhoto] = useState('');
  const [showRecorder, setShowRecorder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    window.setTimeout(() => setFeedback(null), 3500);
  };

  const loadComments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getComentarios(comunicadoId, notificacaoId);
      setComentarios(data);
    } catch (error) {
      console.error('Error loading comments:', error);
      showFeedback('error', 'Não foi possível carregar os comentários.');
    } finally {
      setLoading(false);
    }
  }, [comunicadoId, notificacaoId]);

  useEffect(() => {
    loadComments();
    getMe()
      .then((user) => {
        setCurrentUserId(normalizeId(user.id));
        setCurrentUserPhoto(user.foto || user.fotoGoogle || '');
      })
      .catch(() => {});
  }, [loadComments]);

  useEffect(() => {
    const isTarget = (cId: unknown, nId: unknown) => {
        if (comunicadoId && normalizeId(cId) === normalizeId(comunicadoId)) return true;
        if (notificacaoId && normalizeId(nId) === normalizeId(notificacaoId)) return true;
        return false;
    };

    const handleNew = (data: { comunicadoId?: string; notificacaoId?: string; comentario: Comentario }) => {
      if (!isTarget(data.comunicadoId, data.notificacaoId)) return;
      setComentarios(prev => {
        if (prev.some(c => normalizeId(c._id) === normalizeId(data.comentario._id))) return prev;
        onCountChange?.(1);
        return [...prev, data.comentario];
      });
    };

    const handleRemove = (data: { id: string; comunicadoId?: string; notificacaoId?: string }) => {
      if (!isTarget(data.comunicadoId, data.notificacaoId)) return;
      setComentarios(prev => prev.filter(c => normalizeId(c._id) !== normalizeId(data.id)));
      onCountChange?.(-1);
    };

    const handleUpdate = (data: { comentario: Comentario }) => {
      if (!isTarget(data.comentario.comunicadoId, data.comentario.notificacaoId)) return;
      setComentarios(prev =>
        prev.map(c => normalizeId(c._id) === normalizeId(data.comentario._id) ? data.comentario : c)
      );
    };

    socket.on('comentario:new', handleNew);
    socket.on('comentario:remove', handleRemove);
    socket.on('comentario:update', handleUpdate);

    return () => {
      socket.off('comentario:new', handleNew);
      socket.off('comentario:remove', handleRemove);
      socket.off('comentario:update', handleUpdate);
    };
  }, [comunicadoId, notificacaoId, onCountChange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || submitting) return;

    setSubmitting(true);
    try {
      const added = await addComentario(comunicadoId, newComment.trim(), replyTo, undefined, notificacaoId);
      setComentarios(prev => {
        if (prev.some(c => normalizeId(c._id) === normalizeId(added._id))) return prev;
        if (!socket.connected) onCountChange?.(1);
        return [...prev, added];
      });
      setNewComment('');
      setReplyTo(null);
      showFeedback('success', replyTo ? 'Resposta enviada!' : 'Comentário enviado!');
    } catch (error) {
      showFeedback('error', 'Erro ao enviar comentário.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoiceSend = async (blob: Blob) => {
    setSubmitting(true);
    try {
      const audioData = await uploadAudio(blob);
      const added = await addComentario(comunicadoId, undefined, replyTo, audioData.url, notificacaoId);
      
      setComentarios(prev => {
        if (prev.some(c => normalizeId(c._id) === normalizeId(added._id))) return prev;
        if (!socket.connected) onCountChange?.(1);
        return [...prev, added];
      });
      
      setShowRecorder(false);
      setReplyTo(null);
      showFeedback('success', 'Mensagem de voz enviada!');
    } catch (error) {
      console.error('Error sending voice comment:', error);
      showFeedback('error', 'Erro ao enviar áudio.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Excluir comentário?')) return;
    try {
      await deleteComentario(id);
      setComentarios(prev => prev.filter(c => normalizeId(c._id) !== normalizeId(id)));
      if (!socket.connected) onCountChange?.(-1);
      showFeedback('success', 'Comentário excluído.');
    } catch (error) {
      showFeedback('error', 'Erro ao excluir comentário.');
    }
  };

  const handleEditSave = async (id: string) => {
    if (!editText.trim()) return;
    try {
      const updated = await updateComentario(id, editText.trim());
      setComentarios(prev => prev.map(c => normalizeId(c._id) === normalizeId(id) ? updated : c));
      setEditingId(null);
      setEditText('');
      showFeedback('success', 'Comentário atualizado!');
    } catch (error) {
      showFeedback('error', 'Erro ao editar comentário.');
    }
  };

  const rootComments = comentarios.filter(c => !c.parentId);
  const getReplies = (parentId: string) =>
    comentarios.filter(c => normalizeId(c.parentId) === normalizeId(parentId));

  const renderComment = (comment: Comentario, isReply = false) => {
    const isAuthor = currentUserId && normalizeId(comment.usuarioId) === currentUserId;
    const isEditing = editingId === comment._id;
    const userPhoto = getPhotoUrl(comment.usuarioFoto);
    const avatarSize = isReply ? '24px' : '32px';
    const avatarFontSize = isReply ? '10px' : '0.75rem';

    return (
      <div key={comment._id} style={{ display: 'flex', gap: '12px', marginBottom: isReply ? '0' : '4px' }}>
        {userPhoto && !userPhoto.includes('default-avatar.png') ? (
          <img
            src={userPhoto}
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: '50%',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              objectFit: 'cover',
              flexShrink: 0,
            }}
            alt={comment.usuarioNome}
            onError={(e) => { (e.target as HTMLImageElement).src = '/img/default-avatar.png'; }}
          />
        ) : (
          <div
            style={{
              width: avatarSize,
              height: avatarSize,
              minWidth: avatarSize,
              minHeight: avatarSize,
              borderRadius: '50%',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: avatarFontSize,
              background: 'linear-gradient(135deg, #6366f1, #a855f7)',
              flexShrink: 0,
            }}
          >
            {(comment.usuarioNome || '?').split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            background: isReply ? 'rgba(39, 39, 42, 0.5)' : 'rgba(39, 39, 42, 0.8)',
            padding: isReply ? '10px' : '12px',
            borderRadius: '0 16px 16px 16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '0.825rem', fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{comment.usuarioNome}</span>
              <span style={{ fontSize: '0.75rem', color: '#71717a', whiteSpace: 'nowrap' }}>
                {formatDistanceToNow(new Date(comment.dataCriacao), { locale: ptBR, addSuffix: true })}
              </span>
            </div>
            {isEditing ? (
              <div>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#18181b',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '0.875rem',
                    color: '#fff',
                    outline: 'none',
                    resize: 'vertical',
                    marginBottom: '8px',
                  }}
                  rows={2}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => handleEditSave(comment._id)} style={{
                    fontSize: '0.75rem', fontWeight: 700, color: '#10b981', background: 'none', border: 'none', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                  }}>
                    <Check size={12} /> Salvar
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} style={{
                    fontSize: '0.75rem', fontWeight: 700, color: '#71717a', background: 'none', border: 'none', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                  }}>
                    <X size={12} /> Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {comment.texto && (
                  <p style={{
                    fontSize: isReply ? '0.875rem' : '1rem',
                    color: '#d4d4d8',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                    lineHeight: 1.6,
                  }}>{comment.texto}</p>
                )}
                {comment.audioUrl && (
                  <div style={{ marginTop: '8px', width: '100%', minWidth: 0 }}>
                    <AudioPlayer src={comment.audioUrl} compact={isReply} />
                  </div>
                )}
              </div>
            )}
          </div>

          {!isEditing && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '4px', paddingLeft: '4px' }}>
              <button
                type="button"
                onClick={() => { setReplyTo(comment._id); inputRef.current?.focus(); }}
                style={{
                  fontSize: '10px', fontWeight: 700, color: '#71717a', background: 'none', border: 'none', cursor: 'pointer',
                }}
              >
                Responder
              </button>
              {isAuthor && comment.texto && (
                <button
                  type="button"
                  onClick={() => { setEditingId(comment._id); setEditText(comment.texto || ''); }}
                  style={{
                    fontSize: '10px', fontWeight: 700, color: '#71717a', background: 'none', border: 'none', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  <Pencil size={10} /> Editar
                </button>
              )}
              {isAuthor && (
                <button
                  type="button"
                  onClick={() => handleDelete(comment._id)}
                  style={{
                    fontSize: '10px', fontWeight: 700, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  <Trash2 size={10} /> Excluir
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const { speak } = useTTS();

  const readAllComments = () => {
    if (comentarios.length === 0) return;
    const textToRead = comentarios
      .filter(c => !c.parentId)
      .map(c => `${c.usuarioNome} comentou: ${c.texto}`)
      .join('. ');
    if (textToRead) {
      speak(`Lendo ${comentarios.length} comentários. ${textToRead}`);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#fff', margin: 0 }}>Comentários</h4>
        {comentarios.length > 0 && (
          <button
            onClick={readAllComments}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              padding: '4px 12px',
              fontSize: '0.75rem',
              color: '#d4d4d8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <i className="bi bi-volume-up-fill"></i> Ouvir Comentários
          </button>
        )}
      </div>
      {feedback && (
        <div style={{
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '0.75rem',
          fontWeight: 600,
          marginBottom: '16px',
          background: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${feedback.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
          color: feedback.type === 'success' ? '#6ee7b7' : '#fca5a5',
        }}>
          {feedback.text}
        </div>
      )}

      {showRecorder ? (
        <VoiceRecorder 
          onSend={handleVoiceSend} 
          onCancel={() => setShowRecorder(false)} 
        />
      ) : (
        <form onSubmit={handleSubmit} style={{ position: 'relative', marginBottom: '16px' }}>
          {replyTo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: '#10b981', marginBottom: '8px' }}>
              <Reply size={10} /> Respondendo comentário...
              <button type="button" onClick={() => setReplyTo(null)} style={{ textDecoration: 'underline', background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', fontSize: '10px' }}>Cancelar</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setShowRecorder(true)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#a1a1aa',
                padding: '10px',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s',
              }}
              title="Gravar áudio"
            >
              <Mic size={18} />
            </button>
            <div style={{ flexShrink: 0 }}>
              {currentUserPhoto ? (
                <img
                  src={getPhotoUrl(currentUserPhoto)}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    objectFit: 'cover',
                  }}
                  alt="Sua foto"
                  onError={(e) => { (e.target as HTMLImageElement).src = '/img/default-avatar.png'; }}
                />
              ) : (
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                  }}
                >
                  <i className="bi bi-person"></i>
                </div>
              )}
            </div>
            <input
              ref={inputRef}
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={replyTo ? 'Escreva sua resposta...' : 'Escreva um comentário...'}
              style={{
                flex: 1,
                background: '#27272a',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '10px 12px',
                fontSize: '1rem',
                color: '#fff',
                outline: 'none',
                minWidth: '120px',
              }}
            />
            <button
              type="submit"
              disabled={!newComment.trim() || submitting}
              style={{
                background: '#10b981',
                color: '#000',
                padding: '10px 12px',
                borderRadius: '12px',
                border: 'none',
                cursor: (!newComment.trim() || submitting) ? 'default' : 'pointer',
                opacity: (!newComment.trim() || submitting) ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'opacity 0.2s',
              }}
              aria-label="Enviar comentário"
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      )}

      <div style={{ marginTop: '8px' }}>
        {loading ? (
          <p style={{ fontSize: '0.75rem', color: '#71717a', textAlign: 'center', padding: '16px 0' }}>Carregando comentários...</p>
        ) : rootComments.length === 0 ? (
          <p style={{ fontSize: '0.75rem', color: '#71717a', textAlign: 'center', padding: '16px 0' }}>Seja o primeiro a comentar.</p>
        ) : (
          rootComments.map(comment => (
            <div key={comment._id} style={{ marginBottom: '12px' }}>
              {renderComment(comment)}
              <div style={{ marginLeft: '44px', borderLeft: '1px solid rgba(255, 255, 255, 0.05)', paddingLeft: '16px', marginTop: '12px' }}>
                {getReplies(comment._id).map(reply => (
                  <div key={reply._id} style={{ marginBottom: '12px' }}>
                    {renderComment(reply, true)}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CommentSection;
