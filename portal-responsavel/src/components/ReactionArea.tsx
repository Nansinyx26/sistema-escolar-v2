/**
 * components/ReactionArea.tsx
 * Premium React component for Emoji Reactions.
 * Allows guardians to react to notifications with categorized emojis.
 * Syncs in real-time with the MongoDB backend.
 */

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import styles from '../styles/portal.module.scss';
import Icon from './ui/Icon';

interface ReactionUser {
  name: string;
  type?: string;
}

interface EmojiSummary {
  count: number;
  users: ReactionUser[];
}

interface ReactionSummary {
  [emoji: string]: EmojiSummary;
}

interface ReactionAreaProps {
  messageId: string;
  initialReactionsCount?: number;
}

const EMOJI_CATEGORIES = [
  {
    id: 'frequentes',
    icon: '🕐',
    label: 'Frequentes',
    emojis: ['👍', '❤️', '😂', '🔥', '👏', '😮', '😢', '🎉']
  },
  {
    id: 'maos',
    icon: '👋',
    label: 'Mãos',
    emojis: ['👍', '👎', '👏', '🙌', '🤝', '💪', '🙏', '✊']
  },
  {
    id: 'coracoes',
    icon: '❤️',
    label: 'Corações',
    emojis: ['❤️', '💙', '💚', '💛', '🧡', '💜', '🖤', '🤍']
  },
  {
    id: 'rostos',
    icon: '😊',
    label: 'Rostos',
    emojis: ['😂', '🤣', '😆', '😄', '😊', '😍', '😘', '😎', '🤔', '🤨', '😮', '🤯', '😲', '😱', '😢', '😭', '🥺']
  },
  {
    id: 'simbolos',
    icon: '⭐',
    label: 'Símbolos',
    emojis: ['🔥', '💯', '⭐', '✨', '🎉', '🎊', '🏆', '🚀']
  },
  {
    id: 'escola',
    icon: '📚',
    label: 'Escola',
    emojis: ['📚', '✏️', '🎓', '📝', '📖', '🏫', '🧑‍🏫', '📐']
  }
];

const BASE_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
  : '/api';

import { socket } from '../services/socket';

/**
 * Token CSRF do cookie. SEM ele, o backend bloqueia POST/DELETE com 403
 * (double-submit cookie) — era ESTE o motivo de as reações não registrarem:
 * o fetch cru daqui não enviava o header que o apiService já envia.
 */
