/**
 * components/Header.tsx
 * Sticky top navigation bar with school logo, notification bell,
 * user avatar and logout button. Fully responsive.
 */

import React from 'react';
import type { GmailUser, Notification } from '../types';
import styles from '../styles/portal.module.scss';

interface HeaderProps {
  user: GmailUser;
  notifications: Notification[];
  onLogout: () => void;
  onBellClick: () => void;
  onProfileClick: () => void;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

const Header: React.FC<HeaderProps> = ({ user, notifications, onLogout, onBellClick, onProfileClick }) => {
  const unreadCount = notifications.filter((n) => !n.lido).length;

  return (
    <header className={styles.header} role="banner">
      <div className={styles.headerContent}>
        {/* Logo */}
        <div className={styles.logo} aria-label="Escola Jaguari – Portal do Responsável">
          <i className="ti ti-school" aria-hidden="true" />
          <span className={styles.logoText}>Escola Jaguari</span>
          <span className={styles.logoSub}>Portal do Responsável</span>
        </div>

        {/* Actions */}
        <div className={styles.headerActions}>
          {/* Notification bell */}
          <button
            className={styles.notificationBell}
            onClick={onBellClick}
            aria-label={
              unreadCount > 0
                ? `${unreadCount} notificações não lidas`
                : 'Nenhuma notificação nova'
            }
          >
            <i
              className={`ti ti-bell-filled ${unreadCount > 0 ? styles.bellRinging : ''}`}
              aria-hidden="true"
            />
            {unreadCount > 0 && (
              <span className={styles.notificationBadge} aria-hidden="true">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* User profile (clickable to open sidebar) */}
          <div
            className={styles.userProfile}
            onClick={onProfileClick}
            style={{ cursor: 'pointer' }}
            role="button"
            aria-label="Opções do perfil"
            title="Clique para ver as opções do perfil"
          >
            <div className={styles.avatar} aria-hidden="true">
              {user.picture ? (
                <img src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
              ) : (
                <span>{getInitials(user.name)}</span>
              )}
            </div>
            <div className={styles.userInfo}>
              <span className={styles.userName}>{user.name}</span>
              <span className={styles.userEmail}>{user.email}</span>
            </div>
          </div>

          {/* Logout */}
          <button
            className={styles.logoutBtn}
            onClick={onLogout}
            aria-label="Sair da conta"
          >
            <i className="ti ti-logout" aria-hidden="true" />
            <span>Sair</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
