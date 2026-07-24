import React, { useState, useEffect, useRef } from 'react';
import { postChatbotMessage } from '../services/apiService';
import { useTTS } from '../hooks/useTTS';
import VoiceOrb from './VoiceOrb';
import styles from '../styles/portal.module.scss';
import Icon from './ui/Icon';

interface Message {
  text: string;
  isAi: boolean;
  timestamp: Date;
  options?: { label: string; value?: string; alunoId?: string }[];
}

interface ChatbotIAProps {
  alunoId?: string;
}

// Vozes ElevenLabs disponíveis (masculinas)
const ELEVENLABS_VOICES = [
  { id: 'adam',   label: 'Adam',   desc: 'Firme e dominante' },
  { id: 'brian',  label: 'Brian',  desc: 'Profundo e tranquilo' },
  { id: 'eric',   label: 'Eric',   desc: 'Suave e confiável' },
  { id: 'george', label: 'George', desc: 'Caloroso e narrativo' },
] as const;

type VoiceId = typeof ELEVENLABS_VOICES[number]['id'];

const ChatbotIA: React.FC<ChatbotIAProps> = ({ alunoId }: ChatbotIAProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { text: 'Olá! Sou o seu Assistente Escolar IA. Como posso ajudar com informações sobre sua conta ou o desempenho do seu filho(a)?', isAi: true, timestamp: new Date() }
  ]);
  const [loading, setLoading] = useState(false);
  const [activeMessageIndex, setActiveMessageIndex] = useState<number | null>(null);
  // alunoId resolvido pelo backend (mantém contexto entre turnos)
  const [currentAlunoId, setCurrentAlunoId] = useState<string | undefined>(alunoId);
  // última pergunta enviada (para reenviar com alunoId ao clicar num botão)
  const lastMessageRef = React.useRef<string>('');

  // Voz ElevenLabs selecionada (padrão: adam) — provedor sempre ElevenLabs
  const [selectedVoice, setSelectedVoice] = useState<VoiceId>(
    () => (localStorage.getItem('user_elevenlabs_voice') as VoiceId) || 'adam'
  );

  // Persiste a voz no localStorage sempre que mudar
  useEffect(() => {
    localStorage.setItem('user_elevenlabs_voice', selectedVoice);
    localStorage.setItem('user_tts_provider', 'elevenlabs');
    localStorage.setItem('user_voice_preference', 'male');
  }, [selectedVoice]);

  const [autoPlay, setAutoPlay] = useState(
    () => localStorage.getItem('user_preferencia_narracao') !== 'texto'
  );
  const [showSettings, setShowSettings] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const { isPlaying, speak, stop } = useTTS();

  // Scroll to bottom on updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen, loading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input;
    setInput('');
    lastMessageRef.current = userMsg;
    setMessages((prev: Message[]) => [...prev, { text: userMsg, isAi: false, timestamp: new Date() }]);
    setLoading(true);

    try {
      const res = await postChatbotMessage(userMsg, currentAlunoId);
      // persiste o alunoId resolvido para o próximo turno
      if (res.alunoId) setCurrentAlunoId(res.alunoId);
      const aiMsg: Message = {
        text: res.response,
        isAi: true,
        timestamp: new Date(),
        options: res.options,
      };
      const newIndex = messages.length + 1;
      setMessages(prev => [...prev, aiMsg]);
      if (autoPlay) {
        setTimeout(() => handlePlayAudio(res.response, newIndex), 100);
      }
    } catch (err) {
      setMessages(prev => [...prev, { text: 'Desculpe, estou com dificuldades técnicas agora.', isAi: true, timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  };

  // Layer 1, Rule 4: click resolution uses ID (value), never re-searches by name
  const handleOptionClick = async (option: { label: string; value?: string; alunoId?: string }) => {
    if (loading) return;
    const resolvedId = option.value || option.alunoId || '';
    setCurrentAlunoId(resolvedId);
    const userMsg = lastMessageRef.current || option.label;
    setMessages(prev => [...prev, { text: option.label, isAi: false, timestamp: new Date() }]);
    setLoading(true);
    try {
      const res = await postChatbotMessage(userMsg, resolvedId);
      if (res.alunoId) setCurrentAlunoId(res.alunoId);
      const aiMsg: Message = {
        text: res.response,
        isAi: true,
        timestamp: new Date(),
        options: res.options,
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      setMessages(prev => [...prev, { text: 'Desculpe, estou com dificuldades técnicas agora.', isAi: true, timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayAudio = async (text: string, index: number) => {
    if (isPlaying && activeMessageIndex === index) {
      stop();
      setActiveMessageIndex(null);
      return;
    }
    setActiveMessageIndex(index);
    // Sempre usa ElevenLabs com a voz masculina selecionada
    await speak(text, 'male', 'elevenlabs');
  };

  // Reset active index when playback stops externally
  useEffect(() => {
    if (!isPlaying) {
      setActiveMessageIndex(null);
    }
  }, [isPlaying]);

  return (
    <div className={styles.chatbotContainer}>
      {/* Botão de Abrir */}
      {!isOpen && (
        <button 
          className={styles.chatbotFab} 
          onClick={() => setIsOpen(true)}
          aria-label="Abrir Chatbot IA"
        >
          <Icon name="robot" />
        </button>
      )}

      {/* Janela do Chat */}
      {isOpen && (
        <div className={styles.chatbotWindow}>
          <header className={styles.chatbotHeader}>
            <div className={styles.headerInfo}>
              <Icon name="robot" />
              <div>
                <strong>Assistente IA</strong>
                <span>Online</span>
              </div>
            </div>
            <div className={styles.chatbotHeaderActions}>
              <button 
                onClick={() => setShowSettings(!showSettings)} 
                className={styles.settingsBtn} 
                title="Configurações de Voz"
              >
                <Icon name="settings" />
              </button>
              <button onClick={() => { stop(); setIsOpen(false); }} className={styles.closeBtn}>
                <Icon name="x" />
              </button>
            </div>
          </header>

          {showSettings && (
            <div className={styles.audioSettingsPanel}>
              {/* Seletor de voz ElevenLabs — sempre masculino */}
              <div className={styles.settingItem}>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '8px' }}>
                  🎙️ Voz do Assistente
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {ELEVENLABS_VOICES.map(v => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVoice(v.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        border: selectedVoice === v.id
                          ? '2px solid #10b981'
                          : '1px solid rgba(255,255,255,0.1)',
                        background: selectedVoice === v.id
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'rgba(255,255,255,0.04)',
                        color: selectedVoice === v.id ? '#10b981' : '#cbd5e1',
                        textAlign: 'left' as const,
                      }}
                    >
                      <div>{v.label}</div>
                      <div style={{ fontSize: '0.68rem', opacity: 0.6, fontWeight: 400 }}>{v.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Autoplay */}
              <div className={styles.settingItem} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.82rem', color: '#cbd5e1' }}>
                  <input
                    type="checkbox"
                    checked={autoPlay}
                    onChange={(e) => {
                      setAutoPlay(e.target.checked);
                      localStorage.setItem('user_preferencia_narracao', e.target.checked ? 'audio' : 'texto');
                    }}
                    style={{ accentColor: '#10b981' }}
                  />
                  Ouvir respostas automaticamente
                </label>
              </div>
            </div>
          )}

          <div className={styles.chatBody} ref={scrollRef}>
            {messages.map((m, i) => (
              <div className={`${styles.chatMsg} ${m.isAi ? styles.ai : styles.user}`} key={i}>
                <div className={styles.msgText}>
                  {m.text}
                  {m.isAi && (
                    <div className={styles.audioControls}>
                      <button 
                        onClick={() => handlePlayAudio(m.text, i)} 
                        className={styles.audioBtn}
                        title={isPlaying && activeMessageIndex === i ? "Pausar" : "Ouvir resposta"}
                      >
                        <Icon name={isPlaying && activeMessageIndex === i ? "player-pause" : "volume"} />
                      </button>
                    </div>
                  )}
                  {/* Botões de opção — aparecem quando o backend retorna múltiplos alunos */}
                  {m.isAi && m.options && m.options.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                      {m.options.map((opt, oi) => (
                        <button
                          key={oi}
                          onClick={() => handleOptionClick(opt)}
                          disabled={loading}
                          style={{
                            padding: '8px 14px',
                            borderRadius: '10px',
                            fontSize: '0.82rem',
                            fontWeight: 600,
                            cursor: loading ? 'default' : 'pointer',
                            background: 'rgba(16, 185, 129, 0.12)',
                            color: '#10b981',
                            border: '1px solid rgba(16, 185, 129, 0.35)',
                            textAlign: 'left',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,0.22)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,0.12)'; }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.msgTime}>{m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            ))}
            
            {/* Modo 1 - Orbe Grande no Chat */}
            {isPlaying && (
              <div className={styles.voiceStage}>
                <VoiceOrb 
                  size="large" 
                  isPlaying={true}
                  onClick={() => stop()}
                />
              </div>
            )}

            {loading && (
              <div className={`${styles.chatMsg} ${styles.ai}`}>
                <div className={styles.loader}>
                  <span /> <span /> <span />
                </div>
              </div>
            )}
          </div>

          <form className={styles.chatInput} onSubmit={handleSend}>
            <input 
              type="text" 
              placeholder="Pergunte sobre notas, faltas..." 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <button type="submit" disabled={!input.trim() || loading}>
              <Icon name="send" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ChatbotIA;
