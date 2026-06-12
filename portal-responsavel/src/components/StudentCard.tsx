import React, { useState } from 'react';
import type { Student } from '../types';
import styles from '../styles/portal.module.scss';

interface StudentCardProps {
  student: Student;
  lgpdAccepted?: boolean;
}

function getInitials(nome: string, sobrenome: string): string {
  const n = (nome || '').trim();
  const s = (sobrenome || '').trim();
  if (!n) return 'A';
  return `${n[0] ?? ''}${s[0] ?? ''}`.toUpperCase();
}


const StudentCard: React.FC<StudentCardProps> = ({ student, lgpdAccepted = true }) => {
  const [imgError, setImgError] = useState(false);

  const showFoto = student.foto &&
    student.foto !== 'null' &&
    student.foto !== 'undefined' &&
    !imgError &&
    lgpdAccepted;

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
        {showFoto ? (
          <img
            src={student.foto}
            alt={`${student.nome} ${student.sobrenome}`}
            onError={() => setImgError(true)}
          />
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
            <dd className={styles.infoValue}>{student.turma || 'Não enturmado'}</dd>
          </div>

          <div className={styles.infoItem}>
            <dt className={styles.infoLabel}>
              <i className="ti ti-id-badge" aria-hidden="true" /> Matrícula
            </dt>
            <dd className={styles.infoValue}>{student.matricula || 'N/A'}</dd>
          </div>


        </dl>
      </div>
    </article>
  );
};

export default StudentCard;
