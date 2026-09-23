/**
 * components/FrequencyCard.tsx
 * Exibe os indicadores essenciais de frequência do aluno (Presenças, Ausências e Frequência %)
 * dispostos lado a lado em 3 colunas compactas, dimensionados para caber perfeitamente
 * em larguras a partir de 360px sem qualquer rolagem horizontal.
 */

import type React from 'react';
import styles from '../styles/portal.module.scss';
import type { Attendance } from '../types';
import Icon from './ui/Icon';

interface FrequencyCardProps {
  attendance: Attendance;
}

const FrequencyCard: React.FC<FrequencyCardProps> = ({ attendance }) => {
  const percentual = Math.round(attendance.percentual ?? 0);
  const isAboveMin = percentual >= 75;

  return (
    <section className={styles.card} aria-labelledby="freq-heading">
      <div className={styles.cardHeader}>
        <h3 id="freq-heading" className={styles.cardTitle}>
          <Icon name="calendar-stats" aria-hidden="true" />
          Frequência Escolar
        </h3>
        <span className={styles.cardSubtitle}>Ano letivo 2026</span>
      </div>

      {/* Grade de 3 indicadores compactos lado a lado (cabe em 360px) */}
      <dl className={styles.frequencyGridCompact} aria-label="Resumo de frequência">
        <div className={`${styles.frequencyItemCompact} ${styles.metricSuccess}`}>
          <div className={styles.frequencyIconCompact} aria-hidden="true">
            <Icon name="circle-check-filled" />
          </div>
          <dd className={styles.frequencyValueCompact}>{attendance.presenca}</dd>
          <dt className={styles.frequencyLabelCompact}>Presenças</dt>
        </div>

        <div className={`${styles.frequencyItemCompact} ${styles.metricDanger}`}>
          <div className={styles.frequencyIconCompact} aria-hidden="true">
            <Icon name="circle-x" />
          </div>
          <dd className={styles.frequencyValueCompact}>{attendance.ausencia}</dd>
          <dt className={styles.frequencyLabelCompact}>Ausências</dt>
        </div>

        <div
          className={`${styles.frequencyItemCompact} ${isAboveMin ? styles.metricCyan : styles.metricWarning}`}
        >
          <div className={styles.frequencyIconCompact} aria-hidden="true">
            <Icon name="chart-bar" />
          </div>
          <dd className={styles.frequencyValueCompact}>{percentual}%</dd>
          <dt className={styles.frequencyLabelCompact}>Frequência</dt>
        </div>
      </dl>

      {/* Barra de progresso visual em relação à meta legal de 75% */}
      <div className={styles.progressBar}>
        <div
          className={`${styles.progressFill} ${!isAboveMin ? styles.progressFillLow : ''}`}
          style={{ width: `${Math.min(100, Math.max(0, percentual))}%` }}
          role="progressbar"
          aria-label={`Barra de frequência: ${percentual}% (mínimo legal de 75%)`}
          aria-valuenow={percentual}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <div className={styles.frequencyFooterStatus}>
        <p
          className={`${styles.progressLabel} ${isAboveMin ? styles.freqStatusOk : styles.freqStatusAlert}`}
        >
          <Icon name={isAboveMin ? 'circle-check-filled' : 'alert-triangle'} aria-hidden="true" />
          {isAboveMin
            ? 'Frequência dentro do limite mínimo legal (75%)'
            : 'Frequência abaixo do limite mínimo (75%) — Atenção às faltas'}
        </p>

        {attendance.atraso > 0 && (
          <span
            className={styles.atrasosBadge}
            title={`${attendance.atraso} atrasos registrados neste ano`}
          >
            <Icon name="clock" aria-hidden="true" />
            {attendance.atraso} {attendance.atraso === 1 ? 'atraso' : 'atrasos'}
          </span>
        )}
      </div>
    </section>
  );
};

export default FrequencyCard;
