/**
 * components/Header.tsx
 * Sticky top navigation bar with school logo, notification bell,
 * user avatar and logout button. Fully responsive.
 */

import React, { useState } from 'react';
import type { GmailUser, Notification } from '../types';
import styles from '../styles/portal.module.scss';
import schoolLogo from '../assets/logo-jaguari.png';
import { getPhotoUrl } from '../utils/photoUtils';

interface TtsSettingsResponse {
  success?: boolean;
  user?: GmailUser;
}

interface WindowBridge {
  apiFetch?: (input: string, init?: RequestInit) => Promise<TtsSettingsResponse>;
  auth?: {
    updateSession?: (user: GmailUser) => void;
  };
  startTourManual?: () => void | Promise<void>;
}

const windowBridge = window as Window & WindowBridge;

interface HeaderProps {
  user: GmailUser;
  notifications: Notification[];
  onLogout: () => void;
  onBellClick: () => void;
  onProfileClick: () => void;
  onBiClick?: () => void;
  activeTab?: string;
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
  const [voice, setVoice] = useState(localStorage.getItem('user_voice_preference') || 'male');
  const [mode, setMode] = useState(localStorage.getItem('user_narration_mode') || 'texto_audio');
  const [isOpen, setIsOpen] = useState(false);

  const voices = [
    { id: 'male', label: 'Voz Masculina', icon: 'ti-man', color: 'text-violet-400' },
    { id: 'off', label: 'Voz Desativada', icon: 'ti-volume-off', color: 'text-zinc-400' }
  ];

  const narrationModes = [
    { id: 'texto_audio', label: 'Texto + Áudio', icon: 'ti-layers' },
    { id: 'texto', label: 'Apenas Texto', icon: 'ti-text' },
    { id: 'audio', label: 'Apenas Áudio', icon: 'ti-music-alt' }
  ];

  const saveSettings = async (updates: { voicePreference?: string; narrationMode?: string }) => {
    try {
      if (windowBridge.apiFetch) {
        const res = await windowBridge.apiFetch('/auth/settings/tts', {
          method: 'POST',
          body: JSON.stringify(updates)
        });
        if (res.success && res.user && windowBridge.auth?.updateSession) {
          windowBridge.auth.updateSession(res.user);
        }
      }
    } catch (e) {
      console.error('Erro ao salvar preferências de voz:', e);
    }
  };

  const handleVoiceSelect = (v: string) => {
    localStorage.setItem('user_voice_preference', v);
    setVoice(v);
    window.dispatchEvent(new CustomEvent('voicePreferenceChanged', { detail: v }));
    saveSettings({ voicePreference: v });
  };

  const handleModeSelect = (m: string) => {
    localStorage.setItem('user_narration_mode', m);
    localStorage.setItem('user_preferencia_narracao', m);
    setMode(m);
    window.dispatchEvent(new CustomEvent('narrationModeChanged', { detail: m }));
    // No JS legado, isso dispara classes no body
    document.body.classList.remove('preference-texto', 'preference-texto-audio', 'preference-audio');
    document.body.classList.add(`preference-${m.replace('_', '-')}`);
    saveSettings({ narrationMode: m });
  };

  return (
    <div style={{ position: 'relative', marginRight: '8px' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={styles.notificationBell}
        title="Configurações de Voz e Leitura"
        style={{ color: voice === 'off' ? '' : '#a78bfa' }}
      >
        <i className={`ti ${voice === 'off' ? 'ti-volume-off' : 'ti-volume-2'}`} style={{ fontSize: '1.4rem' }} />
      </button>
      
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '8px',
          background: '#18181b', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '16px', padding: '12px', zIndex: 100, width: '200px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)'
        }} onMouseLeave={() => setIsOpen(false)}>
          
          <div style={{ marginBottom: '12px' }}>
            <p style={{ fontSize: '10px', color: '#71717a', padding: '0 8px 8px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>Voz do Sistema</p>
            {voices.map(v => (
              <button
                key={v.id}
                onClick={() => handleVoiceSelect(v.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px', borderRadius: '8px', fontSize: '12px', textAlign: 'left',
                  background: voice === v.id ? 'rgba(139, 92, 246, 0.1)' : 'transparent',
                  color: voice === v.id ? '#a78bfa' : '#a1a1aa',
                  border: 'none', cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                <i className={`ti ${v.icon}`} style={{ fontSize: '1.1rem' }} />
                {v.label}
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
            <p style={{ fontSize: '10px', color: '#71717a', padding: '0 8px 8px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>Modo de Leitura</p>
            {narrationModes.map(m => (
              <button
                key={m.id}
                onClick={() => handleModeSelect(m.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px', borderRadius: '8px', fontSize: '12px', textAlign: 'left',
                  background: mode === m.id ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                  color: mode === m.id ? '#10b981' : '#a1a1aa',
                  border: 'none', cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                <i className={`ti ${m.icon}`} style={{ fontSize: '1.1rem' }} />
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Header: React.FC<HeaderProps> = ({ user, notifications, onLogout, onBellClick, onProfileClick }) => {
  const unreadCount = notifications.filter((n) => !n.lido).length;
  const userPhoto = getPhotoUrl(user.picture);

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
            onClick={() => windowBridge.startTourManual?.()}
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
              {userPhoto !== '/img/default-avatar.png' ? (
                <img src={userPhoto} alt={user.name} loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).src = '/img/default-avatar.png'; }} />
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
