/**
 * components/ReactionArea.tsx
 * Premium React component for Emoji Reactions.
 * Allows guardians to react to notifications with categorized emojis.
 * Syncs in real-time with the MongoDB backend.
 */

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import styles from '../styles/portal.module.scss';

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
    const emojiData = reactions[emoji];
    const hasReacted = emojiData?.users?.some(u => u.name === currentUser?.nome);

    try {
      let res;
      if (hasReacted) {
        res = await fetch(`${BASE_URL}/reactions/${messageId}`, {
          method: 'DELETE',
          credentials: 'include'
        });
      } else {
        res = await fetch(`${BASE_URL}/reactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ messageId, emoji })
        });
      }

      const json = await res.json() as { success: boolean; allReactions?: any[] };
      if (json.success && json.allReactions) {
        // Rebuild summary locally
        const summary: ReactionSummary = {};
        json.allReactions.forEach((r: any) => {
          if (!summary[r.emoji]) {
            summary[r.emoji] = { count: 0, users: [] };
          }
          summary[r.emoji].count++;
          summary[r.emoji].users.push({ name: r.senderName || 'Usuário', type: r.senderType });
        });
        setReactions(summary);
      } else {
        fetchReactions();
      }
    } catch (e) {
      console.error('Error toggling reaction:', e);
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
        <i className="ti ti-mood-smile" />
      </button>

      {renderPickerModal()}
    </div>
  );
};

export default ReactionArea;
