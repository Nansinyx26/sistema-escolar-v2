import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MessageCircle } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { socket } from '../services/socket';
import styles from '../styles/portal.module.scss';
import type { Comunicado } from '../types';
import { sanitizeHtml } from '../utils/htmlSanitizer';
import { getPhotoUrl } from '../utils/photoUtils';
import AudioPlayer from './AudioPlayer';
import CommentSection from './CommentSection';
import ReactionArea from './ReactionArea';
import SpeakButton from './SpeakButton';

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
        setCommentsCount((prev) => prev + 1);
      }
    };

    const handleRemove = (data: { comunicadoId: string; id?: string }) => {
      if (sameComunicado(data.comunicadoId)) {
        setCommentsCount((prev) => Math.max(0, prev - 1));
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
    <div className={styles.announcementCard}>
      {/* Header with avatar */}
      <div
        className={styles.announcementHeader}
        style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
      >
        {directorPhoto && !directorPhoto.includes('default-avatar.png') ? (
          <img
            loading="lazy"
            src={directorPhoto}
            alt={comunicado.diretorNome}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              objectFit: 'cover',
              border: '1px solid rgba(var(--tint-rgb), 0.1)',
              flexShrink: 0,
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/img/default-avatar.png';
            }}
          />
        ) : (
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '1px solid rgba(var(--tint-rgb), 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-primary)',
              fontWeight: 700,
              fontSize: '0.85rem',
              background: 'linear-gradient(135deg, #10b981, #0ea5e9)',
              flexShrink: 0,
            }}
          >
            {(comunicado.diretorNome || 'D')
              .split(' ')
              .map((n) => n[0])
              .join('')
              .substring(0, 2)
              .toUpperCase()}
          </div>
        )}
        <div>
          <h3
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            {comunicado.diretorNome}
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
            {format(new Date(comunicado.dataCriacao), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })}
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '0 16px 16px' }}>
        <h2
          style={{
            fontSize: '1.125rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: '8px',
          }}
        >
          {comunicado.titulo}
        </h2>
        <div
          style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.625 }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: conteúdo já passa por sanitizeHtml (DOMPurify)
          dangerouslySetInnerHTML={{ __html: sanitizedContent }}
        />
      </div>

      {/* Images */}
      {comunicado.imagens && comunicado.imagens.length > 0 && (
        <div
          style={{
            display: 'grid',
            gap: '4px',
            padding: '0 16px',
            marginBottom: '16px',
            gridTemplateColumns:
              comunicado.imagens.length === 1
                ? '1fr'
                : comunicado.imagens.length === 2
                  ? '1fr 1fr'
                  : '1fr 1fr 1fr',
          }}
        >
          {comunicado.imagens.map((img) => (
            <div
              key={img}
              style={{
                aspectRatio: '1',
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid rgba(var(--tint-rgb), 0.05)',
                background: 'var(--bg-tertiary)',
              }}
            >
              <img
                src={img}
                alt="Anexo"
                loading="lazy"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transition: 'transform 0.2s',
                  cursor: 'pointer',
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Videos */}
      {comunicado.videos && comunicado.videos.length > 0 && (
        <div style={{ padding: '0 16px', marginBottom: '16px' }}>
          {comunicado.videos.map((video) => (
            <div
              key={video}
              style={{
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid rgba(var(--tint-rgb), 0.05)',
                background: '#000',
                aspectRatio: '16/9',
                marginBottom: '8px',
              }}
            >
              {/* biome-ignore lint/a11y/useMediaCaption: vídeo enviado pela escola, sem faixa de legenda cadastrada */}
              <video src={video} controls style={{ width: '100%', height: '100%' }} />
            </div>
          ))}
        </div>
      )}

      {/* Audios */}
      {comunicado.audios && comunicado.audios.length > 0 && (
        <div style={{ padding: '0 16px', marginBottom: '16px' }}>
          <p
            style={{
              fontSize: '10px',
              fontWeight: 700,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '8px',
            }}
          >
            Mensagens de Voz
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {comunicado.audios.map((audio) => (
              <AudioPlayer key={audio} src={audio} />
            ))}
          </div>
        </div>
      )}

      {/* Documents */}
      {comunicado.documentos && comunicado.documentos.length > 0 && (
        <div style={{ padding: '0 16px', marginBottom: '16px' }}>
          <p
            style={{
              fontSize: '10px',
              fontWeight: 700,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '4px',
            }}
          >
            Documentos em Anexo
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {comunicado.documentos.map((doc) => (
              <a
                key={doc.url}
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid rgba(var(--tint-rgb), 0.05)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  transition: 'background 0.2s',
                  textDecoration: 'none',
                }}
                title={doc.nome}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    background: 'rgba(16, 185, 129, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--success-text)',
                  }}
                >
                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                    {doc.tipo || 'PDF'}
                  </span>
                </div>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '150px',
                  }}
                >
                  {doc.nome}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Action bar */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(var(--tint-rgb), 0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <ReactionArea
            messageId={comunicado._id}
            initialReactionsCount={comunicado.reacoesCount}
          />
          <SpeakButton text={`${comunicado.titulo}. ${comunicado.conteudo}`} />
        </div>

        <button
          type="button"
          onClick={() => setShowComments((prev) => !prev)}
          aria-expanded={showComments}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.75rem',
            fontWeight: 600,
            borderRadius: '9999px',
            padding: '6px 12px',
            border: showComments ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid transparent',
            background: showComments ? 'rgba(16, 185, 129, 0.15)' : 'rgba(var(--tint-rgb), 0.05)',
            color: showComments ? '#10b981' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <MessageCircle size={14} />
          <span
            style={{
              background: 'rgba(var(--tint-rgb), 0.1)',
              padding: '2px 8px',
              borderRadius: '9999px',
              minWidth: '1.5rem',
              textAlign: 'center',
            }}
          >
            {commentsCount}
          </span>
          {showComments ? 'Fechar' : 'Comentar'}
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <div
          style={{
            borderTop: '1px solid rgba(var(--tint-rgb), 0.05)',
            background: 'rgba(0, 0, 0, 0.2)',
            padding: '16px',
          }}
        >
          <CommentSection
            comunicadoId={comunicado._id}
            onCountChange={(delta) => setCommentsCount((prev) => Math.max(0, prev + delta))}
          />
        </div>
      )}
    </div>
  );
};

export default AnnouncementCard;
