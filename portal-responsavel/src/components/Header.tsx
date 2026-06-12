/**
 * components/Header.tsx
 * Sticky top navigation bar with school logo, notification bell,
 * user avatar and logout button. Fully responsive.
 */

import React, { useState, useEffect } from 'react';
import type { GmailUser, Notification } from '../types';
import styles from '../styles/portal.module.scss';
import schoolLogo from '../assets/logo-jaguari.png';

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

const VoiceSelector: React.FC = () => {
  const [voice, setVoice] = useState(localStorage.getItem('user_voice_preference') || 'off');
  const [isOpen, setIsOpen] = useState(false);

  const voices = [
    { id: 'male', label: 'Masculina', icon: 'ti-man', color: 'text-violet-400' },
    { id: 'female', label: 'Feminina', icon: 'ti-woman', color: 'text-pink-400' },
    { id: 'off', label: 'Desativado', icon: 'ti-volume-off', color: 'text-zinc-400' }
  ];

  const handleSelect = (v: string) => {
    localStorage.setItem('user_voice_preference', v);
    setVoice(v);
    setIsOpen(false);
    window.dispatchEvent(new CustomEvent('voicePreferenceChanged', { detail: v }));
  };

  return (
    <div style={{ position: 'relative', marginRight: '8px' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={styles.notificationBell}
        title="Preferências de Voz"
        style={{ color: voice === 'off' ? '' : (voice === 'male' ? '#a78bfa' : '#f472b6') }}
      >
        <i className={`ti ${voice === 'off' ? 'ti-volume-2' : (voice === 'male' ? 'ti-man' : 'ti-woman')}`} style={{ fontSize: '1.4rem' }} />
      </button>
      
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '8px',
          background: '#18181b', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '12px', padding: '8px', zIndex: 100, width: '160px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)'
        }}>
          <p style={{ fontSize: '10px', color: '#71717a', padding: '0 8px 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Narração</p>
          {voices.map(v => (
            <button
              key={v.id}
              onClick={() => handleSelect(v.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px', borderRadius: '8px', fontSize: '12px', textAlign: 'left',
                background: voice === v.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                color: voice === v.id ? '#fff' : '#a1a1aa'
              }}
            >
              <i className={`ti ${v.icon} ${v.color}`} style={{ fontSize: '1.1rem' }} />
              {v.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Header: React.FC<HeaderProps> = ({ user, notifications, onLogout, onBellClick, onProfileClick }) => {
  const unreadCount = notifications.filter((n) => !n.lido).length;

  return (
    <header className={styles.header} role="banner">
      <div className={styles.headerContent}>
        {/* Logo */}
        <div className={styles.logo} aria-label="Escola Jaguari – Portal do Responsável">
          <img src={schoolLogo} alt="" aria-hidden="true" />
          <span className={styles.logoText}>Escola Jaguari</span>
          <span className={styles.logoSub}>Portal do Responsável</span>
        </div>

        {/* Actions */}
        <div className={styles.headerActions}>
          <VoiceSelector />
          
          {/* Botão Ver Tour Guiado */}
          <button
            className={styles.notificationBell}
            onClick={() => (window as any).startTourManual && (window as any).startTourManual()}
            title="Ver Tour Guiado"
            aria-label="Ver Tour Guiado"
            style={{ marginRight: '8px' }}
          >
            <i className="ti ti-help" aria-hidden="true" style={{ fontSize: '1.4rem' }} />
          </button>

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
