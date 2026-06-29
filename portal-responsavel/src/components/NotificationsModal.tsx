/**
 * components/NotificationsModal.tsx
 * Full-screen overlay to display all notifications with expand and comments.
 */

import React, { useState } from 'react';
import type { Notification } from '../types';
import styles from '../styles/portal.module.scss';
import ReactionArea from './ReactionArea';
import CommentSection from './CommentSection';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  info:       styles.borderInfo,
  aviso:      styles.borderAviso,
  evento:     styles.borderEvento,
  financeiro: styles.borderFinanceiro,
  academico:  styles.borderAcademico,
  saude:      styles.borderSaude,
  falta:      styles.borderFalta,
};

const stripHtml = (html: string) => {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
};

const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAsRead,
  onDelete,
}) => {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});

  if (!isOpen) return null;

  return (
    <div className={styles.notificationsModalOverlay}>
      <div className={styles.notificationsModalCard}>
        <div className={styles.notificationsModalHeader}>
          <h2>
            <i className="ti ti-bell" />
            Notificações
          </h2>
          <button
            onClick={onClose}
            className={styles.notificationsModalClose}
            aria-label="Fechar"
          >
            &times;
          </button>
        </div>

        <div className={styles.notificationsModalBody}>
          {notifications.length === 0 ? (
            <div className={styles.emptyState}>
              <i className="ti ti-bell-off" />
              <p>Nenhuma notificação encontrada.</p>
            </div>
          ) : (
            <div className={styles.notificationsList}>
              {notifications.map((n) => {
                const previewText = n.corpoHtml ? stripHtml(n.corpoHtml) : n.mensagem;
                const isLong = previewText.length > 140;
                const isExpanded = !!expandedIds[n.id];
                const showCommentBox = !!openComments[n.id];

                return (
                  <article
                    key={n.id}
                    className={`
                      ${styles.notificationCard}
                      ${!n.lido ? styles.unread : ''}
                      ${TYPE_COLORS[n.tipo] ?? ''}
                    `}
                  >
                    <div className={styles.notifClickArea} style={{ cursor: 'default' }}>
                      <div className={styles.notificationHeader}>
                        <div className={styles.notifLeft}>
                          <span className={styles.notifIcon}>{n.icon}</span>
                          <div className={styles.notifTextBlock}>
                            <p className={styles.notificationTitle} style={{ fontSize: '1.1rem' }}>{n.titulo}</p>
                            {n.corpoHtml && isExpanded ? (
                              <div className={styles.notificationFull} dangerouslySetInnerHTML={{ __html: n.corpoHtml }} />
                            ) : (
                              <p className={`${styles.notificationPreview} ${!isExpanded && isLong ? styles.notificationPreviewClamped : ''}`} style={isExpanded ? { whiteSpace: 'pre-wrap' } : undefined}>
                                {previewText}
                              </p>
                            )}
                            {isLong && (
                              <button
                                type="button"
                                className={styles.notifExpandBtn}
                                onClick={() => setExpandedIds(prev => ({ ...prev, [n.id]: !prev[n.id] }))}
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? 'Menos' : 'Mais'}
                              </button>
                            )}
                            <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', marginTop: '8px' }}>
                              Enviado por: <strong>{n.criadoPor}</strong> • {new Date(n.dataCriacao).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        </div>
                        <div className={styles.notifRight}>
                          {!n.lido && <span className={styles.newBadge}>NOVA</span>}
                        </div>
                      </div>
                    </div>

                    <div className={styles.notifReactionRow}>
                      <ReactionArea messageId={n.id} />
                      <button
                        type="button"
                        className={styles.notifCommentBtn}
                        onClick={() => setOpenComments(prev => ({ ...prev, [n.id]: !prev[n.id] }))}
                        aria-expanded={showCommentBox}
                      >
                        <i className="ti ti-message-circle" aria-hidden="true" />
                        Comentar
                      </button>
                    </div>

                    {showCommentBox && (
                      <div className={styles.notifCommentsBox}>
                        <CommentSection
                          comunicadoId={n.comunicadoId}
                          notificacaoId={n.notificacaoId || n.id}
                        />
                      </div>
                    )}

                    <div className={styles.notifActions}>
                      {!n.lido && (
                        <button className={styles.actionBtn} onClick={() => onMarkAsRead(n.id)}>
                          <i className="ti ti-check" /> Marcar como lida
                        </button>
                      )}
                      <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => onDelete(n.id)}>
                        <i className="ti ti-trash" /> Excluir
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.notificationsModalFooter}>
          <button onClick={onClose} className={styles.primaryBtn}>Fechar</button>
        </div>
      </div>
    </div>
  );
};

export default NotificationsModal;
