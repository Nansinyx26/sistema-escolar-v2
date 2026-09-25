/**
 * components/NotesCard.tsx
 * Tabela de notas e médias bimestrais adaptativa:
 * - Desktop: Tabela completa com 4 bimestres e coluna de Média Final destacada.
 * - Mobile: Formato de cards/acordeão por disciplina para evitar espremer a tabela ou exigir rolagem horizontal.
 * - Acessibilidade WCAG AA: Dupla codificação (cor + ícone + texto) em cada nota.
 */

import type React from 'react';
import { useState } from 'react';
import styles from '../styles/portal.module.scss';
import type { Grade } from '../types';
import Icon from './ui/Icon';

interface NotesCardProps {
  grades: Grade[];
  /** Baixa o boletim oficial em PDF (botão no cabeçalho do card). */
  onDownload?: () => void;
  downloading?: boolean;
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
    historia: 'História',
    geografia: 'Geografia',
    ciencias: 'Ciências',
    ingles: 'Inglês',
    artes: 'Arte',
  };

  return map[cleanCode] || code;
}

// Média considera SOMENTE bimestres com nota lançada (ignora null/vazio)
function calcMedia(bimestres: readonly (number | null)[]): number | null {
  const valores = bimestres.filter((v): v is number => v !== null && v !== undefined);
  if (valores.length === 0) return null;
  const sum = valores.reduce((acc, v) => acc + v, 0);
  return Number((sum / valores.length).toFixed(1));
}

type GradeStatus = 'excellent' | 'good' | 'warning' | 'empty';

interface GradeMeta {
  status: GradeStatus;
  label: string;
  icon: string;
  badgeClass: string;
}

function getGradeMeta(value: number | null): GradeMeta {
  if (value === null || value === undefined) {
    return {
      status: 'empty',
      label: 'Pendente',
      icon: 'minus',
      badgeClass: styles.gradeEmpty,
    };
  }
  if (value >= 7.5) {
    return {
      status: 'excellent',
      label: 'Bom',
      icon: 'circle-check-filled',
      badgeClass: styles.excellent,
    };
  }
  if (value >= 7.0) {
    return {
      status: 'good',
      label: 'Regular',
      icon: 'alert-triangle',
      badgeClass: styles.good,
    };
  }
  return {
    status: 'warning',
    label: 'Atenção',
    icon: 'alert-circle',
    badgeClass: styles.warning,
  };
}

