/**
 * components/Modal.tsx
 * Accessible, animated modal dialog with overlay blur, ESC key support,
 * and slide-up entrance animation.
 */

import React, { useEffect, useCallback, useRef } from 'react';
import type { Notification } from '../types';
import styles from '../styles/portal.module.scss';

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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!notification) return;
    document.addEventListener('keydown', handleKeyDown);
    // Trap focus on the close button when modal opens
    closeButtonRef.current?.focus();
    // Prevent background scroll
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
        {/* Header */}
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

        {/* Title */}
        <h2 id="modal-title" className={styles.modalTitle}>
          {notification.titulo}
        </h2>

        {/* Date */}
        <p className={styles.modalDate}>
          <i className="ti ti-clock" aria-hidden="true" />
          {formattedDate}
        </p>

        {/* Body */}
        <div id="modal-message" className={styles.modalMessage}>
          <p>{notification.mensagem}</p>
        </div>
      </div>
    </div>
  );
};

export default Modal;
