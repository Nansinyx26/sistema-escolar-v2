/**
 * components/StudentCard.tsx
 * Card compacto de identificação do aluno ativo.
 * Reproduz o design de referência: avatar circular com cyan, status ATIVO,
 * dados essenciais (turma, matrícula) e link direto para a ficha.
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { getIAAnalysis } from '../services/apiService';
import styles from '../styles/portal.module.scss';
import type { Student } from '../types';
import Icon from './ui/Icon';

interface StudentCardProps {
  student: Student;
  lgpdAccepted?: boolean;
  onViewFicha?: () => void;
}

interface IAAnalysis {
  status: 'bom' | 'alerta' | 'critico';
  insight: string;
  recomendacao: string;
}

function getInitials(nome: string, sobrenome: string): string {
  const n = (nome || '').trim();
  const s = (sobrenome || '').trim();
  if (!n) return 'A';
  return `${n[0] ?? ''}${s[0] ?? ''}`.toUpperCase();
}

const StudentCard: React.FC<StudentCardProps> = ({ student, lgpdAccepted = true, onViewFicha }) => {
  const [imgError, setImgError] = useState(false);
  const [iaData, setIaData] = useState<IAAnalysis | null>(null);

  const showFoto =
    student.foto &&
    student.foto !== 'null' &&
    student.foto !== 'undefined' &&
    !imgError &&
    lgpdAccepted;

  useEffect(() => {
    const fetchIA = async () => {
      try {
        const studentId = student.id || student._id;
        if (!studentId) return;
        const res = await getIAAnalysis(studentId);
        if (res.success) setIaData(res.data);
      } catch {
        // IA não disponível não bloqueia o card
      }
    };
    fetchIA();
  }, [student.id, student._id]);

  return (
    <article
      className={styles.compactStudentCard}
      aria-label={`Dados do aluno ${student.nome} ${student.sobrenome}`}
      onClick={onViewFicha}
      role={onViewFicha ? 'button' : undefined}
      tabIndex={onViewFicha ? 0 : undefined}
      onKeyDown={(e) => {
        if (onViewFicha && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onViewFicha();
        }
      }}
    >
      <div className={styles.compactStudentLeft}>
        {/* Avatar com borda cyan */}
        <div className={styles.compactStudentAvatar} aria-hidden="true">
          {showFoto ? (
            <img
              loading="lazy"
              src={student.foto}
              alt={`${student.nome} ${student.sobrenome}`}
              onError={() => setImgError(true)}
            />
          ) : (
            <span>
              {!lgpdAccepted ? <Icon name="lock" /> : getInitials(student.nome, student.sobrenome)}
            </span>
          )}
        </div>

        {/* Informações centrais */}
        <div className={styles.compactStudentInfo}>
          <div className={styles.compactStudentHeader}>
            <h2 className={styles.compactStudentName}>
              {student.nome} {student.sobrenome}
            </h2>
            <span className={styles.activeBadge} role="status" aria-label="Status: Ativo">
              <Icon name="circle-check-filled" aria-hidden="true" />
              ATIVO
            </span>

            {iaData && (
              <span
                className={`${styles.iaMiniBadge} ${styles[iaData.status]}`}
                title={iaData.insight}
              >
                <span className={styles.iaMiniDot} />
                IA: {iaData.status.toUpperCase()}
              </span>
            )}
          </div>

          <div className={styles.compactStudentMeta}>
            <div className={styles.compactMetaItem}>
              <span className={styles.compactMetaLabel}>TURMA</span>
              <span className={styles.compactMetaValue}>{student.turma || 'Não enturmado'}</span>
            </div>
            <div className={styles.compactMetaDivider} aria-hidden="true" />
            <div className={styles.compactMetaItem}>
              <span className={styles.compactMetaLabel}>MATRÍCULA</span>
              <span className={styles.compactMetaValue}>{student.matricula || 'N/A'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Seta para acessar a ficha */}
      {onViewFicha && (
        <div className={styles.compactStudentArrow} aria-hidden="true">
          <Icon name="chevron-right" />
        </div>
      )}
    </article>
  );
};

export default StudentCard;
