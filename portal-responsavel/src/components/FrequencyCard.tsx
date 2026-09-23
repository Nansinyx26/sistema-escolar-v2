/**
 * components/FrequencyCard.tsx
 * Indicadores inline de frequência escolar alinhados à referência visual:
 * - 3 cards de métrica com cores distintas:
 *   - Presenças (verde/cyan)
 *   - Ausências (azul)
 *   - Frequência (roxo/lilás)
 * - Barra de progresso com indicador de cumprimento da LDB (75%).
 */

import type React from 'react';
import styles from '../styles/portal.module.scss';
import type { Attendance } from '../types';
import Icon from './ui/Icon';

interface FrequencyCardProps {
  attendance: Attendance;
}

const FrequencyCard: React.FC<FrequencyCardProps> = ({ attendance }) => {
  const rawPercentual = Number(attendance.percentual ?? 0);
  const percentualFormatted =
    rawPercentual % 1 !== 0 ? rawPercentual.toFixed(1) : Math.round(rawPercentual).toString();
  const isAboveMin = rawPercentual >= 75;

  return (
    <section className={styles.frequencyInlineSection} aria-label="Resumo de Frequência Escolar">
      <div className={styles.frequencyIndicatorsRow}>
        {/* Presenças (Verde / Cyan) */}
        <div className={`${styles.frequencyMetricCard} ${styles.metricCardPresencas}`}>
          <div className={styles.frequencyMetricHeader}>
            <span className={styles.frequencyMetricLabel}>Presenças</span>
            <div className={styles.frequencyMetricIcon} aria-hidden="true">
              <Icon name="circle-check-filled" />
            </div>
          </div>
          <div className={styles.frequencyMetricValue}>{attendance.presenca}</div>
        </div>

        {/* Ausências (Azul) */}
        <div className={`${styles.frequencyMetricCard} ${styles.metricCardAusencias}`}>
          <div className={styles.frequencyMetricHeader}>
            <span className={styles.frequencyMetricLabel}>Ausências</span>
            <div className={styles.frequencyMetricIcon} aria-hidden="true">
              <Icon name="circle-x" />
            </div>
          </div>
          <div className={styles.frequencyMetricValue}>{attendance.ausencia}</div>
        </div>

        {/* Frequência (Roxo) */}
        <div className={`${styles.frequencyMetricCard} ${styles.metricCardFrequencia}`}>
          <div className={styles.frequencyMetricHeader}>
            <span className={styles.frequencyMetricLabel}>Frequência</span>
            <div className={styles.frequencyMetricIcon} aria-hidden="true">
              <Icon name="chart-bar" />
            </div>
          </div>
          <div className={styles.frequencyMetricValue}>{percentualFormatted}%</div>
        </div>
      </div>

      {/* Barra de progresso e status da meta legal */}
      <div className={styles.frequencyProgressWrapper}>
        <div className={styles.progressBar}>
          <div
            className={`${styles.progressFill} ${!isAboveMin ? styles.progressFillLow : ''}`}
            style={{ width: `${Math.min(100, Math.max(0, rawPercentual))}%` }}
            role="progressbar"
            aria-label={`Frequência: ${percentualFormatted}% (mínimo legal de 75%)`}
            aria-valuenow={rawPercentual}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>

        <div className={styles.frequencyProgressFooter}>
          <span
            className={`${styles.progressStatusTag} ${isAboveMin ? styles.statusOk : styles.statusAlert}`}
          >
            <Icon name={isAboveMin ? 'circle-check-filled' : 'alert-triangle'} aria-hidden="true" />
            {isAboveMin
              ? 'Frequência dentro do limite mínimo (75%)'
              : 'Abaixo do limite mínimo legal (75%)'}
          </span>

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
      </div>
    </section>
  );
};

export default FrequencyCard;