const NotesCard: React.FC<NotesCardProps> = ({ grades, onDownload, downloading = false }) => {
  // Estado para controlar quais matérias estão expandidas no acordeão mobile
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>(() => {
    // Por padrão, a primeira matéria começa expandida para guiar a pessoa
    if (grades.length > 0) {
      return { [grades[0].id || '0']: true };
    }
    return {};
  });

  const toggleSubject = (id: string) => {
    setExpandedSubjects((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <section className={styles.card} aria-labelledby="notes-heading" data-tour="notes">
      {/* Cabeçalho do Card */}
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderIcon} aria-hidden="true">
          <Icon name="book-open" />
        </div>
        <div className={styles.cardHeaderText}>
          <h3 id="notes-heading" className={styles.cardTitle}>
            Notas por Disciplina
          </h3>
          <span className={styles.cardSubtitle}>Ano letivo {new Date().getFullYear()}</span>
        </div>
        {onDownload && (
          <button
            type="button"
            className={styles.cardHeaderAction}
            onClick={onDownload}
            disabled={downloading}
            title="Baixar boletim em PDF"
            aria-label={downloading ? 'Gerando boletim em PDF' : 'Baixar boletim em PDF'}
          >
            <Icon name={downloading ? 'loader' : 'download'} spin={downloading} aria-hidden="true" />
          </button>
        )}
      </div>

      {grades.length === 0 ? (
        <div className={styles.emptyState} role="status">
          <Icon name="mood-empty" aria-hidden="true" />
          <p>Nenhuma nota disponível no momento.</p>
        </div>
      ) : (
        <>
          {/* VISUALIZAÇÃO DESKTOP: Tabela completa com 4 bimestres e média */}
          <div className={styles.desktopNotesWrapper}>
            <div className={styles.tableWrapper}>
              <table className={styles.gradesTable} aria-label="Tabela de notas e médias">
                <thead>
                  <tr>
                    <th scope="col">Disciplina</th>
                    <th scope="col">1º Bim</th>
                    <th scope="col">2º Bim</th>
                    <th scope="col">3º Bim</th>
                    <th scope="col">4º Bim</th>
                    <th scope="col" className={styles.thMedia}>
                      Média
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {grades.map((grade) => {
                    const media = calcMedia(grade.bimestres);
                    const mediaMeta = getGradeMeta(media);

                    return (
                      <tr key={grade.id}>
                        <td className={styles.disciplinaCell}>
                          <span className={styles.disciplinaName}>
                            {formatSubject(grade.disciplina)}
                          </span>
                          {grade.professor && (
                            <span className={styles.professorName}>Prof. {grade.professor}</span>
                          )}
                        </td>

                        {/* 4 Bimestres */}
                        {[0, 1, 2, 3].map((bIndex) => {
                          const nota = grade.bimestres[bIndex] ?? null;
                          const meta = getGradeMeta(nota);
                          const formattedValue = nota !== null ? nota.toFixed(1) : '—';

                          return (
                            <td key={bIndex}>
                              <span
                                className={`${styles.gradeValue} ${meta.badgeClass}`}
                                title={nota !== null ? meta.label : 'Nota ainda não lançada'}
                              >
                                <span aria-hidden="true">{formattedValue}</span>
                                <span className="sr-only">
                                  {nota !== null ? `${formattedValue}, ${meta.label}` : 'sem nota'}
                                </span>
                              </span>
                            </td>
                          );
                        })}

                        {/* Média Final */}
                        <td className={styles.mediaTd}>
                          <span
                            className={`${styles.gradeValue} ${styles.gradeValueStrong} ${mediaMeta.badgeClass}`}
                            title={media !== null ? mediaMeta.label : 'Sem notas lançadas'}
                          >
                            <span className={styles.gradeDot} aria-hidden="true" />
                            <span aria-hidden="true">{media !== null ? media.toFixed(1) : '—'}</span>
                            <span className="sr-only">
                              {media !== null ? `${media.toFixed(1)}, ${mediaMeta.label}` : 'sem média'}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* VISUALIZAÇÃO MOBILE: Acordeão / Cards por disciplina (Sem rolagem horizontal) */}
          <section
            className={styles.mobileNotesAccordion}
            aria-label="Notas por disciplina em formato lista"
          >
            {grades.map((grade) => {
              const media = calcMedia(grade.bimestres);
              const mediaMeta = getGradeMeta(media);
              const isExpanded = !!expandedSubjects[grade.id];
              const subjectName = formatSubject(grade.disciplina);

              return (
                <div
                  key={grade.id}
                  className={`${styles.accordionCard} ${isExpanded ? styles.expanded : ''}`}
                >
                  <button
                    type="button"
                    className={styles.accordionHeader}
                    onClick={() => toggleSubject(grade.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`discipline-body-${grade.id}`}
                  >
                    <div className={styles.accordionTitleCol}>
                      <span className={styles.accordionSubjectName}>{subjectName}</span>
                      {grade.professor && (
                        <span className={styles.accordionTeacherName}>Prof. {grade.professor}</span>
                      )}
                    </div>

                    <div className={styles.accordionRightCol}>
                      <div className={styles.accordionMediaPill}>
                        <span className={styles.accordionMediaLabel}>Média:</span>
                        <span
                          className={`${styles.gradeBadge} ${styles.compactBadge} ${mediaMeta.badgeClass}`}
                        >
                          {media !== null && (
                            <Icon
                              name={mediaMeta.icon}
                              aria-hidden="true"
                              className={styles.badgeIcon}
                            />
                          )}
                          <span>{media !== null ? media.toFixed(1) : '—'}</span>
                        </span>
                      </div>
                      <Icon
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        className={styles.accordionChevron}
                        aria-hidden="true"
                      />
                    </div>
                  </button>

                  {isExpanded && (
                    <div id={`discipline-body-${grade.id}`} className={styles.accordionBody}>
                      <div className={styles.bimestersGrid}>
                        {[0, 1, 2, 3].map((bIndex) => {
                          const nota = grade.bimestres[bIndex] ?? null;
                          const meta = getGradeMeta(nota);
                          const formattedValue = nota !== null ? nota.toFixed(1) : '—';

                          return (
                            <div key={bIndex} className={styles.bimesterItem}>
                              <span className={styles.bimesterLabel}>{bIndex + 1}º Bimestre</span>
                              <span className={`${styles.gradeBadge} ${meta.badgeClass}`}>
                                {nota !== null && (
                                  <Icon
                                    name={meta.icon}
                                    aria-hidden="true"
                                    className={styles.badgeIcon}
                                  />
                                )}
                                <span className={styles.bimesterValueText}>{formattedValue}</span>
                                <span className={styles.bimesterStatusTag}>{meta.label}</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </>
      )}

      {/* Legenda de Avaliação Acessível */}
      <ul className={styles.legend} aria-label="Legenda de desempenho">
        <li className={`${styles.legendItem} ${styles.excellent}`}>
          <span className={styles.legendDot} aria-hidden="true" />
          <span>≥ 7.5 Bom</span>
        </li>
        <li className={`${styles.legendItem} ${styles.good}`}>
          <span className={styles.legendDot} aria-hidden="true" />
          <span>≥ 7.0 Regular</span>
        </li>
        <li className={`${styles.legendItem} ${styles.warning}`}>
          <span className={styles.legendDot} aria-hidden="true" />
          <span>&lt; 7.0 Atenção</span>
        </li>
      </ul>
    </section>
  );
};

export default NotesCard;
