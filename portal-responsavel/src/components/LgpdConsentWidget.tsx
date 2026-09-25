import styles from '../styles/portal.module.scss';
import Icon from './ui/Icon';

interface LgpdConsentWidgetProps {
  accepted: boolean;
  onSign: () => void;
  /** Abre a política de privacidade (ou o termo, se ainda não assinado). */
  onOpen?: () => void;
}

/** Card de Políticas de Privacidade/LGPD no rodapé da sidebar. */
export default function LgpdConsentWidget({ accepted, onSign, onOpen }: LgpdConsentWidgetProps) {
  return (
    <div className={`${styles.lgpdConsentBox} ${accepted ? styles.accepted : ''}`}>
      <span className={styles.lgpdConsentIcon} aria-hidden="true">
        <Icon name={accepted ? 'shield-check' : 'shield-alert'} />
      </span>
      <div className={styles.lgpdConsentText}>
        {onOpen ? (
          <button type="button" className={styles.lgpdConsentTitle} onClick={onOpen}>
            Políticas de Privacidade
          </button>
        ) : (
          <span className={styles.lgpdConsentTitle}>Políticas de Privacidade</span>
        )}
        {accepted ? (
          <span className={styles.lgpdConsentDesc}>
            Termos LGPD assinados. Seus dados estão protegidos.
          </span>
        ) : (
          <>
            <span className={styles.lgpdConsentDesc}>
              Você ainda não assinou o consentimento de privacidade.
            </span>
            <button type="button" className={styles.btnSignLgpd} onClick={onSign}>
              Assinar LGPD
            </button>
          </>
        )}
      </div>
    </div>
  );
}
