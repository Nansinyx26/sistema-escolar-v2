import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../styles/VoiceOrb.module.scss';
import { normalizarVoz, rotuloDaVoz, vozAtual } from '../constants/vozes';
import { useEsferaDeVoz, type EstadoEsfera } from '../hooks/useEsferaDeVoz';

/**
 * VoiceOrb — o orb de voz do portal do responsável.
 *
 * O miolo é a mesma `AssistantSphere` dos painéis em HTML puro, alimentada
 * pelo espectro real do áudio da narração. O equalizador de três barras em
 * CSS continua no documento, embaixo do canvas: é o que aparece se o módulo
 * não carregar, se não houver Canvas 2D, ou se o laço de render desistir.
 *
 * O que a esfera corrige não é o visual das barras — é o vínculo. Elas
 * tocavam um loop de 1s igual para toda narração, então a animação nunca
 * batia com o que estava sendo dito. A esfera se move porque há voz ali.
 */

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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // A pill mostra o nome da voz. Ela precisa acompanhar a troca feita no
  // cabeçalho ou no painel do chat — lida uma vez na montagem, ficava exibindo
  // a voz anterior até a próxima navegação.
  const [voz, setVoz] = useState(() => vozAtual());
  useEffect(() => {
    const aoTrocar = (e: Event) => {
      const detalhe = (e as CustomEvent<{ voice?: string }>).detail;
      if (detalhe?.voice) setVoz(normalizarVoz(detalhe.voice));
    };
    window.addEventListener('voiceChanged', aoTrocar);
    return () => window.removeEventListener('voiceChanged', aoTrocar);
  }, []);
  // Começa assumindo que a esfera sobe. O caminho contrário — começar no orb
  // em CSS e trocar quando o módulo chegar — daria uma troca visível de
  // aparência no meio da narração, que é pior que o atraso de alguns quadros.
  const [esferaDisponivel, setEsferaDisponivel] = useState(true);
  const aoFalhar = useCallback(() => setEsferaDisponivel(false), []);

  const estado: EstadoEsfera = isFetching ? 'pensando' : isPlaying ? 'falando' : 'ocioso';

  /*
   * O orb `large` só é renderizado durante a narração, então a esfera vale
   * enquanto ele existir. O `fab` é diferente: ele fica na tela o tempo todo,
   * inclusive parado, como botão de "ouvir". Ali a esfera só sobe quando há
   * voz — um botão de 80px rodando 2200 partículas em loop enquanto ninguém
   * fala é decoração pedindo atenção e bateria de celular gasta à toa. Parado,
   * o que se vê é o orb em CSS, estático.
   */
  const querEsfera = esferaDisponivel && (size === 'large' || isPlaying || isFetching);
  useEsferaDeVoz(canvasRef, estado, querEsfera, aoFalhar);

  const containerClass = `
    ${styles.orbContainer}
    ${styles[size]}
    ${isPlaying ? styles.playing : ''}
    ${isFetching ? styles.loading : ''}
    ${isGlobal ? styles.global : ''}
    ${querEsfera ? styles.esferaAtiva : ''}
  `.trim();

  return (
    <div className={containerClass} onClick={onClick} title={title}>
      <div className={styles.orbWrapper}>
        {/* A esfera. `aria-hidden` porque o estado já é dito em texto na pill
            — um canvas anunciado por leitor de tela não acrescenta nada. */}
        <canvas ref={canvasRef} className={styles.esferaCanvas} aria-hidden="true" />

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
          {/* O rótulo saía de duas leituras do localStorage com padrões
              diferentes ('Adam' e 'adam'), então quem nunca escolheu via
              "Adam" na pill enquanto ouvia Brian. `rotuloDaVoz` normaliza e
              devolve o nome já capitalizado do catálogo. */}
          <span>{rotuloDaVoz(voz)} · {isPlaying ? 'falando...' : (isFetching ? 'carregando...' : 'pronto')}</span>
        </div>
      )}
    </div>
  );
};

export default VoiceOrb;
