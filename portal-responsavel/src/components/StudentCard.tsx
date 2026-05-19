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

function formatDate(iso: string): string {
  if (!iso) return 'Não informado';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Não informado';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
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

          <div className={styles.infoItem}>
            <dt className={styles.infoLabel}>
              <i className="ti ti-calendar" aria-hidden="true" /> Nascimento
            </dt>
            <dd className={styles.infoValue}>{formatDate(student.dataNascimento)}</dd>
          </div>

          <div className={styles.infoItem}>
            <dt className={styles.infoLabel}>
              <i className="ti ti-id-badge" aria-hidden="true" /> CPF
            </dt>
            <dd className={styles.infoValue}>{lgpdAccepted ? (student.cpfAluno || 'N/A') : '***'}</dd>
          </div>

          <div className={styles.infoItem}>
            <dt className={styles.infoLabel}>
              <i className="ti ti-phone" aria-hidden="true" /> Telefone
            </dt>
            <dd className={styles.infoValue}>{lgpdAccepted ? (student.telefone || 'N/A') : '***'}</dd>
          </div>

          <div className={styles.infoItemFull}>
            <dt className={styles.infoLabel}>
              <i className="ti ti-ambulance" aria-hidden="true" /> Alergias
            </dt>
            <dd className={styles.infoValue}>
              {lgpdAccepted 
                ? ((student.alergiasAlimentos || student.alergiasRemedio) 
                    ? `${student.alergiasAlimentos || ''} ${student.alergiasRemedio ? `(Remédios: ${student.alergiasRemedio})` : ''}`.trim() 
                    : 'Nenhuma') 
                : '***'}
            </dd>
          </div>
          
          <div className={styles.infoItemFull}>
            <dt className={styles.infoLabel}>
              <i className="ti ti-heartbeat" aria-hidden="true" /> Condição / Saúde
            </dt>
            <dd className={styles.infoValue}>
              {lgpdAccepted 
                ? ((student.pcd || student.deficiencia || student.condicao) 
                    ? `${student.deficiencia || ''} ${student.condicao || ''}`.trim() || 'Sim' 
                    : 'Nenhuma') 
                : '***'}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
};

export default StudentCard;
