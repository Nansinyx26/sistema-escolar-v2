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
    <div className={styles.onboardingContainer} style={{ zIndex: 10000, background: 'rgba(0,0,0,0.85)' }}>
      <div className={styles.onboardingCard} style={{ maxWidth: '800px', height: '90vh' }}>
        <div className={styles.onboardingStep} style={{ padding: '0', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className={styles.panelHeader} style={{ padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 0 }}>
            <h2 style={{ margin: 0, textAlign: 'left', fontSize: '1.5rem' }}>
              <i className="ti ti-bell" style={{ marginRight: '10px', color: '#00d4ff' }} />
              Notificações
            </h2>
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '2rem', cursor: 'pointer' }}
              aria-label="Fechar"
            >
              &times;
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            {notifications.length === 0 ? (
              <div className={styles.emptyState}>
                <i className="ti ti-bell-off" />
                <p>Nenhuma notificação encontrada.</p>
              </div>
            ) : (
              <div className={styles.notificationsList} style={{ maxHeight: 'none' }}>
                {notifications.map((n) => {
                  const previewText = n.corpoHtml ? stripHtml(n.corpoHtml) : n.mensagem;
                  const isLong = previewText.length > 140;
                  const isExpanded = !!expandedIds[n.id];
                  const showCommentBox = !!openComments[n.id] && !!n.comunicadoId;

                  return (
                    <article
                      key={n.id}
                      className={`
                        ${styles.notificationCard}
                        ${!n.lido ? styles.unread : ''}
                        ${TYPE_COLORS[n.tipo] ?? ''}
                      `}
                      style={{ marginBottom: '16px' }}
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
                        {n.comunicadoId && (
                          <button
                            type="button"
                            className={styles.notifCommentBtn}
                            onClick={() => setOpenComments(prev => ({ ...prev, [n.id]: !prev[n.id] }))}
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

                      <div className={styles.notifActions} style={{ opacity: 1, maxHeight: '50px' }}>
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

          <div className={styles.stepFooter} style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <button onClick={onClose} className={styles.primaryBtn}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationsModal;
