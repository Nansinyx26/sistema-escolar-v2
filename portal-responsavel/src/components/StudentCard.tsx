/**
 * components/StudentCard.tsx
 * Displays the enrolled student's personal information with avatar,
 * info grid and an "Ativo" status badge.
 */

import React from 'react';
import type { Student } from '../types';
import styles from '../styles/portal.module.scss';

interface StudentCardProps {
  student: Student;
  lgpdAccepted?: boolean;
}

function getInitials(nome: string, sobrenome: string): string {
  return `${nome[0] ?? ''}${sobrenome[0] ?? ''}`.toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const StudentCard: React.FC<StudentCardProps> = ({ student, lgpdAccepted = true }) => {
  return (
    <article className={styles.studentCard} aria-label={`Dados do aluno ${student.nome}`}>
      {!lgpdAccepted && (
        <div className={styles.lgpdWarning}>
          <i className="ti ti-shield-lock" aria-hidden="true" />
          Foto e dados sensíveis ocultos. Por favor, aceite a Política de Privacidade (LGPD).
        </div>
      )}

      {/* Status badge */}
      <span className={styles.statusBadge} aria-label="Status: Ativo">
        <i className="ti ti-circle-check-filled" aria-hidden="true" />
        Ativo
      </span>

      {/* Avatar */}
      <div className={styles.studentAvatar} aria-hidden="true">
        {student.foto && lgpdAccepted ? (
          <img src={student.foto} alt={`${student.nome} ${student.sobrenome}`} />
        ) : (
          <span>
            {!lgpdAccepted ? <i className="ti ti-lock" /> : getInitials(student.nome, student.sobrenome)}
          </span>
        )}
      </div>

      {/* Name */}
      <div className={styles.studentInfo}>
        <h2 className={styles.studentName}>
          {student.nome} {student.sobrenome}
        </h2>

        {/* Info grid */}
        <dl className={styles.infoGrid}>
          <div className={styles.infoItem}>
            <dt className={styles.infoLabel}>
              <i className="ti ti-users" aria-hidden="true" /> Turma
            </dt>
            <dd className={styles.infoValue}>{student.turma}</dd>
          </div>

          <div className={styles.infoItem}>
            <dt className={styles.infoLabel}>
              <i className="ti ti-id-badge" aria-hidden="true" /> Matrícula
            </dt>
            <dd className={styles.infoValue}>{student.matricula}</dd>
          </div>

          <div className={styles.infoItem}>
            <dt className={styles.infoLabel}>
              <i className="ti ti-calendar" aria-hidden="true" /> Nascimento
            </dt>
            <dd className={styles.infoValue}>{formatDate(student.dataNascimento)}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
};

export default StudentCard;
