/**
 * components/Modal.tsx
 * Modal de detalhe de notificação sobre Radix Dialog.
 * O Radix cuida de foco preso, ESC, scroll-lock e aria-*; aqui mantemos o
 * layout rico (badge de tipo, reações, comentários, leitura por voz).
 */

import React, { useEffect, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import type { Notification } from '../types';
import ReactionArea from './ReactionArea';
import CommentSection from './CommentSection';
import SpeakButton from './SpeakButton';
import styles from '../styles/portal.module.scss';
import { sanitizeHtml } from '../utils/htmlSanitizer';
import Icon from './ui/Icon';

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
  const [showComments, setShowComments] = useState(false);

  // Reseta o painel de comentários ao abrir outra notificação.
  useEffect(() => {
    setShowComments(false);
  }, [notification?.id]);

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
    <RadixDialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.modalOverlay} />
        <RadixDialog.Content className={styles.modalContent}>
          <div className={styles.modalHeader}>
            <div className={styles.modalMeta}>
              <span className={styles.modalIcon}>{notification.icon}</span>
              <span className={`${styles.notificationTypeBadge} ${styles[notification.tipo]}`}>
                {TYPE_LABELS[notification.tipo] ?? notification.tipo}
              </span>
            </div>
            <RadixDialog.Close asChild>
              <button className={styles.modalClose} aria-label="Fechar notificação">
                <Icon name="x" aria-hidden="true" />
              </button>
            </RadixDialog.Close>
          </div>

          <RadixDialog.Title asChild>
            <h2 className={styles.modalTitle}>{notification.titulo}</h2>
          </RadixDialog.Title>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1.25rem' }}>
            <p className={styles.modalDate} style={{ margin: 0 }}>
              <Icon name="clock" aria-hidden="true" style={{ marginRight: '6px' }} />
              {formattedDate}
            </p>
            {notification.criadoPor && (
              <p className={styles.modalDate} style={{ margin: 0, fontWeight: 500, color: 'rgba(16, 185, 129, 0.9)' }}>
                <Icon name="user" aria-hidden="true" style={{ marginRight: '6px' }} />
                <strong>Enviado por:</strong> {notification.criadoPor}
              </p>
            )}
          </div>

          <RadixDialog.Description asChild>
            <div className={styles.modalMessage} style={{ marginBottom: '1.25rem' }}>
              {sanitizedBodyHtml ? (
                <div dangerouslySetInnerHTML={{ __html: sanitizedBodyHtml }} />
              ) : (
                <p style={{ whiteSpace: 'pre-wrap' }}>{notification.mensagem}</p>
              )}
            </div>
          </RadixDialog.Description>

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
                <Icon name="message-circle" aria-hidden="true" />
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
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};

export default Modal;
