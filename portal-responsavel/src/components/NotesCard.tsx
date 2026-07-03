import React from 'react';
import type { Grade } from '../types';
import styles from '../styles/portal.module.scss';

interface NotesCardProps {
  grades: Grade[];
}

function formatSubject(code: string): string {
  if (!code) return 'Geral';
  const cleanCode = code.trim().toLowerCase();
  
  const map: Record<string, string> = {
    m001: 'Língua Portuguesa',
    m002: 'Matemática',
    m003: 'História',
    m004: 'Geografia',
    m005: 'Ciências',
    m006: 'Arte',
    m007: 'Educação Física',
    m008: 'Inglês',
    lp: 'Língua Portuguesa',
    mat: 'Matemática',
    portugues: 'Língua Portuguesa',
    matematica: 'Matemática',
  };
  
  return map[cleanCode] || code;
}

function calcMedia(bimestres: readonly number[]): number {
  const sum = bimestres.reduce((acc, v) => acc + v, 0);
  return sum / bimestres.length;
}

function gradeBadgeClass(value: number): string {
  if (value >= 7.5) return styles.excellent;
  if (value >= 7.0) return styles.good;
  return styles.warning;
}

const NotesCard: React.FC<NotesCardProps> = ({ grades }) => {
  return (
    <section className={styles.card} aria-labelledby="notes-heading">
      {/* Card header */}
      <div className={styles.cardHeader}>
        <h3 id="notes-heading" className={styles.cardTitle}>
          <i className="ti ti-book" aria-hidden="true" />
          Notas por Disciplina
        </h3>
        <span className={styles.cardSubtitle}>Ano letivo 2026</span>
      </div>

      {grades.length === 0 ? (
        <div className={styles.emptyState} role="status">
          <i className="ti ti-mood-empty" aria-hidden="true" />
          <p>Nenhuma nota disponível no momento.</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.gradesTable} aria-label="Tabela de notas">
            <thead>
              <tr>
                <th scope="col">Disciplina</th>
                <th scope="col">1º Bim</th>
                <th scope="col">2º Bim</th>
                <th scope="col">3º Bim</th>
                <th scope="col">4º Bim</th>
                <th scope="col">Média</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((grade) => {
                const media = calcMedia(grade.bimestres);
                return (
                  <tr key={grade.id}>
                    <td className={styles.disciplinaCell}>
                      <span className={styles.disciplinaName}>{formatSubject(grade.disciplina)}</span>
                      {grade.professor && (
                        <span className={styles.professorName}>{grade.professor}</span>
                      )}
                    </td>
                    {grade.bimestres.map((nota, idx) => (
                      <td key={idx}>
                        <span className={`${styles.gradeBadge} ${gradeBadgeClass(nota)}`}>
                          {nota.toFixed(1)}
                        </span>
                      </td>
                    ))}
                    <td>
                      <span
                        className={`${styles.gradeBadge} ${styles.mediaCell} ${gradeBadgeClass(media)}`}
                      >
                        {media.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className={styles.legend} aria-label="Legenda de cores">
        <span className={`${styles.legendItem} ${styles.excellent}`}>≥ 7.5 Bom</span>
        <span className={`${styles.legendItem} ${styles.good}`}>≥ 7.0 Regular</span>
        <span className={`${styles.legendItem} ${styles.warning}`}>&lt; 7.0 Atenção</span>
      </div>
    </section>
  );
};

export default NotesCard;
