import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Trash2, Send, Play, Pause } from 'lucide-react';

interface VoiceRecorderProps {
  onSend: (audioBlob: Blob) => void;
  onCancel: () => void;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onSend, onCancel }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
      setError(null);
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => {
        setRecordingTime((prev: number) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Não foi possível acessar o microfone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const deleteRecording = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
    setIsPlaying(false);
  };

  const togglePlayback = () => {
    if (!audioPlayerRef.current) return;
    if (isPlaying) {
      audioPlayerRef.current.pause();
    } else {
      audioPlayerRef.current.play();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-zinc-800/80 border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-2">
      {!audioUrl && isRecording && (
        <div className="flex items-center gap-3 flex-1">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <span className="text-sm font-medium text-white">{formatTime(recordingTime)}</span>
          <div className="flex-1 flex gap-1 items-center px-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div 
                key={i} 
                className="w-1 bg-accent-primary rounded-full animate-bounce" 
                style={{ height: `${Math.random() * 20 + 5}px`, animationDelay: `${i * 0.1}s` }} 
              />
            ))}
          </div>
        </div>
      )}

      {!audioUrl && !isRecording && (
        <div className="flex items-center gap-3 flex-1 text-zinc-400">
          <Mic size={18} />
          <span className="text-sm">Clique no microfone para gravar...</span>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      )}

      {audioUrl && !isRecording && (
        <div className="flex items-center gap-3 flex-1">
          <button 
            type="button"
            onClick={togglePlayback}
            className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-black"
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className={`h-full bg-accent-primary transition-all duration-300 ${isPlaying ? 'w-full' : 'w-0'}`} />
          </div>
          <span className="text-xs text-zinc-400">{formatTime(recordingTime)}</span>
          <audio 
            ref={audioPlayerRef} 
            src={audioUrl} 
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            hidden 
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        {!audioUrl && !isRecording && (
          <>
            <button
              type="button"
              onClick={onCancel}
              className="p-2 text-zinc-400 hover:text-white"
            >
              <Trash2 size={20} />
            </button>
            <button
              type="button"
              onClick={startRecording}
              className="w-10 h-10 rounded-full bg-accent-primary flex items-center justify-center text-black hover:scale-110 transition-transform"
            >
              <Mic size={20} />
            </button>
          </>
        )}

        {!audioUrl && isRecording && (
          <button
            type="button"
            onClick={stopRecording}
            className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center text-white hover:scale-110 transition-transform"
          >
            <Square size={20} />
          </button>
        )}

        {audioUrl && (
          <>
            <button
              type="button"
              onClick={deleteRecording}
              className="p-2 text-zinc-400 hover:text-white"
            >
              <Trash2 size={20} />
            </button>
            <button
              type="button"
              onClick={() => audioBlob && onSend(audioBlob)}
              className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white hover:scale-110 transition-transform"
            >
              <Send size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default VoiceRecorder;
