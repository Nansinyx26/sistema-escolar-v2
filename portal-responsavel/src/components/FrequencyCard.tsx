/**
 * components/FrequencyCard.tsx
 * Indicadores de frequência do aluno, conforme a referência visual (Issue #436):
 * três ladrilhos (presenças, ausências, frequência), cada um com ícone, número
 * e rótulo na sua cor, e a barra de progresso do mínimo legal de 75% (LDB).
 *
 * Os valores vêm de `GET /frequencia` do aluno ativo; nada é fixo. As cores
 * de cada ladrilho são tokens (`--tile-*`) com valor próprio em cada tema.
 */

import type React from 'react';
import styles from '../styles/portal.module.scss';
import type { Attendance } from '../types';
import Icon from './ui/Icon';

interface FrequencyCardProps {
  attendance: Attendance;
}

const FREQUENCIA_MINIMA = 75;

const FrequencyCard: React.FC<FrequencyCardProps> = ({ attendance }) => {
  const rawPercentual = Number(attendance.percentual ?? 0);
  const percentualFormatted =
    rawPercentual % 1 !== 0 ? rawPercentual.toFixed(1) : Math.round(rawPercentual).toString();
  const isAboveMin = rawPercentual >= FREQUENCIA_MINIMA;

  const tiles = [
    {
      key: 'presencas',
      label: 'Presenças',
      value: attendance.presenca ?? 0,
      icon: 'users',
      className: styles.metricCardPresencas,
    },
    {
      key: 'ausencias',
      label: 'Ausências',
      value: attendance.ausencia ?? 0,
      icon: 'circle-x',
      className: styles.metricCardAusencias,
    },
    {
      key: 'frequencia',
      label: 'Frequência',
      value: `${percentualFormatted}%`,
      icon: 'chart-line',
      className: styles.metricCardFrequencia,
    },
  ];

  return (
    <section className={styles.frequencyInlineSection} aria-label="Resumo de frequência escolar">
      <div className={styles.frequencyIndicatorsRow}>
        {tiles.map((tile) => (
          <div key={tile.key} className={`${styles.frequencyMetricCard} ${tile.className}`}>
            <span className={styles.frequencyMetricIcon} aria-hidden="true">
              <Icon name={tile.icon} />
            </span>
            <span className={styles.frequencyMetricValue}>{tile.value}</span>
            <span className={styles.frequencyMetricLabel}>{tile.label}</span>
          </div>
        ))}
      </div>

      <div
        className={`${styles.frequencyProgressWrapper} ${isAboveMin ? styles.statusOk : styles.statusAlert}`}
      >
        <span className={styles.progressStatusTag}>
          <Icon name={isAboveMin ? 'check' : 'alert-triangle'} aria-hidden="true" />
          {isAboveMin
            ? `Frequência dentro do limite mínimo (${FREQUENCIA_MINIMA}%)`
            : `Abaixo do limite mínimo legal (${FREQUENCIA_MINIMA}%)`}
        </span>
        <div className={styles.progressBar}>
          <div
            className={`${styles.progressFill} ${!isAboveMin ? styles.progressFillLow : ''}`}
            style={{ width: `${Math.min(100, Math.max(0, rawPercentual))}%` }}
            role="progressbar"
            aria-label={`Frequência: ${percentualFormatted}% (mínimo legal de ${FREQUENCIA_MINIMA}%)`}
            aria-valuenow={rawPercentual}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>

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
