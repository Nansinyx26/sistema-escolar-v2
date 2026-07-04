import React, { useState, useEffect } from 'react';
import type { Student } from '../types';
import styles from '../styles/portal.module.scss';
import { getBoletimPdf, getIAAnalysis } from '../services/apiService';
import { toast } from 'react-hot-toast';

interface StudentCardProps {
  student: Student;
  lgpdAccepted?: boolean;
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


const StudentCard: React.FC<StudentCardProps> = ({ student, lgpdAccepted = true }) => {
  const [imgError, setImgError] = useState(false);
  const [iaData, setIaData] = useState<IAAnalysis | null>(null);

  const showFoto = student.foto &&
    student.foto !== 'null' &&
    student.foto !== 'undefined' &&
    !imgError &&
    lgpdAccepted;
  
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const fetchIA = async () => {
      try {
        const res = await getIAAnalysis(student.id || student._id);
        if (res.success) setIaData(res.data);
      } catch (err) {
        console.error('Erro IA:', err);
      }
    };
    if (student.id || student._id) fetchIA();
  }, [student.id, student._id]);

  const handleDownloadBoletim = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await getBoletimPdf(student.id || student._id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Boletim_${student.nome}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Boletim baixado com sucesso!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao baixar boletim');
    } finally {
      setDownloading(false);
    }
  };

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

      {/* IA Semaphore */}
      {iaData && (
        <div className={`${styles.iaSemaphore} ${styles[iaData.status]}`} title={iaData.insight}>
          <div className={styles.semaphoreLight} />
          <span className={styles.iaLabel}>IA: {iaData.status.toUpperCase()}</span>
        </div>
      )}

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
            {!lgpdAccepted ? <i className="ti ti-lock" /> : getInitials(student.nome, student.sobrenome)}
          </span>
        )}
      </div>

      {/* Name */}
      <div className={styles.studentInfo}>
        <h2 className={styles.studentName}>
          {student.nome} {student.sobrenome}
        </h2>

        {/* IA Insight Text */}
        {iaData && (
          <p className={styles.iaInsightText}>
            <i className="ti ti-robot" /> {iaData.insight}
          </p>
        )}

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

        {/* Action Buttons */}
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.8rem', justifyContent: 'center' }}>
          <button 
            type="button"
            className={styles.primaryButton} 
            onClick={handleDownloadBoletim}
            disabled={downloading}
            style={{ 
              fontSize: '0.8rem', 
              padding: '0.5rem 0.8rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.4rem',
              background: 'rgba(37, 99, 235, 0.1)',
              color: '#2563eb',
              border: '1px solid rgba(37, 99, 235, 0.2)',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              opacity: downloading ? 0.6 : 1
            }}
          >
            <i className={downloading ? "ti ti-loader animate-spin" : "ti ti-file-download"} />
            {downloading ? 'Gerando...' : 'Boletim PDF'}
          </button>
        </div>
      </div>
    </article>
  );
};

export default StudentCard;
