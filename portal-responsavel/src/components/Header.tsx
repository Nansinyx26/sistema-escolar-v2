/**
 * components/Header.tsx
 * Sticky top navigation bar with school logo (bicolor "Sistema Escolar"),
 * notification bell, user avatar and logout button.
 * Redesign Issue #434; temas Dark/Light com alternador sol/lua na Issue #436.
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { definirVoz, normalizarVoz, VOZES, type VozNome, vozAtual } from '../constants/vozes';
import { useTheme } from '../hooks/useTheme';
import { getChatNaoLidas } from '../services/apiService';
import styles from '../styles/portal.module.scss';
import type { GmailUser, Notification } from '../types';
import { getPhotoUrl } from '../utils/photoUtils';
import CanalDenuncia from './CanalDenuncia';
import Icon from './ui/Icon';

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
  /** Abre o menu recolhível de navegação no celular. */
  onMenuClick?: () => void;
  activeTab?: string;
}

const VoiceSelector: React.FC = () => {
  const [voice, setVoice] = useState<VozNome>(() => vozAtual());
  const [narracaoDesligada, setNarracaoDesligada] = useState(
    () => localStorage.getItem('user_voice_preference') === 'off'
  );
  const [mode, setMode] = useState(localStorage.getItem('user_narration_mode') || 'texto_audio');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const aoTrocar = (e: Event) => {
      const detalhe = (e as CustomEvent<{ voice?: string }>).detail;
      if (!detalhe?.voice) return;
      setVoice(normalizarVoz(detalhe.voice));
      setNarracaoDesligada(false);
    };
    window.addEventListener('voiceChanged', aoTrocar);
    return () => window.removeEventListener('voiceChanged', aoTrocar);
  }, []);

  const narrationModes = [
    { id: 'texto_audio', label: 'Texto + Áudio', icon: 'ti-layers' },
    { id: 'texto', label: 'Apenas Texto', icon: 'ti-text' },
    { id: 'audio', label: 'Apenas Áudio', icon: 'ti-music-alt' },
  ];

  const saveSettings = async (updates: { voicePreference?: string; narrationMode?: string }) => {
    try {
      if (windowBridge.apiFetch) {
        const res = await windowBridge.apiFetch('/auth/settings/tts', {
          method: 'POST',
          body: JSON.stringify(updates),
        });
        if (res.success && res.user && windowBridge.auth?.updateSession) {
          windowBridge.auth.updateSession(res.user);
        }
      }
    } catch (e) {
      console.error('Erro ao salvar preferências de voz:', e);
    }
  };

  /** Escolha de uma das vozes nomeadas. Religa a narração se estava desligada. */
  const handleVoiceSelect = (nome: VozNome) => {
    setVoice(nome);
    setNarracaoDesligada(false);
    void definirVoz(nome);
  };

  /** Desligar não apaga a voz escolhida — ela volta ao religar. */
  const handleVoiceOff = () => {
    localStorage.setItem('user_voice_preference', 'off');
    setNarracaoDesligada(true);
    window.dispatchEvent(new CustomEvent('voicePreferenceChanged', { detail: 'off' }));
    saveSettings({ voicePreference: 'off' });
  };

  const handleModeSelect = (m: string) => {
    localStorage.setItem('user_narration_mode', m);
    localStorage.setItem('user_preferencia_narracao', m);
    setMode(m);
    window.dispatchEvent(new CustomEvent('narrationModeChanged', { detail: m }));
    document.body.classList.remove(
      'preference-texto',
      'preference-texto-audio',
      'preference-audio'
    );
    document.body.classList.add(`preference-${m.replace('_', '-')}`);
    saveSettings({ narrationMode: m });
  };

  return (
    <div style={{ position: 'relative', marginRight: '8px' }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={styles.notificationBell}
        title="Configurações de Voz e Leitura"
        style={{ color: narracaoDesligada ? '' : 'var(--accent-text)' }}
      >
        <i
          className={`ti ${narracaoDesligada ? 'ti-volume-off' : 'ti-volume-2'}`}
          style={{ fontSize: '1.4rem' }}
        />
      </button>

      {isOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: fechar no hover é gesto de ponteiro, sem equivalente de teclado
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '8px',
            background: 'var(--bg-elevated)',
            border: '1px solid rgba(var(--accent-rgb), 0.1)',
            borderRadius: '16px',
            padding: '12px',
            zIndex: 100,
            width: '200px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)',
          }}
          onMouseLeave={() => setIsOpen(false)}
        >
          <div style={{ marginBottom: '12px' }}>
            <p
              style={{
                fontSize: '10px',
                color: 'var(--text-tertiary)',
                padding: '0 8px 8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 700,
              }}
            >
              Voz do Sistema
            </p>
            {VOZES.map((v) => {
              const ativa = !narracaoDesligada && voice === v.nome;
              return (
                <button
                  type="button"
                  key={v.nome}
                  onClick={() => handleVoiceSelect(v.nome)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    textAlign: 'left',
                    background: ativa ? 'rgba(var(--accent-rgb), 0.1)' : 'transparent',
                    color: ativa ? 'var(--accent)' : 'var(--text-secondary)',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <i className="ti ti-man" style={{ fontSize: '1.1rem' }} />
                  <span>
                    {v.rotulo}
                    <span style={{ opacity: 0.6, fontWeight: 400 }}> · {v.descricao}</span>
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={handleVoiceOff}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px',
                borderRadius: '8px',
                fontSize: '12px',
                textAlign: 'left',
                background: narracaoDesligada ? 'rgba(var(--accent-rgb), 0.1)' : 'transparent',
                color: narracaoDesligada ? 'var(--accent)' : 'var(--text-secondary)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <i className="ti ti-volume-off" style={{ fontSize: '1.1rem' }} />
              Voz desativada
            </button>
          </div>

          <div style={{ borderTop: '1px solid rgba(var(--accent-rgb), 0.06)', paddingTop: '12px' }}>
            <p
              style={{
                fontSize: '10px',
                color: 'var(--text-tertiary)',
                padding: '0 8px 8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 700,
              }}
            >
              Modo de Leitura
            </p>
            {narrationModes.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => handleModeSelect(m.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  textAlign: 'left',
                  background: mode === m.id ? 'rgba(var(--accent-rgb), 0.1)' : 'transparent',
                  color: mode === m.id ? 'var(--accent)' : 'var(--text-secondary)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
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

/**
 * Alternador Dark/Light: dois botões (lua e sol) num controle segmentado, com
 * o tema ativo marcado. A troca é instantânea e fica salva (hooks/useTheme).
 */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className }) => {
  const { tema, setTema } = useTheme();

  return (
    <fieldset className={`${styles.themeToggle} ${className ?? ''}`}>
      <legend className="sr-only">Tema da interface</legend>
      <button
        type="button"
        className={`${styles.themeToggleBtn} ${tema === 'dark' ? styles.active : ''}`}
        onClick={() => setTema('dark')}
        aria-pressed={tema === 'dark'}
        title="Tema escuro"
      >
        <Icon name="moon" aria-hidden="true" />
        <span className="sr-only">Tema escuro</span>
      </button>
      <button
        type="button"
        className={`${styles.themeToggleBtn} ${tema === 'light' ? styles.active : ''}`}
        onClick={() => setTema('light')}
        aria-pressed={tema === 'light'}
        title="Tema claro"
      >
        <Icon name="sun" aria-hidden="true" />
        <span className="sr-only">Tema claro</span>
      </button>
    </fieldset>
  );
};

/**
 * Atalho para a tela de conversas, com o selo de mensagens não lidas.
 *
 * POR QUE UM <a> E NÃO UMA ROTA DO PORTAL
 * ---------------------------------------
 * A conversa em si vive em /html/conversas.html, servida fora deste app. Ela
 * reusa `js/chat-direto-manager.js` — as 2200 linhas que já resolvem anexo,
 * áudio, reação, edição e socket. Reimplementar aquilo em React só para manter
 * o responsável dentro do portal criaria uma segunda implementação do mesmo
 * chat, e a segunda é sempre a que fica para trás na primeira correção.
 *
 * A sessão é a mesma (cookie), então a navegação é direta.
 *
 * O selo existe para a pessoa SABER que há algo esperando antes de sair do
 * portal — sem ele, o atalho seria uma porta sem indicação nenhuma.
 */
const ConversasButton: React.FC = () => {
  const [naoLidas, setNaoLidas] = useState(0);

  useEffect(() => {
    let ativo = true;

    const buscar = async () => {
      try {
        const { total } = await getChatNaoLidas();
        if (ativo) setNaoLidas(Number(total) || 0);
      } catch {
        // Selo que não carrega não pode derrubar o cabeçalho que o hospeda.
      }
    };

    buscar();
    const timer = setInterval(buscar, 60000);

    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <a
      className={styles.notificationBell}
      href="/html/conversas.html"
      aria-label={naoLidas > 0 ? `Conversas — ${naoLidas} mensagens não lidas` : 'Conversas'}
      title="Conversas"
    >
      <Icon name="message-circle" aria-hidden="true" />
      {naoLidas > 0 && (
        <span className={styles.notificationBadge} aria-hidden="true">
          {naoLidas > 9 ? '9+' : naoLidas}
        </span>
      )}
    </a>
  );
};

const Header: React.FC<HeaderProps> = ({
  user,
  notifications,
  onLogout,
  onBellClick,
  onProfileClick,
  onMenuClick,
}) => {
  const unreadCount = notifications.filter((n) => !n.lido).length;
  const userPhoto = getPhotoUrl(user.picture);

  return (
    <header className={styles.header}>
      <div className={styles.headerContent}>
        {onMenuClick && (
          <button
            type="button"
            className={styles.headerMenuBtn}
            onClick={onMenuClick}
            aria-label="Abrir menu de navegação"
          >
            <Icon name="menu" aria-hidden="true" />
          </button>
        )}

        {/* Logo bicolor: "Sistema" na cor do texto + "Escolar" na cor da marca */}
        <div className={styles.logo}>
          <div className={styles.logoIcon} aria-hidden="true">
            <Icon name="school" />
          </div>
          <div className={styles.logoTextGroup}>
            <span className={styles.logoText}>
              <span className={styles.logoTextWhite}>Sistema</span>{' '}
              <span className={styles.logoTextCyan}>Escolar</span>
            </span>
            <span className={styles.logoSub}>Portal do Responsável</span>
          </div>
        </div>

        <div className={styles.headerActions}>
          {/* Utilidades: somem em telas menores e seguem no menu do perfil */}
          <div className={styles.headerUtilityGroup}>
            <VoiceSelector />
            <ConversasButton />
            <CanalDenuncia />
            <button
              type="button"
              className={styles.notificationBell}
              onClick={() => windowBridge.startTourManual?.()}
              title="Ver Tour Guiado"
              aria-label="Ver Tour Guiado"
            >
              <Icon name="help" aria-hidden="true" />
            </button>
          </div>

          {/* Notificações */}
          <button
            type="button"
            className={`${styles.notificationBell} ${styles.headerBell}`}
            onClick={onBellClick}
            aria-label={
              unreadCount > 0 ? `${unreadCount} notificações não lidas` : 'Nenhuma notificação nova'
            }
          >
            <Icon
              name="bell-filled"
              className={unreadCount > 0 ? styles.bellRinging : undefined}
              aria-hidden="true"
            />
            {unreadCount > 0 && (
              <span className={styles.notificationBadge} aria-hidden="true">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <ThemeToggle className={styles.headerThemeToggle} />

          {/* Perfil do responsável: abre o menu do perfil */}
          <button
            type="button"
            className={styles.userProfile}
            onClick={onProfileClick}
            aria-label="Opções do perfil"
            aria-haspopup="dialog"
            title="Opções do perfil"
          >
            <div className={styles.avatar} aria-hidden="true">
              {userPhoto !== '/img/default-avatar.png' ? (
                <img
                  src={userPhoto}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/img/default-avatar.png';
                  }}
                />
              ) : (
                <Icon name="user-round" />
              )}
            </div>

            <div className={styles.userInfo}>
              <span className={styles.userName}>{user.name}</span>
              <span className={styles.userEmail}>{user.email}</span>
            </div>

            <Icon name="chevron-down" className={styles.headerDropdownArrow} aria-hidden="true" />
          </button>

          <button
            type="button"
            className={styles.logoutBtn}
            onClick={onLogout}
            aria-label="Sair da conta"
          >
            <Icon name="logout" aria-hidden="true" />
            <span>Sair</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
