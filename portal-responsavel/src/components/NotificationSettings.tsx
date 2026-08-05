import React, { useState } from 'react';
import { Bell, Mail, Smartphone, Save, ShieldCheck } from 'lucide-react';
import { updateProfile } from '../services/apiService';
import styles from '../styles/portal.module.scss';

interface NotificationSettingsProps {
  initialPrefs: {
    portal: boolean;
    push: boolean;
    email: boolean;
  };
  onUpdate: (updatedPrefs: any) => void;
}

const NotificationSettings: React.FC<NotificationSettingsProps> = ({ initialPrefs, onUpdate }) => {
  const [prefs, setPrefs] = useState(initialPrefs);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleToggle = (key: keyof typeof prefs) => {
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const updatedUser = await updateProfile({
        notificacoesPreferencias: prefs
      });
      onUpdate(updatedUser.notificacoesPreferencias);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Erro ao salvar preferências:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.settingsSection}>
      <div className={styles.settingsHeader}>
        <h3>Preferências de Notificação</h3>
        <p>Escolha como você deseja ser avisado sobre novidades da escola.</p>
      </div>

      <div className={styles.settingsGrid}>
        <div className={styles.settingItem}>
          <div className={styles.settingInfo}>
            <div className={styles.settingIcon}><Bell size={20} /></div>
            <div>
              <span className={styles.settingTitle}>No Portal Escolar</span>
              <p className={styles.settingDesc}>Visualizar alertas e contador no sino do sistema.</p>
            </div>
          </div>
          <label className={styles.switch}>
            <input 
              type="checkbox" 
              checked={prefs.portal} 
              onChange={() => handleToggle('portal')} 
            />
            <span className={styles.slider} />
          </label>
        </div>

        <div className={styles.settingItem}>
          <div className={styles.settingInfo}>
            <div className={styles.settingIcon}><Smartphone size={20} /></div>
            <div>
              <span className={styles.settingTitle}>Notificações Push</span>
              <p className={styles.settingDesc}>Receber avisos na tela do celular ou computador.</p>
            </div>
          </div>
          <label className={styles.switch}>
            <input 
              type="checkbox" 
              checked={prefs.push} 
              onChange={() => handleToggle('push')} 
            />
            <span className={styles.slider} />
          </label>
        </div>

        <div className={styles.settingItem}>
          <div className={styles.settingInfo}>
            <div className={styles.settingIcon}><Mail size={20} /></div>
            <div>
              <span className={styles.settingTitle}>E-mail Automático</span>
              <p className={styles.settingDesc}>Enviar resumo de comunicados para seu e-mail cadastrado.</p>
            </div>
          </div>
          <label className={styles.switch}>
            <input 
              type="checkbox" 
              checked={prefs.email} 
              onChange={() => handleToggle('email')} 
            />
            <span className={styles.slider} />
          </label>
        </div>
      </div>

      <button 
        className={`${styles.saveSettingsBtn} ${saved ? styles.saved : ''}`}
        onClick={handleSave}
        disabled={loading}
      >
        {loading ? (
          <span className={styles.spinnerSm} />
        ) : saved ? (
          <><ShieldCheck size={18} /> Preferências Salvas!</>
        ) : (
          <><Save size={18} /> Salvar Alterações</>
        )}
      </button>
    </div>
  );
};

export default NotificationSettings;
