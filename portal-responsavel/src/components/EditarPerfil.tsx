import React, { useState, useEffect } from 'react';
import { updateProfile, ApiError, AuthUser } from '../services/apiService';
import styles from '../styles/portal.module.scss';

interface EditarPerfilProps {
  user: AuthUser;
  onSuccess: (updatedUser: AuthUser) => void;
}

export default function EditarPerfil({ user, onSuccess }: EditarPerfilProps) {
  const [nome, setNome] = useState(user.nome || '');
  const [cpf, setCpf] = useState(user.cpf || '');
  const [telefone, setTelefone] = useState(user.telefone || '');
  const [privacyConsent, setPrivacyConsent] = useState(!!user.consentimentoAceiteEm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    setNome(user.nome || '');
    setCpf(user.cpf || '');
    setTelefone(user.telefone || '');
    setPrivacyConsent(!!user.consentimentoAceiteEm);
  }, [user]);

  // Mascara de CPF: 000.000.000-00
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

  // Mascara de Telefone: (00) 00000-0000 ou (00) 0000-0000
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

    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const updatedUser = await updateProfile({
        nome,
        cpf,
        telefone,
        consentimentoAceiteEm: privacyConsent,
      });
      onSuccess(updatedUser);
      setSuccessMsg('Perfil atualizado com sucesso!');
      setTimeout(() => setSuccessMsg(''), 4000);
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

  const hasTempCpf = user.cpf?.startsWith('temp_cpf');

  return (
    <article className={styles.profileViewCard} aria-label="Editar dados cadastrais">
      <h2>
        <i className="ti ti-user-edit" aria-hidden="true" />
        Cadastro do Responsável
      </h2>
      <p className={styles.subtitle}>
        Confirme ou altere seus dados de cadastro e gerencie seu consentimento LGPD.
      </p>

      {error && (
        <div className={styles.sidebarError} role="alert">
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
        {/* Avatar Section */}
        <div className={styles.avatarSection}>
          <div className={styles.avatarUploadPreview}>
            <span>{getInitials(nome)}</span>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Responsável Cadastrado</span>
        </div>

        {/* Basic Info */}
        <div className={styles.profileFormSection}>
          <h3 className={styles.profileSectionTitle}>
            <i className="ti ti-id-badge" /> Informações Pessoais
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>CPF</label>
              <div className={styles.inputWrapper}>
                <i className="ti ti-id" aria-hidden="true" />
                <input
                  type="text"
                  className={styles.formInput}
                  value={hasTempCpf && cpf.startsWith('temp_cpf') ? '' : cpf}
                  placeholder="000.000.000-00"
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
                  value={telefone === '(00) 00000-0000' ? '' : telefone}
                  placeholder="(00) 00000-0000"
                  onChange={handleTelefoneChange}
                  required
                />
              </div>
            </div>
          </div>
        </div>

        {/* LGPD Consent */}
        <div className={styles.lgpdConsentSection}>
          <input
            type="checkbox"
            id="lgpdPrivacyConsent"
            checked={privacyConsent}
            onChange={(e) => setPrivacyConsent(e.target.checked)}
          />
          <label htmlFor="lgpdPrivacyConsent">
            Li e aceito as{' '}
            <a href="/politica-privacidade.html" target="_blank" rel="noreferrer">
              Políticas de Privacidade
            </a>{' '}
            e dou o meu consentimento livre e esclarecido para o tratamento e exibição dos meus dados de acordo com a LGPD (Lei 13.709/2018).
          </label>
        </div>

        {/* Actions */}
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={loading}
          style={{ background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)', border: 'none', fontWeight: 700 }}
        >
          {loading ? 'Salvando Alterações...' : 'Salvar Dados de Cadastro'}
        </button>
      </form>
    </article>
  );
}
