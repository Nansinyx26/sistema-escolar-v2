/**
 * components/NotificationsModal.tsx
 * Full-screen overlay to display all notifications with expand and comments.
 */

import * as RadixDialog from '@radix-ui/react-dialog';
import type React from 'react';
import { useState } from 'react';
import styles from '../styles/portal.module.scss';
import type { Notification } from '../types';
import { sanitizeHtml } from '../utils/htmlSanitizer';
import CommentSection from './CommentSection';
import ReactionArea from './ReactionArea';
import Icon from './ui/Icon';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  info: styles.borderInfo,
  aviso: styles.borderAviso,
  evento: styles.borderEvento,
  financeiro: styles.borderFinanceiro,
  academico: styles.borderAcademico,
  saude: styles.borderSaude,
  falta: styles.borderFalta,
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
  const [filtro, setFiltro] = useState<'todas' | 'naoLidas'>('todas');

  if (!isOpen) return null;

  const naoLidas = notifications.filter((n) => !n.lido);
  const unreadCount = naoLidas.length;
  const visiveis = filtro === 'naoLidas' ? naoLidas : notifications;

  const marcarTodasComoLidas = () => {
    for (const n of naoLidas) onMarkAsRead(n.id);
  };

  return (
    <RadixDialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.notificationsModalOverlay} />
        <RadixDialog.Content className={styles.dialogPositioner} aria-describedby={undefined}>
          <div className={styles.notificationsModalCard}>
            <div className={styles.notificationsModalHeader}>
              <div className={styles.notificationsModalHeading}>
                <span className={styles.notificationsModalHeadingIcon} aria-hidden="true">
                  <Icon name="bell" />
                </span>
                <div>
                  <RadixDialog.Title asChild>
                    <h2>Notificações</h2>
                  </RadixDialog.Title>
                  <p className={styles.notificationsModalSubtitle} aria-live="polite">
                    {unreadCount > 0
                      ? `${unreadCount} não ${unreadCount === 1 ? 'lida' : 'lidas'} de ${notifications.length}`
                      : notifications.length > 0
                        ? 'Tudo em dia'
                        : 'Nada por aqui ainda'}
                  </p>
                </div>
              </div>
              <RadixDialog.Close asChild>
                <button
                  type="button"
                  className={styles.notificationsModalClose}
                  aria-label="Fechar notificações"
                  title="Fechar"
                >
                  <Icon name="x" aria-hidden="true" />
                </button>
              </RadixDialog.Close>
            </div>

            {notifications.length > 0 && (
              <div className={styles.notificationsModalToolbar}>
                <fieldset
                  className={styles.notificationsModalFiltros}
                  aria-label="Filtrar notificações"
                >
                  <button
                    type="button"
                    className={styles.notificationsModalFiltro}
                    aria-pressed={filtro === 'todas'}
                    onClick={() => setFiltro('todas')}
                  >
                    Todas <span>{notifications.length}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.notificationsModalFiltro}
                    aria-pressed={filtro === 'naoLidas'}
                    onClick={() => setFiltro('naoLidas')}
                  >
                    Não lidas <span>{unreadCount}</span>
                  </button>
                </fieldset>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    className={styles.notificationsModalMarcarTodas}
                    onClick={marcarTodasComoLidas}
                  >
                    <Icon name="check" aria-hidden="true" />
                    Marcar todas como lidas
                  </button>
                )}
              </div>
            )}

            <div className={styles.notificationsModalBody}>
              {visiveis.length === 0 ? (
                <div className={styles.emptyState} role="status">
                  <Icon name={filtro === 'naoLidas' ? 'check' : 'bell-off'} aria-hidden="true" />
                  <p>
                    {filtro === 'naoLidas'
                      ? 'Você leu todas as notificações.'
                      : 'Nenhuma notificação encontrada.'}
                  </p>
                </div>
              ) : (
                <div className={styles.notificationsList}>
                  {visiveis.map((n) => {
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
                        <div className={`${styles.notifClickArea} ${styles.notifClickAreaStatic}`}>
                          <div className={styles.notificationHeader}>
                            <div className={styles.notifLeft}>
                              <span className={styles.notifIcon}>{n.icon}</span>
                              <div className={styles.notifTextBlock}>
                                <p
                                  className={`${styles.notificationTitle} ${styles.notificationTitleLg}`}
                                >
                                  {n.titulo}
                                </p>
                                {n.corpoHtml && isExpanded ? (
                                  <div
                                    className={styles.notificationFull}
                                    // biome-ignore lint/security/noDangerouslySetInnerHtml: corpo passa por sanitizeHtml (DOMPurify)
                                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.corpoHtml) }}
                                  />
                                ) : (
                                  <p
                                    className={`${styles.notificationPreview} ${!isExpanded && isLong ? styles.notificationPreviewClamped : ''}`}
                                    style={isExpanded ? { whiteSpace: 'pre-wrap' } : undefined}
                                  >
                                    {previewText}
                                  </p>
                                )}
                                {isLong && (
                                  <button
                                    type="button"
                                    className={styles.notifExpandBtn}
                                    onClick={() =>
                                      setExpandedIds((prev) => ({ ...prev, [n.id]: !prev[n.id] }))
                                    }
                                    aria-expanded={isExpanded}
                                  >
                                    {isExpanded ? 'Menos' : 'Mais'}
                                  </button>
                                )}
                                <p className={styles.notificationMeta}>
                                  Enviado por <strong>{n.criadoPor}</strong>
                                  <span aria-hidden="true"> · </span>
                                  <time dateTime={n.dataCriacao}>
                                    {new Date(n.dataCriacao).toLocaleString('pt-BR')}
                                  </time>
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
                            onClick={() =>
                              setOpenComments((prev) => ({ ...prev, [n.id]: !prev[n.id] }))
                            }
                            aria-expanded={showCommentBox}
                          >
                            <Icon name="message-circle" aria-hidden="true" />
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
                            <button
                              type="button"
                              className={styles.actionBtn}
                              onClick={() => onMarkAsRead(n.id)}
                            >
                              <Icon name="check" /> Marcar como lida
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.deleteBtn}`}
                            onClick={() => onDelete(n.id)}
                          >
                            <Icon name="trash" /> Excluir
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className={styles.notificationsModalFooter}>
              <RadixDialog.Close asChild>
                <button type="button" className={styles.notificationsModalFooterBtn}>
                  <Icon name="x" aria-hidden="true" />
                  Fechar
                </button>
              </RadixDialog.Close>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};

export default NotificationsModal;
