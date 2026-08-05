import React from 'react';
import styles from '../styles/VoiceOrb.module.scss';

interface VoiceOrbProps {
  size?: 'large' | 'fab';
  isPlaying?: boolean;
  isFetching?: boolean;
  isGlobal?: boolean; // New prop for floating FAB
  onClick?: () => void;
  title?: string;
}

const VoiceOrb: React.FC<VoiceOrbProps> = ({ 
  size = 'large', 
  isPlaying = false, 
  isFetching = false,
  isGlobal = false,
  onClick,
  title
}) => {
  const containerClass = `
    ${styles.orbContainer} 
    ${styles[size]} 
    ${isPlaying ? styles.playing : ''} 
    ${isFetching ? styles.loading : ''}
    ${isGlobal ? styles.global : ''}
  `.trim();

  return (
    <div className={containerClass} onClick={onClick} title={title}>
      <div className={styles.orbWrapper}>
        {/* Outer Ring with Orbital Dots */}
        <div className={styles.outerRing}>
          <svg viewBox="0 0 100 100" className={styles.dotsSvg}>
            <circle cx="50" cy="5" r="1.5" className={styles.dot} />
            <circle cx="95" cy="50" r="1.5" className={styles.dot} />
            <circle cx="50" cy="95" r="1.5" className={styles.dot} />
            <circle cx="5" cy="50" r="1.5" className={styles.dot} />
          </svg>
        </div>
        
        {/* Middle Dotted Ring */}
        <div className={styles.middleRing}></div>
        
        {/* Inner Glowing Core */}
        <div className={styles.core}>
          <div className={styles.coreGlow}></div>
          <div className={styles.coreCenter}>
            {isFetching ? (
              <div className={styles.spinner}></div>
            ) : (
              <div className={styles.equalizer}>
                <span className={styles.bar}></span>
                <span className={styles.bar}></span>
                <span className={styles.bar}></span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Label Pill (only for large mode) */}
      {size === 'large' && (
        <div className={styles.voiceLabel}>
          <div className={styles.statusDot}></div>
          <span>{(localStorage.getItem('user_elevenlabs_voice') || 'Adam').charAt(0).toUpperCase() + (localStorage.getItem('user_elevenlabs_voice') || 'adam').slice(1)} · {isPlaying ? 'falando...' : (isFetching ? 'carregando...' : 'pronto')}</span>
        </div>
      )}
    </div>
  );
};

export default VoiceOrb;
