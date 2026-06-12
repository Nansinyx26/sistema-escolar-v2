/**
 * components/NotificationsPanel.tsx
 * Vertical list of school notifications with read/delete actions,
 * type-coloured left border, expand "Mais", and comments on linked comunicados.
 */

import React, { useState } from 'react';
import type { Notification } from '../types';
import Modal from './Modal';
import ReactionArea from './ReactionArea';
import CommentSection from './CommentSection';
import styles from '../styles/portal.module.scss';

interface NotificationsPanelProps {
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

const NotificationsPanel: React.FC<NotificationsPanelProps> = ({
  notifications,
  onMarkAsRead,
  onDelete,
}) => {
  const [selected, setSelected] = useState<Notification | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});

  const unreadCount = notifications.filter((n) => !n.lido).length;

  const handleCardClick = (n: Notification) => {
    setSelected(n);
    if (!n.lido) onMarkAsRead(n.id);
  };

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleComments = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenComments(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section className={styles.notificationsPanel} aria-labelledby="notif-heading">
      <div className={styles.panelHeader}>
        <h3 id="notif-heading" className={styles.cardTitle}>
          <i className="ti ti-bell" aria-hidden="true" />
          Notificações
        </h3>
        {unreadCount > 0 && (
          <span className={styles.unreadCounter} aria-live="polite">
            {unreadCount} não {unreadCount === 1 ? 'lida' : 'lidas'}
          </span>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className={styles.emptyState} role="status">
          <i className="ti ti-bell-off" aria-hidden="true" />
          <p>Nenhuma notificação no momento.</p>
        </div>
      ) : (
        <ul className={styles.notificationsList} aria-label="Lista de notificações">
          {notifications.map((n) => {
            const previewText = n.corpoHtml ? stripHtml(n.corpoHtml) : n.mensagem;
            const isLong = previewText.length > 140;
            const isExpanded = !!expandedIds[n.id];
            const showCommentBox = !!openComments[n.id] && !!n.comunicadoId;

            return (
              <li key={n.id}>
                <article
                  className={`
                    ${styles.notificationCard}
                    ${!n.lido ? styles.unread : ''}
                    ${TYPE_COLORS[n.tipo] ?? ''}
                  `}
                  aria-label={`${n.lido ? 'Lida' : 'Não lida'}: ${n.titulo}`}
                >
                  <button
                    className={styles.notifClickArea}
                    onClick={() => handleCardClick(n)}
                    aria-label={`Abrir notificação: ${n.titulo}`}
                  >
                    <div className={styles.notificationHeader}>
                      <div className={styles.notifLeft}>
                        <span className={styles.notifIcon} aria-hidden="true">{n.icon}</span>
                        <div className={styles.notifTextBlock}>
                          <p className={styles.notificationTitle}>{n.titulo}</p>
                          {n.corpoHtml && isExpanded ? (
                            <div
                              className={styles.notificationFull}
                              dangerouslySetInnerHTML={{ __html: n.corpoHtml }}
                            />
                          ) : (
                            <p className={`${styles.notificationPreview} ${!isExpanded && isLong ? styles.notificationPreviewClamped : ''}`}>
                              {previewText}
                            </p>
                          )}
                          {isLong && (
                            <button
                              type="button"
                              className={styles.notifExpandBtn}
                              onClick={(e) => toggleExpand(n.id, e)}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? 'Menos' : 'Mais'}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className={styles.notifRight}>
                        {!n.lido && (
                          <span className={styles.newBadge} aria-label="Nova notificação">
                            NOVA
                          </span>
                        )}
                        <time className={styles.notificationDate} dateTime={n.dataCriacao}>
                          {new Date(n.dataCriacao).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                          })}
                        </time>
                      </div>
                    </div>
                  </button>

                  <div className={styles.notifReactionRow}>
                    <ReactionArea messageId={n.id} />
                    {n.comunicadoId && (
                      <button
                        type="button"
                        className={styles.notifCommentBtn}
                        onClick={(e) => toggleComments(n.id, e)}
                        aria-expanded={showCommentBox}
                      >
                        <i className="ti ti-message-circle" aria-hidden="true" />
                        Comentar
                      </button>
                    )}
                  </div>

                  {showCommentBox && n.comunicadoId && (
                    <div className={styles.notifCommentsBox}>
                      <CommentSection comunicadoId={n.comunicadoId} />
                    </div>
                  )}

                  <div className={styles.notifActions}>
                    {!n.lido && (
                      <button
                        className={styles.actionBtn}
                        onClick={(e) => { e.stopPropagation(); onMarkAsRead(n.id); }}
                        aria-label="Marcar como lida"
                      >
                        <i className="ti ti-check" aria-hidden="true" /> Marcar como lida
                      </button>
                    )}
                    <button
                      className={`${styles.actionBtn} ${styles.deleteBtn}`}
                      onClick={(e) => { e.stopPropagation(); onDelete(n.id); }}
                      aria-label="Excluir notificação"
                    >
                      <i className="ti ti-trash" aria-hidden="true" /> Excluir
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <Modal notification={selected} onClose={() => setSelected(null)} />
    </section>
  );
};

export default NotificationsPanel;
