import React, { useState, useEffect, useRef } from 'react';
import { streamCopiloto } from '../services/apiService';
import { useTTS } from '../hooks/useTTS';
import { type VozNome, VOZES, definirVoz, normalizarVoz, vozAtual } from '../constants/vozes';
import VoiceOrb from './VoiceOrb';
import styles from '../styles/portal.module.scss';
import Icon from './ui/Icon';

interface Message {
  text: string;
  isAi: boolean;
  timestamp: Date;
  options?: { label: string; value?: string; alunoId?: string }[];
}

/**
 * Sem props de contexto de aluno.
 *
 * O chatbot legado recebia `alunoId` do portal e o repassava ao backend para
 * saber de qual filho se falava. O copiloto não aceita esse parâmetro por
 * decisão de segurança: identidade, escola e vínculo saem sempre da sessão no
 * servidor, e o `buscarAluno` já limita o resultado aos filhos do responsável.
 * Manter a prop aqui seria sugerir uma influência que ela não tem.
 */
type ChatbotIAProps = Record<string, never>;

// Vozes ElevenLabs disponíveis (masculinas)

const ChatbotIA: React.FC<ChatbotIAProps> = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { text: 'Olá! Sou o seu Assistente Escolar IA. Como posso ajudar com informações sobre sua conta ou o desempenho do seu filho(a)?', isAi: true, timestamp: new Date() }
  ]);
  const [loading, setLoading] = useState(false);
  const [activeMessageIndex, setActiveMessageIndex] = useState<number | null>(null);
  // Ponteiro da conversa no servidor. O conteúdo do histórico é lido do banco;
  // o cliente não reenvia turnos anteriores.
  const [conversaId, setConversaId] = useState<string | null>(null);
  const lastMessageRef = React.useRef<string>('');

  // Voz do narrador. A lista e o padrão vêm de `constants/vozes` — este
  // componente tinha a própria cópia das quatro vozes e caía em Adam quando
  // ninguém havia escolhido, enquanto o resto do sistema parte de Brian.
  const [selectedVoice, setSelectedVoice] = useState<VozNome>(() => vozAtual());

  // O menu de voz do cabeçalho escreve a mesma preferência; sem ouvir o evento
  // o painel do chat continuava mostrando a voz antiga marcada.
  useEffect(() => {
    const aoTrocar = (e: Event) => {
      const detalhe = (e as CustomEvent<{ voice?: string }>).detail;
      if (detalhe?.voice) setSelectedVoice(normalizarVoz(detalhe.voice));
    };
    window.addEventListener('voiceChanged', aoTrocar);
    return () => window.removeEventListener('voiceChanged', aoTrocar);
  }, []);

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

    // Bolha vazia do assistente: os pedaços do stream vão sendo escritos nela.
    const indiceResposta = messages.length + 1;
    setMessages(prev => [...prev, { text: '', isAi: true, timestamp: new Date() }]);

    try {
      // Copiloto (`/ia/chat`) no lugar do `/ia/chatbot` legado: aqui valem o
      // filtro de ferramentas por cargo e o PermissionGuard, então a conversa
      // alcança só os dados dos próprios filhos.
      const { texto, conversaId: novoId } = await streamCopiloto(
        userMsg,
        conversaId,
        (pedaco) => {
          setMessages(prev => {
            const copia = [...prev];
            const ultima = copia[copia.length - 1];
            if (ultima && ultima.isAi) {
              copia[copia.length - 1] = { ...ultima, text: ultima.text + pedaco };
            }
            return copia;
          });
        }
      );

      // O histórico agora é do servidor; o cliente guarda só o ponteiro.
      setConversaId(novoId);

      if (autoPlay && texto) {
        setTimeout(() => handlePlayAudio(texto, indiceResposta), 100);
      }
    } catch (err) {
      setMessages(prev => {
        const copia = [...prev];
        const ultima = copia[copia.length - 1];
        const aviso = err instanceof Error && err.message
          ? err.message
          : 'Desculpe, estou com dificuldades técnicas agora.';
        // Reaproveita a bolha vazia em vez de deixar um balão em branco na tela.
        if (ultima && ultima.isAi && !ultima.text) {
          copia[copia.length - 1] = { ...ultima, text: aviso };
          return copia;
        }
        return [...prev, { text: aviso, isAi: true, timestamp: new Date() }];
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Clique nos botões de opção (herança do chatbot legado, que os produzia
   * quando havia mais de um filho com o mesmo nome).
   *
   * O copiloto não devolve `options` — ele resolve a ambiguidade conversando,
   * e o `buscarAluno` já limita o resultado aos filhos do responsável. O
   * handler segue aqui porque conversas antigas ainda podem ter botões
   * renderizados na tela: o clique vira uma mensagem comum.
   */
  const handleOptionClick = async (option: { label: string; value?: string; alunoId?: string }) => {
    if (loading) return;
    setMessages(prev => [...prev, { text: option.label, isAi: false, timestamp: new Date() }, { text: '', isAi: true, timestamp: new Date() }]);
    setLoading(true);

    try {
      const { conversaId: novoId } = await streamCopiloto(
        option.label,
        conversaId,
        (pedaco) => {
          setMessages(prev => {
            const copia = [...prev];
            const ultima = copia[copia.length - 1];
            if (ultima && ultima.isAi) {
              copia[copia.length - 1] = { ...ultima, text: ultima.text + pedaco };
            }
            return copia;
          });
        }
      );
      setConversaId(novoId);
    } catch {
      setMessages(prev => {
        const copia = [...prev];
        const ultima = copia[copia.length - 1];
        if (ultima && ultima.isAi && !ultima.text) {
          copia[copia.length - 1] = { ...ultima, text: 'Desculpe, estou com dificuldades técnicas agora.' };
          return copia;
        }
        return [...prev, { text: 'Desculpe, estou com dificuldades técnicas agora.', isAi: true, timestamp: new Date() }];
      });
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
                  {VOZES.map(v => (
                    <button
                      key={v.nome}
                      type="button"
                      // `definirVoz` grava as duas chaves do navegador, avisa o
                      // cabeçalho e persiste no servidor — antes a escolha
                      // ficava só neste navegador.
                      onClick={() => { setSelectedVoice(v.nome); void definirVoz(v.nome); }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        border: selectedVoice === v.nome
                          ? '2px solid #10b981'
                          : '1px solid rgba(255,255,255,0.1)',
                        background: selectedVoice === v.nome
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'rgba(255,255,255,0.04)',
                        color: selectedVoice === v.nome ? '#10b981' : '#cbd5e1',
                        textAlign: 'left' as const,
                      }}
                    >
                      <div>{v.rotulo}</div>
                      <div style={{ fontSize: '0.68rem', opacity: 0.6, fontWeight: 400 }}>{v.descricao}</div>
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
