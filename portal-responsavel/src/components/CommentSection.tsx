import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Comentario } from '../types';
import { getComentarios, addComentario, deleteComentario, updateComentario, getMe, uploadAudio } from '../services/apiService';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Send, Trash2, Reply, Pencil, Check, X, Mic } from 'lucide-react';
import { socket } from '../services/socket';
import VoiceRecorder from './VoiceRecorder';

interface Props {
  comunicadoId: string;
  onCountChange?: (delta: number) => void;
}

const normalizeId = (id: unknown) => (id == null ? '' : String(id));

const CommentSection: React.FC<Props> = ({ comunicadoId, onCountChange }) => {
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [currentUserId, setCurrentUserId] = useState('');
  const [showRecorder, setShowRecorder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    window.setTimeout(() => setFeedback(null), 3500);
  };

  const loadComments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getComentarios(comunicadoId);
      setComentarios(data);
    } catch (error) {
      console.error('Error loading comments:', error);
      showFeedback('error', 'Não foi possível carregar os comentários.');
    } finally {
      setLoading(false);
    }
  }, [comunicadoId]);

  useEffect(() => {
    loadComments();
    getMe()
      .then((user) => setCurrentUserId(normalizeId(user.id)))
      .catch(() => {});
  }, [loadComments]);

  useEffect(() => {
    const sameComunicado = (id: unknown) => normalizeId(id) === normalizeId(comunicadoId);

    const handleNew = (data: { comunicadoId: string; comentario: Comentario }) => {
      if (!sameComunicado(data.comunicadoId)) return;
      setComentarios(prev => {
        if (prev.some(c => normalizeId(c._id) === normalizeId(data.comentario._id))) return prev;
        onCountChange?.(1);
        return [...prev, data.comentario];
      });
    };

    const handleRemove = (data: { id: string; comunicadoId: string }) => {
      if (!sameComunicado(data.comunicadoId)) return;
      setComentarios(prev => prev.filter(c => normalizeId(c._id) !== normalizeId(data.id)));
      onCountChange?.(-1);
    };

    const handleUpdate = (data: { comentario: Comentario }) => {
      if (!sameComunicado(data.comentario.comunicadoId)) return;
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
  }, [comunicadoId, onCountChange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || submitting) return;

    setSubmitting(true);
    try {
      const added = await addComentario(comunicadoId, newComment.trim(), replyTo);
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
      const added = await addComentario(comunicadoId, undefined, replyTo, audioData.url);
      
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

    return (
      <div key={comment._id} className={`flex gap-3 group ${isReply ? '' : 'space-y-1'}`}>
        <img
          src={comment.usuarioFoto || '/img/default-avatar.png'}
          className={`${isReply ? 'w-6 h-6' : 'w-8 h-8'} rounded-full border border-white/10 object-cover`}
          alt={comment.usuarioNome}
        />
        <div className="flex-1 min-w-0">
          <div className={`${isReply ? 'bg-zinc-800/50 p-2.5' : 'bg-zinc-800/80 p-3'} rounded-2xl rounded-tl-none`}>
            <div className="flex justify-between items-start gap-2 mb-1">
              <span className="text-xs font-bold text-white truncate">{comment.usuarioNome}</span>
              <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                {formatDistanceToNow(new Date(comment.dataCriacao), { locale: ptBR, addSuffix: true })}
              </span>
            </div>
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-primary"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleEditSave(comment._id)} className="text-xs font-bold text-accent-primary inline-flex items-center gap-1">
                    <Check size={12} /> Salvar
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-xs font-bold text-zinc-500 inline-flex items-center gap-1">
                    <X size={12} /> Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {comment.texto && (
                  <p className={`${isReply ? 'text-xs' : 'text-sm'} text-zinc-300 break-words whitespace-pre-wrap`}>{comment.texto}</p>
                )}
                {comment.audioUrl && (
                  <div className="flex items-center gap-2 bg-black/20 rounded-full pr-4 pl-1 py-1 max-w-xs">
                     <audio src={comment.audioUrl} controls className="h-8 w-full filter invert hue-rotate-180 brightness-200" />
                  </div>
                )}
              </div>
            )}
          </div>

          {!isEditing && (
            <div className="flex flex-wrap gap-3 mt-1 px-1">
              <button
                type="button"
                onClick={() => { setReplyTo(comment._id); inputRef.current?.focus(); }}
                className="text-[10px] font-bold text-zinc-500 hover:text-white"
              >
                Responder
              </button>
              {isAuthor && comment.texto && (
                <button
                  type="button"
                  onClick={() => { setEditingId(comment._id); setEditText(comment.texto || ''); }}
                  className="text-[10px] font-bold text-zinc-500 hover:text-white inline-flex items-center gap-1"
                >
                  <Pencil size={10} /> Editar
                </button>
              )}
              {isAuthor && (
                <button
                  type="button"
                  onClick={() => handleDelete(comment._id)}
                  className="text-[10px] font-bold text-red-400 hover:text-red-300 inline-flex items-center gap-1"
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

  return (
    <div className="space-y-4">
      {feedback && (
        <div className={`rounded-lg px-3 py-2 text-xs font-semibold ${
          feedback.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
            : 'bg-red-500/10 border border-red-500/20 text-red-300'
        }`}>
          {feedback.text}
        </div>
      )}

      {showRecorder ? (
        <VoiceRecorder 
          onSend={handleVoiceSend} 
          onCancel={() => setShowRecorder(false)} 
        />
      ) : (
        <form onSubmit={handleSubmit} className="relative">
          {replyTo && (
            <div className="absolute -top-6 left-0 flex items-center gap-2 text-[10px] text-accent-primary">
              <Reply size={10} /> Respondendo comentário...
              <button type="button" onClick={() => setReplyTo(null)} className="underline">Cancelar</button>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowRecorder(true)}
              className="bg-white/5 hover:bg-white/10 text-zinc-400 p-2.5 rounded-xl transition-colors border border-white/5"
              title="Gravar áudio"
            >
              <Mic size={18} />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={replyTo ? 'Escreva sua resposta...' : 'Escreva um comentário...'}
              className="flex-1 bg-zinc-800 border border-white/5 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-primary"
            />
            <button
              type="submit"
              disabled={!newComment.trim() || submitting}
              className="bg-accent-primary hover:bg-accent-primary/80 disabled:opacity-50 text-black px-3 py-2 rounded-xl transition-colors"
              aria-label="Enviar comentário"
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      )}

      <div className="space-y-4 mt-2">
        {loading ? (
          <p className="text-xs text-zinc-500 text-center py-4">Carregando comentários...</p>
        ) : rootComments.length === 0 ? (
          <p className="text-xs text-zinc-500 text-center py-4">Seja o primeiro a comentar.</p>
        ) : (
          rootComments.map(comment => (
            <div key={comment._id} className="space-y-3">
              {renderComment(comment)}
              <div className="ml-11 space-y-3 border-l border-white/5 pl-4">
                {getReplies(comment._id).map(reply => renderComment(reply, true))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CommentSection;
