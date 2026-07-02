import React from 'react';
import styles from '../styles/portal.module.scss';

interface LgpdConsentWidgetProps {
  accepted: boolean;
  onSign: () => void;
}

export default function LgpdConsentWidget({ accepted, onSign }: LgpdConsentWidgetProps) {
  return (
    <div className={`${styles.lgpdConsentBox} ${accepted ? styles.accepted : ''}`}>
      <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <i className={accepted ? 'ti ti-shield-check' : 'ti ti-shield-alert'} style={{ fontSize: '1.1rem' }} />
        Políticas de Privacidade
      </span>
      {accepted ? (
        <span style={{ fontSize: '0.75rem' }}>✓ Termo LGPD assinado. Seus dados estão protegidos.</span>
      ) : (
        <>
          <span style={{ fontSize: '0.75rem' }}>Você ainda não assinou o consentimento de privacidade.</span>
          <button className={styles.btnSignLgpd} onClick={onSign}>
            Assinar LGPD
          </button>
        </>
      )}
    </div>
  );
}