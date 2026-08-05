import React from 'react';
import styles from '../styles/portal.module.scss';

/**
 * Skeleton loader do dashboard — espelha o layout real (card do aluno +
 * notificações + feed + cards de frequência/notas) para a página não
 * "pular" quando os dados chegam. Substitui o spinner central.
 */
const DashboardSkeleton: React.FC = () => (
  <div aria-busy="true" aria-label="Carregando dados do aluno…">
    <div className={styles.topGrid}>
      <div className={`${styles.skeleton} ${styles.skeletonCardLg}`} />
      <div className={`${styles.skeleton} ${styles.skeletonCardLg}`} />
    </div>
    <div className={styles.comunicadosGrid}>
      <div className={styles.comunicadosMainCol}>
        <div className={`${styles.skeleton} ${styles.skeletonFeed}`} />
        <div className={styles.cardsGrid}>
          <div className={`${styles.skeleton} ${styles.skeletonCardMd}`} />
          <div className={`${styles.skeleton} ${styles.skeletonCardMd}`} />
        </div>
      </div>
      <div className={styles.comunicadosSideCol}>
        <div className={`${styles.skeleton} ${styles.skeletonCardLg}`} />
      </div>
    </div>
  </div>
);

export default DashboardSkeleton;
