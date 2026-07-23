import React, { useState } from 'react';
import { Volume2, Square, Loader2 } from 'lucide-react';

interface Props {
  text: string;
}

let globalAudio: HTMLAudioElement | null = null;

  const SpeakButton: React.FC<Props> = ({ text }) => {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  const stripHtml = (html: string) => {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  };

  const toggleSpeak = async () => {
    if (playing) {
      if (globalAudio) {
        globalAudio.pause();
        globalAudio = null;
      }
      setPlaying(false);
      return;
    }

    try {
      setLoading(true);
      const cleanText = stripHtml(text);
      const voiceName = localStorage.getItem('user_elevenlabs_voice') || 'adam';
      
      const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
      const csrf = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';

      const BASE = import.meta.env.DEV
        ? (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
        : '/api';

      const res = await fetch(`${BASE}/tts/speak`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {})
        },
        body: JSON.stringify({ text: cleanText, voiceId: voiceName, provider: 'elevenlabs' })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      
      if (globalAudio) globalAudio.pause();
      
      const audio = new Audio(url);
      globalAudio = audio;
      
      audio.onplay = () => {
        setPlaying(true);
        setLoading(false);
      };
      audio.onended = () => {
        setPlaying(false);
        globalAudio = null;
      };
      audio.onerror = () => {
        setPlaying(false);
        setLoading(false);
        globalAudio = null;
      };
      
      audio.play();

    } catch (e) {
      console.error('TTS Error:', e);
      setLoading(false);
      setPlaying(false);
    }
  };

  return (
    <button
      onClick={toggleSpeak}
      disabled={loading}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        borderRadius: '8px',
        fontSize: '0.75rem',
        fontWeight: 500,
        transition: 'all 0.2s',
        cursor: loading ? 'default' : 'pointer',
        background: playing ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255, 255, 255, 0.05)',
        color: playing ? '#a78bfa' : '#a1a1aa',
        border: playing ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      {loading ? (
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
      ) : playing ? (
        <Square size={14} style={{ fill: 'currentColor' }} />
      ) : (
        <Volume2 size={14} />
      )}
      {loading ? 'Carregando...' : playing ? 'Parar' : 'Ouvir'}
    </button>
  );
};

export default SpeakButton;
