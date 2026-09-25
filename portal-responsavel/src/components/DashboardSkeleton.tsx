import type React from 'react';
import styles from '../styles/portal.module.scss';

/**
 * Skeleton do Painel Geral: espelha o layout real (card do aluno +
 * indicadores de frequência, depois abas/notas ao lado de Comunicados
 * Recentes) para a página não "pular" quando os dados chegam.
 */
const DashboardSkeleton: React.FC = () => (
  <div
    role="status"
    aria-busy="true"
    aria-label="Carregando dados do aluno…"
    style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}
  >
    <div className={styles.topSummaryGrid}>
      <div className={`${styles.skeleton} ${styles.skeletonFrequency}`} />
      <div className={`${styles.skeleton} ${styles.skeletonFrequency}`} />
    </div>
    <div className={styles.dashboardContentGrid}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className={styles.skeleton} style={{ height: '56px', borderRadius: '12px' }} />
        <div className={`${styles.skeleton} ${styles.skeletonCardLg}`} />
      </div>
      <div className={`${styles.skeleton} ${styles.skeletonFeed}`} />
    </div>
  </div>
);

export default DashboardSkeleton;
