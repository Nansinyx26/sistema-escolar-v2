import React, { useState, useEffect } from 'react';
import { 
  updateProfile, 
  ApiError, 
  AuthUser 
} from '../services/apiService';
import type { Student } from '../types';
import styles from '../styles/portal.module.scss';

interface EditarPerfilProps {
  user: AuthUser;
  activeStudent: Student | null;
  onSuccess: (updatedUser: AuthUser) => void;
}

type TabType = 'responsavel' | 'lgpd';

export default function EditarPerfil({ user, onSuccess }: EditarPerfilProps) {
  // --- Active Tab State ---
  const [activeTab, setActiveTab] = useState<TabType>('responsavel');

  // --- Guardian States ---
  const [nome, setNome] = useState(user.nome || '');
  const [telefone, setTelefone] = useState(user.telefone || '');
  
  // --- Consent States ---
  const [consent1, setConsent1] = useState(!!user.consentimentoAceiteEm);
  const [consent2, setConsent2] = useState(!!user.consentimentoAceiteEm);
  const [consent3, setConsent3] = useState(!!user.consentimentoAceiteEm);
  const [consent4, setConsent4] = useState(!!user.consentimentoAceiteEm);

  // General Page States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // --- Initializing Guardian Data ---
  useEffect(() => {
    setNome(user.nome || '');
    setTelefone(user.telefone || '');
    
    const signed = !!user.consentimentoAceiteEm;
    setConsent1(signed);
    setConsent2(signed);
    setConsent3(signed);
    setConsent4(signed);
  }, [user]);

  // Telephone Mask: (00) 00000-0000 or (00) 0000-0000
  const handleTelefoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    
    if (val.length > 10) {
      val = val.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    } else if (val.length > 6) {
      val = val.replace(/^(\d{2})(\d{4})(\d{1,4})$/, '($1) $2-$3');
    } else if (val.length > 2) {
      val = val.replace(/^(\d{2})(\d{1,4})$/, '($1) $2');
    }
    setTelefone(val);
  };

  // --- Submit form ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setError('O nome é obrigatório.');
      return;
    }
    if (telefone.length < 14) {
      setError('Telefone do responsável inválido. Preencha o telefone com DDD.');
      return;
    }
    if (!consent1 || !consent2 || !consent3 || !consent4) {
      setError('Você deve aceitar todos os termos de consentimento para salvar.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      // Update Guardian Profile
      const updatedUser = await updateProfile({
        nome,
        telefone,
        consentimentoAceiteEm: true,
      });

      onSuccess(updatedUser);
      setSuccessMsg('Cadastro geral e termos de consentimento LGPD atualizados com sucesso!');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Ocorreu um erro ao salvar o perfil.');
      }
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  };

  const isButtonDisabled = loading || !consent1 || !consent2 || !consent3 || !consent4;

  return (
    <article className={styles.profileViewCard} aria-label="Editar dados cadastrais e termo LGPD">
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
        <h2>
          <i className="ti ti-signature" aria-hidden="true" />
          Cadastro e Proteção de Dados (LGPD)
        </h2>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#22c55e', padding: '6px 12px', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 600 }}>
          <i className="ti ti-shield-check" style={{ fontSize: '0.9rem' }} />
          Em conformidade com a LGPD
        </div>
      </div>
      
      <p className={styles.subtitle}>
        Confirme seus dados cadastrais e assine as autorizações obrigatórias.
      </p>

      {/* Interactive Tabs */}
      <div className={styles.profileTabs}>
        <button 
          type="button"
          onClick={() => setActiveTab('responsavel')}
          className={`${styles.tabBtn} ${activeTab === 'responsavel' ? styles.active : ''}`}
        >
          <i className="ti ti-user" /> Responsável Legal
        </button>
        <button 
          type="button"
          onClick={() => setActiveTab('lgpd')}
          className={`${styles.tabBtn} ${activeTab === 'lgpd' ? styles.active : ''}`}
        >
          <i className="ti ti-shield-lock" /> Termos LGPD e Retenção
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className={styles.sidebarError} role="alert" style={{ marginBottom: '20px' }}>
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div style={{ marginBottom: '24px', padding: '12px 16px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '8px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 600 }} role="alert">
          <i className="ti ti-circle-check-filled" aria-hidden="true" />
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* TAB 1: DADOS DO RESPONSÁVEL */}
        {activeTab === 'responsavel' && (
          <div className={styles.profileFormSection}>
            {/* Avatar Section */}
            <div className={styles.avatarSection} style={{ marginBottom: '20px' }}>
              <div className={styles.avatarUploadPreview}>
                <span>{getInitials(nome)}</span>
              </div>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Responsável Cadastrado</span>
            </div>

            <h3 className={styles.profileSectionTitle}>
              <i className="ti ti-id-badge" /> Informações do Responsável Legal
            </h3>

            <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
              <label className={styles.formLabel}>Nome Completo</label>
              <div className={styles.inputWrapper}>
                <i className="ti ti-user" aria-hidden="true" />
                <input
                  type="text"
                  className={styles.formInput}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Telefone Celular</label>
              <div className={styles.inputWrapper}>
                <i className="ti ti-phone" aria-hidden="true" />
                <input
                  type="text"
                  className={styles.formInput}
                  value={telefone === '(00) 00000-0000' ? '' : telefone}
                  placeholder="(00) 00000-0000"
                  onChange={handleTelefoneChange}
                  required
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: LGPD CONSENTS */}
        {activeTab === 'lgpd' && (
          <div className={styles.profileFormSection}>
            <h3 className={styles.profileSectionTitle} style={{ borderColor: 'rgba(6, 182, 212, 0.3)' }}>
              <i className="ti ti-shield-lock" style={{ color: '#06b6d4' }} /> Termos de Consentimento Ativos
            </h3>
            
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '20px', lineHeight: '1.5' }}>
              Para manter o acesso ao portal, a legislação exige o consentimento explícito sobre o tratamento dos dados. Você pode revisar e revogar opções a qualquer momento, observando que a desativação de termos fundamentais impossibilita a exibição do boletim no portal.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Consent 1 */}
              <div 
                className={`${styles.consentItem} ${consent1 ? styles.checked : ''}`}
                onClick={() => setConsent1(!consent1)}
              >
                <input
                  type="checkbox"
                  checked={consent1}
                  onChange={(e) => {
                    e.stopPropagation();
                    setConsent1(e.target.checked);
                  }}
                />
                <div className={styles.consentItemBody}>
                  <div className={styles.consentItemTitle}>
                    Tratamento de Dados Cadastrais do Responsável
                    <span className={styles.consentArt}>Art. 7, I LGPD</span>
                  </div>
                  <div className={styles.consentItemDesc}>
                    Permite o processamento do seu nome, telefone e e-mail para autenticação de segurança e contato da secretaria.
                  </div>
                </div>
              </div>

              {/* Consent 2 */}
              <div 
                className={`${styles.consentItem} ${consent2 ? styles.checked : ''}`}
                onClick={() => setConsent2(!consent2)}
              >
                <input
                  type="checkbox"
                  checked={consent2}
                  onChange={(e) => {
                    e.stopPropagation();
                    setConsent2(e.target.checked);
                  }}
                />
                <div className={styles.consentItemBody}>
                  <div className={styles.consentItemTitle}>
                    Exibição e Consulta de Notas e Desempenho do Menor
                    <span className={styles.consentArt}>Art. 14 LGPD</span>
                  </div>
                  <div className={styles.consentItemDesc}>
                    Autoriza a exibição do histórico de notas, boletins escolares e faltas do aluno diretamente na tela do seu portal de responsável.
                  </div>
                </div>
              </div>

              {/* Consent 3 */}
              <div 
                className={`${styles.consentItem} ${consent3 ? styles.checked : ''}`}
                onClick={() => setConsent3(!consent3)}
              >
                <input
                  type="checkbox"
                  checked={consent3}
                  onChange={(e) => {
                    e.stopPropagation();
                    setConsent3(e.target.checked);
                  }}
                />
                <div className={styles.consentItemBody}>
                  <div className={styles.consentItemTitle}>
                    Comunicações Rápidas e Alertas Escolares
                  </div>
                  <div className={styles.consentItemDesc}>
                    Autoriza o envio de avisos de reuniões, ocorrências e alertas de faltas para o e-mail ou telefone cadastrado.
                  </div>
                </div>
              </div>

              {/* Consent 4 */}
              <div 
                className={`${styles.consentItem} ${consent4 ? styles.checked : ''}`}
                onClick={() => setConsent4(!consent4)}
              >
                <input
                  type="checkbox"
                  checked={consent4}
                  onChange={(e) => {
                    e.stopPropagation();
                    setConsent4(e.target.checked);
                  }}
                />
                <div className={styles.consentItemBody}>
                  <div className={styles.consentItemTitle}>
                    Ciência das Políticas de Privacidade Gerais
                    <span className={styles.consentArt}>Art. 18 LGPD</span>
                  </div>
                  <div className={styles.consentItemDesc}>
                    Declaro ciência sobre o armazenamento seguro de logs de acesso e os direitos de correção e exclusão garantidos por lei.
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px' }}>
              <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem', color: '#f1f5f9', fontWeight: 600 }}>Período de Retenção de Dados</h4>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.8rem', lineHeight: '1.5' }}>
                Conforme obrigatoriedades legais do MEC (Lei de Diretrizes e Bases da Educação), o histórico acadêmico e as notas do aluno são de retenção definitiva e histórica. Os dados cadastrais do responsável são mantidos enquanto o aluno possuir matrícula ativa, sendo arquivados de forma criptografada após o encerramento do vínculo escolar.
              </p>
            </div>
          </div>
        )}

        {/* Submit Actions */}
        <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '20px' }}>
          <button 
            type="submit" 
            className={styles.submitBtn} 
            disabled={isButtonDisabled} 
            style={{ 
              maxWidth: '240px',
              background: isButtonDisabled ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
              border: 'none',
              fontWeight: 700,
              transition: 'all 0.3s'
            }}
          >
            {loading ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </form>
    </article>
  );
}
