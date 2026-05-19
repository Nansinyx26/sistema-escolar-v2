import React, { useState } from 'react';
import { updateProfile, ApiError, AuthUser } from '../services/apiService';
import styles from '../styles/portal.module.scss';

interface CompletarCadastroProps {
  user: AuthUser;
  onSuccess: (updatedUser: AuthUser) => void;
}

export default function CompletarCadastro({ user, onSuccess }: CompletarCadastroProps) {
  const [nome, setNome] = useState(user.nome || '');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  
  // 4 Specific LGPD consent states required for completing profile
  const [consent1, setConsent1] = useState(false);
  const [consent2, setConsent2] = useState(false);
  const [consent3, setConsent3] = useState(false);
  const [consent4, setConsent4] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // CPF Mask: 000.000.000-00
  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    
    if (val.length > 9) {
      val = val.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
    } else if (val.length > 6) {
      val = val.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
    } else if (val.length > 3) {
      val = val.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
    }
    setCpf(val);
  };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      setError('O nome é obrigatório.');
      return;
    }
    if (cpf.length < 14) {
      setError('CPF inválido. Preencha todos os dígitos.');
      return;
    }
    if (telefone.length < 14) {
      setError('Telefone inválido. Preencha o telefone com DDD.');
      return;
    }
    if (!consent1 || !consent2 || !consent3 || !consent4) {
      setError('Você deve aceitar todos os termos de consentimento para prosseguir.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const updatedUser = await updateProfile({
        nome,
        cpf,
        telefone,
        consentimentoAceiteEm: true,
      });
      onSuccess(updatedUser);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Ocorreu um erro ao salvar os dados.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isButtonDisabled = loading || !consent1 || !consent2 || !consent3 || !consent4;

  return (
    <div className={styles.vincularContainer} style={{ padding: '24px 16px', display: 'flex', justifyContent: 'center' }}>
      <div className={styles.vincularCard} style={{ maxWidth: '640px', width: '100%', padding: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          <h2>
            <i className="ti ti-signature" aria-hidden="true" />
            Completar Cadastro & Termo LGPD
          </h2>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#22c55e', padding: '6px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600 }}>
            <i className="ti ti-shield-check" style={{ fontSize: '0.85rem' }} />
            Em conformidade com a LGPD
          </div>
        </div>

        <p style={{ marginBottom: '24px', color: '#94a3b8', fontSize: '0.9rem' }}>
          Para continuar e acessar o portal do seu filho, precisamos que preencha ou confirme suas informações de identificação e assine os termos de privacidade obrigatórios da LGPD.
        </p>

        {error && (
          <div style={{ marginBottom: '20px', padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }} role="alert">
            <i className="ti ti-alert-circle" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.loginForm} style={{ gap: '20px' }}>
          {/* Dados Pessoais */}
          <div style={{ background: 'rgba(255, 255, 255, 0.01)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Nome Completo</label>
              <div className={styles.inputWrapper}>
                <i className="ti ti-user" aria-hidden="true" />
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder="Seu nome completo"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>CPF</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-id" aria-hidden="true" />
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="000.000.000-00"
                    value={cpf}
                    onChange={handleCpfChange}
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
                    placeholder="(00) 00000-0000"
                    value={telefone}
                    onChange={handleTelefoneChange}
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Termos LGPD */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
            <h4 style={{ margin: '0 0 4px', fontSize: '0.95rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i className="ti ti-shield-lock" style={{ color: '#06b6d4' }} /> Termo de Consentimento e Privacidade
            </h4>

            {/* Consent 1 */}
            <div 
              className={`${styles.consentItem} ${consent1 ? styles.checked : ''}`}
              onClick={() => setConsent1(!consent1)}
              style={{ margin: 0 }}
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
                  Autorização para tratamento de dados do Responsável
                  <span className={styles.consentArt}>Art. 7, I LGPD</span>
                </div>
                <div className={styles.consentItemDesc}>
                  Autorizo a escola a coletar, armazenar e tratar meus dados pessoais cadastrados para fins de identificação, segurança, faturamento e gestão administrativa.
                </div>
              </div>
            </div>

            {/* Consent 2 */}
            <div 
              className={`${styles.consentItem} ${consent2 ? styles.checked : ''}`}
              onClick={() => setConsent2(!consent2)}
              style={{ margin: 0 }}
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
                  Exibição e tratamento de dados escolares do menor
                  <span className={styles.consentArt}>Art. 14 LGPD</span>
                </div>
                <div className={styles.consentItemDesc}>
                  Como responsável legal, autorizo a exibição de notas acadêmicas, boletins, faltas e ocorrências do(s) aluno(s) vinculados diretamente em meu portal.
                </div>
              </div>
            </div>

            {/* Consent 3 */}
            <div 
              className={`${styles.consentItem} ${consent3 ? styles.checked : ''}`}
              onClick={() => setConsent3(!consent3)}
              style={{ margin: 0 }}
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
                  Autorização para notificações e comunicados escolares
                </div>
                <div className={styles.consentItemDesc}>
                  Autorizo o envio de alertas sobre faltas, liberação de boletins bimestrais, avisos pedagógicos e reuniões para meu celular e e-mail.
                </div>
              </div>
            </div>

            {/* Consent 4 */}
            <div 
              className={`${styles.consentItem} ${consent4 ? styles.checked : ''}`}
              onClick={() => setConsent4(!consent4)}
              style={{ margin: 0 }}
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
                  Ciência das Políticas de Privacidade e Direitos LGPD
                  <span className={styles.consentArt}>Art. 18 LGPD</span>
                </div>
                <div className={styles.consentItemDesc}>
                  Declaro ter lido e compreendido a Política de Privacidade Escolar e estar ciente dos meus direitos de acesso, retificação ou exclusão de dados garantidos pela LGPD.
                </div>
              </div>
            </div>
          </div>

          <button 
            type="submit" 
            className={styles.submitBtn} 
            disabled={isButtonDisabled} 
            style={{ 
              marginTop: '12px',
              background: isButtonDisabled ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
              border: 'none',
              fontWeight: 700,
              transition: 'all 0.3s'
            }}
          >
            {loading ? 'Processando...' : 'Salvar e Acessar Portal'}
          </button>
        </form>
      </div>
    </div>
  );
}
