/**
 * components/StudentCard.tsx
 * Card de identificação e status do aluno ativo.
 * Apresenta dados essenciais (nome, turma, matrícula, status ATIVO)
 * e ações contextuais rápidas sem poluir a navegação global.
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { getBoletimPdf, getIAAnalysis } from '../services/apiService';
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
  const [downloading, setDownloading] = useState(false);

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
      } catch (err) {
        console.error('Erro IA:', err);
      }
    };
    fetchIA();
  }, [student.id, student._id]);

  const handleDownloadBoletim = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const studentId = student.id || student._id;
      const blob = await getBoletimPdf(studentId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Boletim_${student.nome}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Boletim baixado com sucesso!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao baixar boletim';
      toast.error(message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <article className={styles.studentCard} aria-label={`Dados do aluno ${student.nome}`}>
      {!lgpdAccepted && (
        <div className={styles.lgpdWarning}>
          <Icon name="shield-lock" aria-hidden="true" />
          Foto e dados sensíveis ocultos. Por favor, aceite a Política de Privacidade (LGPD).
        </div>
      )}

      {/* Top badges bar */}
      <div className={styles.studentCardTopBar}>
        <span className={styles.statusBadge} role="status" aria-label="Status: Ativo na escola">
          <Icon name="circle-check-filled" aria-hidden="true" />
          Ativo
        </span>

        {iaData && (
          <div className={`${styles.iaSemaphore} ${styles[iaData.status]}`} title={iaData.insight}>
            <span className={styles.semaphoreLight} />
            <span className={styles.iaLabel}>IA: {iaData.status.toUpperCase()}</span>
          </div>
        )}
      </div>

      <div className={styles.studentMainLayout}>
        {/* Avatar */}
        <div className={styles.studentAvatar} aria-hidden="true">
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
        <div className={styles.studentInfo}>
          <h2 className={styles.studentName}>
            {student.nome} {student.sobrenome}
          </h2>

          {iaData && (
            <p className={styles.iaInsightText}>
              <Icon name="robot" aria-hidden="true" /> {iaData.insight}
            </p>
          )}

          <dl className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <dt className={styles.infoLabel}>
                <Icon name="users" aria-hidden="true" /> Turma
              </dt>
              <dd className={styles.infoValue}>{student.turma || 'Não enturmado'}</dd>
            </div>

            <div className={styles.infoItem}>
              <dt className={styles.infoLabel}>
                <Icon name="id-badge" aria-hidden="true" /> Matrícula
              </dt>
              <dd className={styles.infoValue}>{student.matricula || 'N/A'}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Ações contextuais do aluno */}
      <div className={styles.studentActionsGroup}>
        <button
          type="button"
          className={styles.boletimButton}
          onClick={handleDownloadBoletim}
          disabled={downloading}
          aria-label="Baixar boletim escolar em PDF"
        >
          <Icon
            name={downloading ? 'loader' : 'file-download'}
            spin={downloading}
            aria-hidden="true"
          />
          <span>{downloading ? 'Gerando…' : 'Baixar boletim (PDF)'}</span>
        </button>

        {onViewFicha && (
          <button
            type="button"
            className={styles.secondaryCardActionBtn}
            onClick={onViewFicha}
            aria-label="Ver ficha completa e autorizações do aluno"
          >
            <Icon name="clipboard-list" aria-hidden="true" />
            <span>Ver Ficha e Autorizações</span>
          </button>
        )}
      </div>
    </article>
  );
};

export default StudentCard;
