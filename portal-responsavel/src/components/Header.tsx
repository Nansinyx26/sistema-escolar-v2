/**
 * components/Header.tsx
 * Sticky top navigation bar with school logo, notification bell,
 * user avatar and logout button. Fully responsive.
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import schoolLogo from '../assets/logo-jaguari.png';
import { getChatNaoLidas } from '../services/apiService';
import styles from '../styles/portal.module.scss';
import { type VozNome, VOZES, definirVoz, normalizarVoz, vozAtual } from '../constants/vozes';
import type { GmailUser, Notification } from '../types';
import { getPhotoUrl } from '../utils/photoUtils';
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
  /*
   * Este menu oferecia "Voz Masculina" e "Voz Desativada" — um liga/desliga
   * fantasiado de escolha de voz. As quatro vozes masculinas do sistema já
   * existiam no backend e no painel do chatbot, mas não aqui, que é justamente
   * o controle global do portal.
   *
   * Duas coisas diferentes moram neste menu, e agora em chaves diferentes:
   *   - QUAL voz  → `user_elevenlabs_voice`, o que `/api/tts/speak` recebe
   *   - narração ligada ou não → `user_voice_preference` ('male' | 'off')
   * Antes as duas dividiam a segunda chave, então escolher uma voz e desligar
   * a narração eram a mesma gaveta.
   */
  const [voice, setVoice] = useState<VozNome>(() => vozAtual());
  const [narracaoDesligada, setNarracaoDesligada] = useState(
    () => localStorage.getItem('user_voice_preference') === 'off'
  );
  const [mode, setMode] = useState(localStorage.getItem('user_narration_mode') || 'texto_audio');
  const [isOpen, setIsOpen] = useState(false);

  // Trocar a voz no painel do chatbot tem de refletir aqui, e vice-versa.
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
    // `definirVoz` grava as duas chaves, avisa a página e persiste no servidor.
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
    // No JS legado, isso dispara classes no body
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
        style={{ color: narracaoDesligada ? '' : '#059669' }}
      >
        <i
          className={`ti ${narracaoDesligada ? 'ti-volume-off' : 'ti-volume-2'}`}
          style={{ fontSize: '1.4rem' }}
        />
      </button>

      {isOpen && (
        // O onMouseLeave abaixo só fecha o painel por conveniência do
        // ponteiro. Não existe gesto de teclado equivalente a "saiu com o
        // mouse", e os botões de dentro já são alcançáveis por Tab — o painel
        // nunca depende do hover para operar.
        // biome-ignore lint/a11y/noStaticElementInteractions: fechar no hover é gesto de ponteiro, sem equivalente de teclado
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '8px',
            background: '#1a211d',
            border: '1px solid rgba(255,255,255,0.08)',
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
                color: '#71717a',
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
                    background: ativa ? 'rgba(5, 150, 105, 0.1)' : 'transparent',
                    color: ativa ? '#059669' : '#a1a1aa',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <i className="ti ti-man" style={{ fontSize: '1.1rem' }} />
                  <span>
                    {v.rotulo}
                    {/* A descrição é o que torna a lista escolhível: quatro
                        nomes próprios sozinhos não dizem como a voz soa. */}
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
                background: narracaoDesligada ? 'rgba(5, 150, 105, 0.1)' : 'transparent',
                color: narracaoDesligada ? '#059669' : '#a1a1aa',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <i className="ti ti-volume-off" style={{ fontSize: '1.1rem' }} />
              Voz desativada
            </button>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
            <p
              style={{
                fontSize: '10px',
                color: '#71717a',
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
                  background: mode === m.id ? 'rgba(5, 150, 105, 0.1)' : 'transparent',
                  color: mode === m.id ? '#059669' : '#a1a1aa',
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

const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    const saved = (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    setTheme(saved);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.setAttribute('data-theme', next);
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
  };

  return (
    <button
      type="button"
      className={styles.notificationBell}
      onClick={toggleTheme}
      title={theme === 'light' ? 'Modo Escuro' : 'Modo Claro'}
      aria-label={theme === 'light' ? 'Alternar para Modo Escuro' : 'Alternar para Modo Claro'}
      style={{ color: theme === 'light' ? '#d97706' : '#10b981' }}
    >
      <i
        className={`ti ${theme === 'light' ? 'ti-sun' : 'ti-moon'}`}
        style={{ fontSize: '1.4rem' }}
      />
    </button>
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
        // O componente pode ter desmontado durante a requisição.
        if (ativo) setNaoLidas(Number(total) || 0);
      } catch {
        // Selo que não carrega não pode derrubar o cabeçalho que o hospeda:
        // fica no último valor conhecido e tenta de novo no próximo ciclo.
      }
    };

    buscar();
    // Sem socket neste componente: o portal não mantém a conexão do chat. Um
    // minuto é o suficiente para um selo que só indica "há algo lá".
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
}) => {
  const unreadCount = notifications.filter((n) => !n.lido).length;
  const userPhoto = getPhotoUrl(user.picture);

  return (
    <header className={styles.header}>
      <div className={styles.headerContent}>
        {/* Logo */}
        <div className={styles.logo}>
          <img src={schoolLogo} alt="" aria-hidden="true" />
          <span className={styles.logoText}>Escola Jaguari</span>
          <span className={styles.logoSub}>Portal do Responsável</span>
        </div>

        {/* Actions — agrupadas em clusters (utilidades | notificação+conta)
            separados por um divisor, em vez de uma fileira única de ícones */}
        <div className={styles.headerActions}>
          <div className={styles.headerUtilityGroup}>
            <VoiceSelector />
            <ThemeToggle />

            <ConversasButton />

            {/* Botão Ver Tour Guiado */}
            <button
              type="button"
              className={styles.notificationBell}
              onClick={() => windowBridge.startTourManual?.()}
              title="Ver Tour Guiado"
              aria-label="Ver Tour Guiado"
            >
              <Icon name="help" aria-hidden="true" style={{ fontSize: '1.4rem' }} />
            </button>
          </div>

          <span className={styles.headerDivider} aria-hidden="true" />

          {/* Notification bell */}
          <button
            type="button"
            className={styles.notificationBell}
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

          {/* User profile (clickable to open sidebar) */}
          <button
            type="button"
            className={styles.userProfile}
            onClick={onProfileClick}
            aria-label="Opções do perfil"
            title="Clique para ver as opções do perfil"
          >
            <div className={styles.avatar} aria-hidden="true">
              {userPhoto !== '/img/default-avatar.png' ? (
                <img
                  src={userPhoto}
                  alt={user.name}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/img/default-avatar.png';
                  }}
                />
              ) : (
                <span>{getInitials(user.name)}</span>
              )}
            </div>

            <div className={styles.userInfo}>
              <span className={styles.userName}>{user.name}</span>
              <span className={styles.userEmail}>{user.email}</span>
            </div>
          </button>

          {/* Logout */}
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
