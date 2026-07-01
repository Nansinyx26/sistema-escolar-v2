/**
 * components/Modal.tsx
 * Accessible, animated modal dialog with overlay blur, ESC key support,
 * full notification content, reactions and comments.
 */

import React, { useEffect, useCallback, useRef, useState } from 'react';
import type { Notification } from '../types';
import ReactionArea from './ReactionArea';
import CommentSection from './CommentSection';
import SpeakButton from './SpeakButton';
import styles from '../styles/portal.module.scss';
import { sanitizeHtml } from '../utils/htmlSanitizer';

interface ModalProps {
  notification: Notification | null;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  info:       'Informação',
  aviso:      'Aviso',
  evento:     'Evento',
  financeiro: 'Financeiro',
  academico:  'Acadêmico',
  saude:      'Saúde',
  falta:      'Falta',
};

const Modal: React.FC<ModalProps> = ({ notification, onClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [showComments, setShowComments] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!notification) return;
    setShowComments(false);
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [notification, handleKeyDown]);

  if (!notification) return null;

  const formattedDate = new Date(notification.dataCriacao).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const sanitizedBodyHtml = sanitizeHtml(notification.corpoHtml);

  return (
    <div
      className={styles.modalOverlay}
      onClick={onClose}
      role="presentation"
      aria-hidden="true"
    >
      <div
        className={styles.modalContent}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-message"
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalMeta}>
            <span className={styles.modalIcon}>{notification.icon}</span>
            <span className={`${styles.notificationTypeBadge} ${styles[notification.tipo]}`}>
              {TYPE_LABELS[notification.tipo] ?? notification.tipo}
            </span>
          </div>
          <button
            ref={closeButtonRef}
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Fechar notificação"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <h2 id="modal-title" className={styles.modalTitle}>
          {notification.titulo}
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1.25rem' }}>
          <p className={styles.modalDate} style={{ margin: 0 }}>
            <i className="ti ti-clock" aria-hidden="true" style={{ marginRight: '6px' }} />
            {formattedDate}
          </p>
          {notification.criadoPor && (
            <p className={styles.modalDate} style={{ margin: 0, fontWeight: 500, color: 'rgba(0, 212, 255, 0.9)' }}>
              <i className="ti ti-user" aria-hidden="true" style={{ marginRight: '6px' }} />
              <strong>Enviado por:</strong> {notification.criadoPor}
            </p>
          )}
        </div>

        <div id="modal-message" className={styles.modalMessage} style={{ marginBottom: '1.25rem' }}>
          {sanitizedBodyHtml ? (
            <div dangerouslySetInnerHTML={{ __html: sanitizedBodyHtml }} />
          ) : (
            <p style={{ whiteSpace: 'pre-wrap' }}>{notification.mensagem}</p>
          )}
        </div>

        <div className={styles.modalSectionDivider}>
          <ReactionArea messageId={notification.id} />
        </div>

        {notification.comunicadoId && (
          <div className={styles.modalSectionDivider}>
            <button
              type="button"
              className={styles.notifCommentBtn}
              onClick={() => setShowComments(prev => !prev)}
              aria-expanded={showComments}
            >
              <i className="ti ti-message-circle" aria-hidden="true" />
              {showComments ? 'Fechar comentários' : 'Comentar'}
            </button>

            {showComments && (
              <div className={styles.notifCommentsBox}>
                <CommentSection comunicadoId={notification.comunicadoId} />
              </div>
            )}
          </div>
        )}

        <div className={styles.modalSectionDivider}>
          <SpeakButton text={notification.corpoHtml || notification.mensagem} />
        </div>
      </div>
    </div>
  );
};

export default Modal;
