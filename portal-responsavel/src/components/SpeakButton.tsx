import React, { useState, useEffect } from 'react';
import { Volume2, Square, Loader2 } from 'lucide-react';
import { getTTSAudio } from '../services/apiService';

interface Props {
  text: string;
}

let globalAudio: HTMLAudioElement | null = null;

const SpeakButton: React.FC<Props> = ({ text }) => {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [voicePref, setVoicePref] = useState(localStorage.getItem('user_voice_preference') || 'off');

  useEffect(() => {
    const handleVoiceChange = () => {
      setVoicePref(localStorage.getItem('user_voice_preference') || 'off');
    };
    window.addEventListener('voicePreferenceChanged', handleVoiceChange);
    return () => window.removeEventListener('voicePreferenceChanged', handleVoiceChange);
  }, []);

  if (voicePref === 'off') return null;

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
      
      const blob = await getTTSAudio(cleanText, voicePref as 'male' | 'female');
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
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        playing 
          ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' 
          : 'bg-white/5 text-zinc-400 border border-white/10 hover:text-white hover:bg-white/10'
      }`}
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : playing ? (
        <Square className="w-3.5 h-3.5 fill-current" />
      ) : (
        <Volume2 className="w-3.5 h-3.5" />
      )}
      {loading ? 'Carregando...' : playing ? 'Parar' : 'Ouvir'}
    </button>
  );
};

export default SpeakButton;
