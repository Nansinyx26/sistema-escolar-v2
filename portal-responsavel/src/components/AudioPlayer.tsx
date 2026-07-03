import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';

interface AudioPlayerProps {
  src: string;
  compact?: boolean; // smaller variant for inside comment bubbles
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, compact = false }) => {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => { setDuration(audio.duration || 0); setLoading(false); };
    const onTime = () => setCurrentTime(audio.currentTime);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('durationchange', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('durationchange', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else audio.play();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const val = Number(e.target.value);
    audio.currentTime = val;
    setCurrentTime(val);
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const btnSize = compact ? 28 : 34;
  const iconSize = compact ? 12 : 14;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: compact ? '8px' : '10px',
      background: 'linear-gradient(135deg, rgba(0,212,255,0.08), rgba(124,58,237,0.08))',
      border: '1px solid rgba(0,212,255,0.15)',
      borderRadius: '999px',
      padding: compact ? '5px 10px 5px 5px' : '7px 14px 7px 7px',
      minWidth: 0,
      width: '100%',
    }}>
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: 'none' }} />

      {/* Play/Pause button */}
      <button
        type="button"
        onClick={togglePlay}
        disabled={loading}
        style={{
          width: `${btnSize}px`,
          height: `${btnSize}px`,
          borderRadius: '50%',
          background: playing
            ? 'linear-gradient(135deg,#7c3aed,#a855f7)'
            : 'linear-gradient(135deg,#00d4ff,#0ea5e9)',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          cursor: loading ? 'default' : 'pointer',
          opacity: loading ? 0.5 : 1,
          flexShrink: 0,
          transition: 'transform 0.15s, background 0.2s',
          boxShadow: playing
            ? '0 0 12px rgba(124,58,237,0.4)'
            : '0 0 12px rgba(0,212,255,0.3)',
        }}
        onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.1)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
      >
        {playing
          ? <Pause size={iconSize} fill="currentColor" />
          : <Play size={iconSize} fill="currentColor" style={{ marginLeft: '2px' }} />
        }
      </button>

      {/* Waveform-style bars (decorative, animated when playing) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
        {[3, 6, 9, 6, 4, 8, 5, 7, 4, 6].map((h, i) => (
          <div key={i} style={{
            width: compact ? '2px' : '3px',
            height: `${compact ? h * 0.8 : h}px`,
            borderRadius: '2px',
            background: playing ? '#00d4ff' : 'rgba(0,212,255,0.35)',
            transition: 'background 0.3s',
            animation: playing ? `barPulse 0.8s ease-in-out infinite alternate` : 'none',
            animationDelay: `${i * 0.08}s`,
          }} />
        ))}
      </div>

      {/* Seek bar */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{
          position: 'absolute',
          left: 0, right: 0,
          height: compact ? '3px' : '4px',
          borderRadius: '99px',
          background: 'rgba(255,255,255,0.1)',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            background: 'linear-gradient(90deg,#00d4ff,#7c3aed)',
            borderRadius: '99px',
            transition: 'width 0.1s linear',
          }} />
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={currentTime}
          onChange={handleSeek}
          style={{
            width: '100%',
            height: compact ? '3px' : '4px',
            appearance: 'none',
            background: 'transparent',
            cursor: 'pointer',
            position: 'relative',
            zIndex: 1,
            margin: 0,
          }}
          aria-label="Posição do áudio"
        />
      </div>

      {/* Time */}
      <span style={{
        fontSize: compact ? '0.65rem' : '0.7rem',
        fontWeight: 600,
        color: playing ? '#00d4ff' : '#71717a',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        minWidth: '32px',
        textAlign: 'right',
        transition: 'color 0.3s',
      }}>
        {duration > 0 ? fmt(currentTime) : fmt(0)}
        {!compact && duration > 0 && (
          <span style={{ color: 'rgba(255,255,255,0.2)', fontWeight: 400 }}> / {fmt(duration)}</span>
        )}
      </span>

      <style>{`
        @keyframes barPulse {
          from { transform: scaleY(0.5); opacity: 0.6; }
          to   { transform: scaleY(1.3); opacity: 1; }
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: ${compact ? 10 : 12}px;
          height: ${compact ? 10 : 12}px;
          border-radius: 50%;
          background: #00d4ff;
          cursor: pointer;
          box-shadow: 0 0 6px rgba(0,212,255,0.6);
          transition: transform 0.15s;
        }
        input[type=range]::-webkit-slider-thumb:hover {
          transform: scale(1.3);
        }
        input[type=range]::-moz-range-thumb {
          width: ${compact ? 10 : 12}px;
          height: ${compact ? 10 : 12}px;
          border-radius: 50%;
          background: #00d4ff;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
};

export default AudioPlayer;
