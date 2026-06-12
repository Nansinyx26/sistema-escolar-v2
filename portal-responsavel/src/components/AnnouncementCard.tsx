import React, { useState, useEffect } from 'react';
import { Comunicado } from '../types';
import ReactionArea from './ReactionArea';
import CommentSection from './CommentSection';
import SpeakButton from './SpeakButton';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MessageCircle } from 'lucide-react';
import { socket } from '../services/socket';

interface Props {
  comunicado: Comunicado;
}

const AnnouncementCard: React.FC<Props> = ({ comunicado }) => {
  const [showComments, setShowComments] = useState(false);
  const [commentsCount, setCommentsCount] = useState(comunicado.comentariosCount || 0);

  useEffect(() => {
    setCommentsCount(comunicado.comentariosCount || 0);
  }, [comunicado.comentariosCount]);

  useEffect(() => {
    const sameComunicado = (id: unknown) => String(id) === String(comunicado._id);

    const handleNew = (data: { comunicadoId: string; comentario?: unknown }) => {
      if (sameComunicado(data.comunicadoId)) {
        setCommentsCount(prev => prev + 1);
      }
    };

    const handleRemove = (data: { comunicadoId: string; id?: string }) => {
      if (sameComunicado(data.comunicadoId)) {
        setCommentsCount(prev => Math.max(0, prev - 1));
      }
    };

    socket.on('comentario:new', handleNew);
    socket.on('comentario:remove', handleRemove);

    return () => {
      socket.off('comentario:new', handleNew);
      socket.off('comentario:remove', handleRemove);
    };
  }, [comunicado._id]);

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-all mb-6">
      <div className="p-4 flex items-center gap-3">
        <img
          src={comunicado.diretorFoto || '/img/default-avatar.png'}
          alt={comunicado.diretorNome}
          className="w-10 h-10 rounded-full object-cover border border-white/10"
        />
        <div>
          <h3 className="text-sm font-semibold text-white">{comunicado.diretorNome}</h3>
          <p className="text-xs text-zinc-400">
            {format(new Date(comunicado.dataCriacao), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
          </p>
        </div>
      </div>

      <div className="px-4 pb-4">
        <h2 className="text-lg font-bold text-white mb-2">{comunicado.titulo}</h2>
        <div
          className="text-zinc-300 text-sm leading-relaxed prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: comunicado.conteudo }}
        />
      </div>

      {comunicado.imagens && comunicado.imagens.length > 0 && (
        <div className={`grid gap-1 px-4 mb-4 ${
          comunicado.imagens.length === 1 ? 'grid-cols-1' :
          comunicado.imagens.length === 2 ? 'grid-cols-2' :
          'grid-cols-3'
        }`}>
          {comunicado.imagens.map((img, idx) => (
            <div key={idx} className="aspect-square rounded-lg overflow-hidden border border-white/5 bg-zinc-800">
              <img src={img} alt="Anexo" className="w-full h-full object-cover hover:scale-105 transition-transform cursor-pointer" />
            </div>
          ))}
        </div>
      )}

      {comunicado.videos && comunicado.videos.length > 0 && (
        <div className="px-4 mb-4 space-y-2">
          {comunicado.videos.map((video, idx) => (
            <div key={idx} className="rounded-lg overflow-hidden border border-white/5 bg-black aspect-video">
              <video src={video} controls className="w-full h-full" />
            </div>
          ))}
        </div>
      )}

      {comunicado.audios && comunicado.audios.length > 0 && (
        <div className="px-4 mb-4 space-y-2">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Mensagens de Voz</p>
          {comunicado.audios.map((audio, idx) => (
            <div key={idx} className="bg-zinc-800/50 border border-white/5 rounded-xl p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-black">
                <i className="ti ti-microphone" />
              </div>
              <audio src={audio} controls className="flex-1 h-8" />
            </div>
          ))}
        </div>
      )}

      {comunicado.documentos && comunicado.documentos.length > 0 && (
        <div className="px-4 mb-4 space-y-2">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Documentos em Anexo</p>
          <div className="flex flex-wrap gap-2">
            {comunicado.documentos.map((doc, idx) => (
              <a
                key={idx}
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-zinc-800/50 hover:bg-zinc-800 border border-white/5 rounded-lg px-3 py-2 text-xs text-zinc-300 transition-colors"
                title={doc.nome}
              >
                <div className="w-8 h-8 rounded bg-accent-primary/20 flex items-center justify-center text-accent-primary">
                  <span className="text-[10px] font-bold uppercase">{doc.tipo || 'PDF'}</span>
                </div>
                <span className="truncate max-w-[150px]">{doc.nome}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4">
          <ReactionArea
            messageId={comunicado._id}
            initialReactionsCount={comunicado.reacoesCount}
          />
          <SpeakButton text={`${comunicado.titulo}. ${comunicado.conteudo}`} />
        </div>

        <button
          type="button"
          onClick={() => setShowComments(prev => !prev)}
          aria-expanded={showComments}
          className={`flex items-center gap-2 text-xs font-semibold transition-colors rounded-full px-3 py-1.5 ${
            showComments
              ? 'bg-accent-primary/15 text-accent-primary border border-accent-primary/30'
              : 'text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10'
          }`}
        >
          <MessageCircle size={14} />
          <span className="bg-white/10 px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">{commentsCount}</span>
          {showComments ? 'Fechar' : 'Comentar'}
        </button>
      </div>

      {showComments && (
        <div className="border-t border-white/5 bg-black/20 p-4">
          <CommentSection
            comunicadoId={comunicado._id}
            onCountChange={(delta) => setCommentsCount(prev => Math.max(0, prev + delta))}
          />
        </div>
      )}
    </div>
  );
};

export default AnnouncementCard;
