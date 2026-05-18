/**
 * components/NotificationsPanel.tsx
 * Vertical list of school notifications with read/delete actions,
 * type-coloured left border, and modal detail view.
 */

import React, { useState } from 'react';
import type { Notification } from '../types';
import Modal from './Modal';
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

const NotificationsPanel: React.FC<NotificationsPanelProps> = ({
  notifications,
  onMarkAsRead,
  onDelete,
}) => {
  const [selected, setSelected] = useState<Notification | null>(null);

  const unreadCount = notifications.filter((n) => !n.lido).length;

  const handleCardClick = (n: Notification) => {
    setSelected(n);
    if (!n.lido) onMarkAsRead(n.id);
  };

  return (
    <section className={styles.notificationsPanel} aria-labelledby="notif-heading">
      {/* Panel header */}
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
          {notifications.map((n) => (
            <li key={n.id}>
              <article
                className={`
                  ${styles.notificationCard}
                  ${!n.lido ? styles.unread : ''}
                  ${TYPE_COLORS[n.tipo] ?? ''}
                `}
                aria-label={`${n.lido ? 'Lida' : 'Não lida'}: ${n.titulo}`}
              >
                {/* Clickable area → opens modal */}
                <button
                  className={styles.notifClickArea}
                  onClick={() => handleCardClick(n)}
                  aria-label={`Abrir notificação: ${n.titulo}`}
                >
                  <div className={styles.notificationHeader}>
                    <div className={styles.notifLeft}>
                      <span className={styles.notifIcon} aria-hidden="true">{n.icon}</span>
                      <div>
                        <p className={styles.notificationTitle}>{n.titulo}</p>
                        <p className={styles.notificationPreview}>{n.mensagem}</p>
                      </div>
                    </div>
                    <div className={styles.notifRight}>
                      {!n.lido && (
                        <span className={styles.newBadge} aria-label="Nova notificação">
                          NOVA
                        </span>
                      )}
                      <time
                        className={styles.notificationDate}
                        dateTime={n.dataCriacao}
                      >
                        {new Date(n.dataCriacao).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </time>
                    </div>
                  </div>
                </button>

                {/* Action buttons (visible on hover via CSS) */}
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
          ))}
        </ul>
      )}

      {/* Detail modal */}
      <Modal notification={selected} onClose={() => setSelected(null)} />
    </section>
  );
};

export default NotificationsPanel;