function getCsrfToken(): string | null {
  const m = document.cookie.match(/csrf_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function mutatingHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const csrf = getCsrfToken();
  if (csrf) h['X-CSRF-Token'] = csrf;
  return h;
}

/** Reconstrói o resumo (emoji → contagem/usuários) a partir da lista crua. */
function buildSummary(all: any[]): ReactionSummary {
  const summary: ReactionSummary = {};
  (all || []).forEach((r: any) => {
    if (!summary[r.emoji]) summary[r.emoji] = { count: 0, users: [] };
    summary[r.emoji].count++;
    summary[r.emoji].users.push({ name: r.senderName || 'Usuário', type: r.senderType });
  });
  return summary;
}

export const ReactionArea: React.FC<ReactionAreaProps> = ({ messageId }) => {
  const [reactions, setReactions] = useState<ReactionSummary>({});
  const [currentUser, setCurrentUser] = useState<{ nome: string } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState(EMOJI_CATEGORIES[0].id);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Fetch current user & reactions on mount
  useEffect(() => {
    // Get currentUser from API
    fetch(`${BASE_URL}/auth/me`, { credentials: 'include' })
      .then(res => res.json())
      .then((data: { success: boolean; user?: { nome: string } }) => {
        if (data.success && data.user) {
          setCurrentUser(data.user);
        }
      })
      .catch(() => {});
  }, []);

  const fetchReactions = async () => {
    try {
      const res = await fetch(`${BASE_URL}/reactions/message/${messageId}`, { credentials: 'include' });
      const json = await res.json() as { success: boolean; summary?: ReactionSummary; data?: any[] };
      if (json.success && json.summary) {
        setReactions(json.summary);
      } else {
        setReactions({});
      }
    } catch (e) {
      console.error('Error loading reactions:', e);
    }
  };

  useEffect(() => {
    if (messageId) {
      fetchReactions();
    }
  }, [messageId, currentUser]);

  useEffect(() => {
    if (!messageId) return;

    const handleReactionSync = (data: { messageId: string; summary: ReactionSummary }) => {
      if (data.messageId === messageId) {
        setReactions(data.summary);
      }
    };

    // Entra na sala desta mensagem para receber eventos direcionados
    socket.emit('join:message', messageId);

    socket.on('reaction:add', handleReactionSync);
    socket.on('reaction:update', handleReactionSync);
    socket.on('reaction:remove', handleReactionSync);

    return () => {
      socket.off('reaction:add', handleReactionSync);
      socket.off('reaction:update', handleReactionSync);
      socket.off('reaction:remove', handleReactionSync);
    };
  }, [messageId]);

  const toggleReaction = async (emoji: string) => {
    const nome = currentUser?.nome || '';
    const emojiData = reactions[emoji];
    const hasReacted = emojiData?.users?.some(u => u.name === nome);

    // ── Atualização OTIMISTA: reflete o clique na hora, antes do servidor ──
    const anterior = reactions;
    const otimista: ReactionSummary = JSON.parse(JSON.stringify(reactions));
    // Remove qualquer reação anterior deste usuário (1 por usuário)
    Object.keys(otimista).forEach(e => {
      otimista[e].users = otimista[e].users.filter(u => u.name !== nome);
      otimista[e].count = otimista[e].users.length;
      if (otimista[e].count === 0) delete otimista[e];
    });
    if (!hasReacted) {
      if (!otimista[emoji]) otimista[emoji] = { count: 0, users: [] };
      otimista[emoji].users.push({ name: nome, type: 'responsavel' });
      otimista[emoji].count = otimista[emoji].users.length;
    }
    setReactions(otimista);
    setShowPicker(false);

    try {
      let res;
      if (hasReacted) {
        res = await fetch(`${BASE_URL}/reactions/${messageId}`, {
          method: 'DELETE',
          headers: mutatingHeaders(false),
          credentials: 'include'
        });
      } else {
        res = await fetch(`${BASE_URL}/reactions`, {
          method: 'POST',
          headers: mutatingHeaders(true),
          credentials: 'include',
          body: JSON.stringify({ messageId, emoji })
        });
      }

      const json = await res.json() as { success: boolean; allReactions?: any[]; summary?: ReactionSummary };
      if (json.success) {
        // Confirmação do servidor sobrescreve o otimista com a verdade
        setReactions(json.summary || buildSummary(json.allReactions || []));
      } else {
        setReactions(anterior); // rollback
      }
    } catch (e) {
      console.error('Error toggling reaction:', e);
      setReactions(anterior); // rollback em erro de rede
    }
  };

  // Scrollspy logic inside picker
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let currentSectionId = EMOJI_CATEGORIES[0].id;
    let minDiff = Infinity;

    EMOJI_CATEGORIES.forEach(cat => {
      const section = sectionRefs.current[cat.id];
      if (section) {
        const diff = Math.abs(section.offsetTop - container.scrollTop);
        if (diff < minDiff) {
          minDiff = diff;
          currentSectionId = cat.id;
        }
      }
    });

    setActiveTab(currentSectionId);
  };

  const scrollToCategory = (catId: string) => {
    setActiveTab(catId);
    const section = sectionRefs.current[catId];
    const container = scrollContainerRef.current;
    if (section && container) {
      container.scrollTo({
        top: section.offsetTop,
        behavior: 'smooth'
      });
    }
  };

  // Render picker using React Portals to guarantee overlay layering
  const renderPickerModal = () => {
    if (!showPicker) return null;

    const modalMarkup = (
      <div 
        className={styles.reactionPickerOverlay + ' ' + styles.open} 
        onClick={() => setShowPicker(false)}
      >
        <div 
          className={styles.reactionPickerModal + ' ' + styles.open} 
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className={styles.reactionPickerHeader}>
            <span className={styles.reactionPickerTitle}>Escolha uma reação</span>
            <button 
              className={styles.reactionPickerClose} 
              onClick={() => setShowPicker(false)}
              aria-label="Fechar"
            >
              &times;
            </button>
          </div>

          {/* Category Tabs */}
          <div className={styles.reactionPickerTabs}>
            {EMOJI_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                className={`${styles.reactionPickerTab} ${activeTab === cat.id ? styles.active : ''}`}
                title={cat.label}
                onClick={() => scrollToCategory(cat.id)}
              >
                <span className={styles.reactionTabIcon}>{cat.icon}</span>
              </button>
            ))}
          </div>

          {/* Grid body */}
          <div 
            className={styles.reactionPickerBody}
            ref={scrollContainerRef}
            onScroll={handleScroll}
          >
            {EMOJI_CATEGORIES.map(cat => (
              <div
                key={cat.id}
                className={styles.reactionPickerSection}
                ref={el => { sectionRefs.current[cat.id] = el; }}
              >
                <div className={styles.reactionPickerCategoryLabel}>{cat.label}</div>
                <div className={styles.reactionPickerGrid}>
                  {cat.emojis.map(emoji => (
                    <button
                      key={emoji}
                      className={styles.reactionPickerEmoji}
                      onClick={() => {
                        toggleReaction(emoji);
                        setShowPicker(false);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    return ReactDOM.createPortal(modalMarkup, document.body);
  };

  // Render existing active chips
  const activeChips = Object.keys(reactions).filter(emoji => reactions[emoji].count > 0);

  return (
    <div className={styles.reactionBar} onClick={e => e.stopPropagation()}>
      {activeChips.map(emoji => {
        const data = reactions[emoji];
        const hasReacted = data.users?.some(u => u.name === currentUser?.nome);
        const userList = data.users?.map(u => u.name).join(', ') || '';
        
        return (
          <button
            key={emoji}
            className={`${styles.reactionChip} ${hasReacted ? styles.active : ''}`}
            onClick={() => toggleReaction(emoji)}
            title={userList}
          >
            <span className={styles.reactionEmoji}>{emoji}</span>
            <span className={styles.reactionCount}>{data.count}</span>
          </button>
        );
      })}

      <button
        className={styles.reactionAddBtn}
        onClick={() => setShowPicker(true)}
        aria-label="Adicionar reação"
        title="Reagir"
      >
        <Icon name="mood-smile" />
      </button>

      {renderPickerModal()}
    </div>
  );
};

export default ReactionArea;
