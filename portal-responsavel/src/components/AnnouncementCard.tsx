import React, { useState, useEffect } from 'react';
import { Comunicado } from '../types';
import ReactionArea from './ReactionArea';
import CommentSection from './CommentSection';
import SpeakButton from './SpeakButton';
import AudioPlayer from './AudioPlayer';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MessageCircle } from 'lucide-react';
import { socket } from '../services/socket';
import { getPhotoUrl } from '../utils/photoUtils';
import { sanitizeHtml } from '../utils/htmlSanitizer';

interface Props {
  comunicado: Comunicado;
}

const AnnouncementCard: React.FC<Props> = ({ comunicado }) => {
  const [showComments, setShowComments] = useState(false);
  const [commentsCount, setCommentsCount] = useState(comunicado.comentariosCount || 0);
  const sanitizedContent = sanitizeHtml(comunicado.conteudo);

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

  const directorPhoto = getPhotoUrl(comunicado.diretorFoto);

  return (
    <div style={{
      background: 'rgba(24, 24, 27, 0.5)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '12px',
      overflow: 'hidden',
      marginBottom: '24px',
      minWidth: 0,
      transition: 'border-color 0.2s',
    }}>
      {/* Header with avatar */}
      <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {directorPhoto && !directorPhoto.includes('default-avatar.png') ? (
          <img
            src={directorPhoto}
            alt={comunicado.diretorNome}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              objectFit: 'cover',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              flexShrink: 0,
            }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/img/default-avatar.png'; }}
          />
        ) : (
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.85rem',
              background: 'linear-gradient(135deg, #10b981, #0ea5e9)',
              flexShrink: 0,
            }}
          >
            {(comunicado.diretorNome || 'D').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
          </div>
        )}
        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#fff', margin: 0 }}>{comunicado.diretorNome}</h3>
          <p style={{ fontSize: '0.75rem', color: '#a1a1aa', margin: 0 }}>
            {format(new Date(comunicado.dataCriacao), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '0 16px 16px' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>{comunicado.titulo}</h2>
        <div
          style={{ color: '#d4d4d8', fontSize: '0.875rem', lineHeight: 1.625 }}
          dangerouslySetInnerHTML={{ __html: sanitizedContent }}
        />
      </div>

      {/* Images */}
      {comunicado.imagens && comunicado.imagens.length > 0 && (
        <div style={{
          display: 'grid',
          gap: '4px',
          padding: '0 16px',
          marginBottom: '16px',
          gridTemplateColumns: comunicado.imagens.length === 1 ? '1fr' :
            comunicado.imagens.length === 2 ? '1fr 1fr' : '1fr 1fr 1fr',
        }}>
          {comunicado.imagens.map((img, idx) => (
            <div key={idx} style={{
              aspectRatio: '1',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              background: '#27272a',
            }}>
              <img src={img} alt="Anexo" style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transition: 'transform 0.2s',
                cursor: 'pointer',
              }} />
            </div>
          ))}
        </div>
      )}

      {/* Videos */}
      {comunicado.videos && comunicado.videos.length > 0 && (
        <div style={{ padding: '0 16px', marginBottom: '16px' }}>
          {comunicado.videos.map((video, idx) => (
            <div key={idx} style={{
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              background: '#000',
              aspectRatio: '16/9',
              marginBottom: '8px',
            }}>
              <video src={video} controls style={{ width: '100%', height: '100%' }} />
            </div>
          ))}
        </div>
      )}

      {/* Audios */}
      {comunicado.audios && comunicado.audios.length > 0 && (
        <div style={{ padding: '0 16px', marginBottom: '16px' }}>
          <p style={{ fontSize: '10px', fontWeight: 700, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Mensagens de Voz
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {comunicado.audios.map((audio, idx) => (
              <AudioPlayer key={idx} src={audio} />
            ))}
          </div>
        </div>
      )}

      {/* Documents */}
      {comunicado.documentos && comunicado.documentos.length > 0 && (
        <div style={{ padding: '0 16px', marginBottom: '16px' }}>
          <p style={{ fontSize: '10px', fontWeight: 700, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Documentos em Anexo</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {comunicado.documentos.map((doc, idx) => (
              <a
                key={idx}
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(39, 39, 42, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '0.75rem',
                  color: '#d4d4d8',
                  transition: 'background 0.2s',
                  textDecoration: 'none',
                }}
                title={doc.nome}
              >
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '6px',
                  background: 'rgba(0, 212, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#00d4ff',
                }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>{doc.tipo || 'PDF'}</span>
                </div>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>{doc.nome}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Action bar */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
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
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.75rem',
            fontWeight: 600,
            borderRadius: '9999px',
            padding: '6px 12px',
            border: showComments ? '1px solid rgba(0, 212, 255, 0.3)' : '1px solid transparent',
            background: showComments ? 'rgba(0, 212, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            color: showComments ? '#00d4ff' : '#a1a1aa',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <MessageCircle size={14} />
          <span style={{
            background: 'rgba(255, 255, 255, 0.1)',
            padding: '2px 8px',
            borderRadius: '9999px',
            minWidth: '1.5rem',
            textAlign: 'center',
          }}>{commentsCount}</span>
          {showComments ? 'Fechar' : 'Comentar'}
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <div style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          background: 'rgba(0, 0, 0, 0.2)',
          padding: '16px',
        }}>
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
