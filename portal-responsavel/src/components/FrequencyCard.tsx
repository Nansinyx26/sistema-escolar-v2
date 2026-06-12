/**
 * components/FrequencyCard.tsx
 * Displays the student's attendance metrics in a 2×2 grid:
 * presences, absences, delays and overall percentage.
 */

import React from 'react';
import type { Attendance } from '../types';
import styles from '../styles/portal.module.scss';

interface FrequencyCardProps {
  attendance: Attendance;
}

interface Metric {
  label: string;
  value: string | number;
  icon: string;
  colorClass: string;
  ariaLabel: string;
}

const FrequencyCard: React.FC<FrequencyCardProps> = ({ attendance }) => {
  const metrics: Metric[] = [
    {
      label:     'Presenças',
      value:     attendance.presenca,
      icon:      'ti-circle-check',
      colorClass: styles.metricSuccess,
      ariaLabel: `${attendance.presenca} presenças`,
    },
    {
      label:     'Ausências',
      value:     attendance.ausencia,
      icon:      'ti-circle-x',
      colorClass: styles.metricDanger,
      ariaLabel: `${attendance.ausencia} ausências`,
    },
    {
      label:     'Atrasos',
      value:     attendance.atraso,
      icon:      'ti-clock',
      colorClass: styles.metricWarning,
      ariaLabel: `${attendance.atraso} atrasos`,
    },
    {
      label:     'Frequência',
      value:     `${attendance.percentual}%`,
      icon:      'ti-chart-bar',
      colorClass: styles.metricCyan,
      ariaLabel: `Frequência total de ${attendance.percentual}%`,
    },
  ];

  return (
    <section className={styles.card} aria-labelledby="freq-heading">
      <div className={styles.cardHeader}>
        <h3 id="freq-heading" className={styles.cardTitle}>
          <i className="ti ti-calendar-stats" aria-hidden="true" />
          Frequência Escolar
        </h3>
        <span className={styles.cardSubtitle}>Ano letivo 2026</span>
      </div>

      <dl className={styles.frequencyGrid}>
        {metrics.map((m) => (
          <div key={m.label} className={`${styles.frequencyItem} ${m.colorClass}`}>
            <div className={styles.frequencyIcon} aria-hidden="true">
              <i className={`ti ${m.icon}`} />
            </div>
            <dd className={styles.frequencyValue} aria-label={m.ariaLabel}>
              {m.value}
            </dd>
            <dt className={styles.frequencyLabel}>{m.label}</dt>
          </div>
        ))}
      </dl>

      {/* Progress bar */}
      <div className={styles.progressBar} aria-label={`Barra de frequência: ${attendance.percentual}%`}>
        <div
          className={styles.progressFill}
          style={{ width: `${attendance.percentual}%` }}
          role="progressbar"
          aria-valuenow={attendance.percentual}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className={styles.progressLabel}>
        {attendance.percentual >= 75
          ? '✓ Frequência dentro do limite mínimo (75%)'
          : '⚠ Frequência abaixo do limite mínimo (75%)'}
      </p>
    </section>
  );
};

export default FrequencyCard;
