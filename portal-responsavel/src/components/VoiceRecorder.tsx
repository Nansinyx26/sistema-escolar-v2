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
    <div style={{
      background: 'rgba(39, 39, 42, 0.8)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '16px',
      padding: '16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      animation: 'slideUp 0.2s ease',
    }}>
      {/* Status area */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
        {!audioUrl && isRecording && (
          <>
            <div style={{
              width: '10px', height: '10px',
              background: '#ef4444',
              borderRadius: '50%',
              animation: 'pulse 1s ease infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f5f5f5' }}>{formatTime(recordingTime)}</span>
            <div style={{ flex: 1, display: 'flex', gap: '3px', alignItems: 'center', padding: '0 8px' }}>
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div
                  key={i}
                  style={{
                    width: '3px',
                    height: `${Math.random() * 16 + 6}px`,
                    background: '#00d4ff',
                    borderRadius: '9999px',
                    animation: `bounce 0.8s ease infinite`,
                    animationDelay: `${i * 0.1}s`,
                  }}
                />
              ))}
            </div>
          </>
        )}

        {!audioUrl && !isRecording && (
          <>
            <Mic size={18} color="#71717a" />
            <span style={{ fontSize: '0.875rem', color: '#71717a' }}>Clique no microfone para gravar...</span>
            {error && <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{error}</span>}
          </>
        )}

        {audioUrl && !isRecording && (
          <>
            <button
              type="button"
              onClick={togglePlayback}
              style={{
                width: '32px', height: '32px',
                borderRadius: '50%',
                background: '#00d4ff',
                border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#000',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '9999px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                background: '#00d4ff',
                borderRadius: '9999px',
                width: isPlaying ? '100%' : '0%',
                transition: 'width 0.3s',
              }} />
            </div>
            <span style={{ fontSize: '0.75rem', color: '#a0a0a0' }}>{formatTime(recordingTime)}</span>
            <audio
              ref={audioPlayerRef}
              src={audioUrl}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              hidden
            />
          </>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {!audioUrl && !isRecording && (
          <>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '8px',
                color: '#71717a',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '8px',
              }}
            >
              <Trash2 size={18} />
            </button>
            <button
              type="button"
              onClick={startRecording}
              style={{
                width: '40px', height: '40px',
                borderRadius: '50%',
                background: '#00d4ff',
                border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#000',
                cursor: 'pointer',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.1)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <Mic size={20} />
            </button>
          </>
        )}

        {!audioUrl && isRecording && (
          <button
            type="button"
            onClick={stopRecording}
            style={{
              width: '40px', height: '40px',
              borderRadius: '50%',
              background: '#ef4444',
              border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
              cursor: 'pointer',
              transition: 'transform 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.1)')}
            onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
          >
            <Square size={18} />
          </button>
        )}

        {audioUrl && (
          <>
            <button
              type="button"
              onClick={deleteRecording}
              style={{
                padding: '8px',
                color: '#71717a',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '8px',
              }}
            >
              <Trash2 size={18} />
            </button>
            <button
              type="button"
              onClick={() => audioBlob && onSend(audioBlob)}
              style={{
                width: '40px', height: '40px',
                borderRadius: '50%',
                background: '#10b981',
                border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff',
                cursor: 'pointer',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.1)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <Send size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default VoiceRecorder;
