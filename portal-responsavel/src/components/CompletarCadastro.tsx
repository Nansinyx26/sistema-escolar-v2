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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Mascara de CPF: 000.000.000-00
  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    
    // Apply formatting
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
    
    // Apply formatting
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

    try {
      const updatedUser = await updateProfile({ nome, cpf, telefone });
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

  return (
    <div className={styles.vincularContainer}>
      <div className={styles.vincularCard} style={{ maxWidth: '480px' }}>
        <h2>
          <i className="ti ti-user-edit" aria-hidden="true" />
          Completar Cadastro
        </h2>
        <p style={{ marginBottom: '24px' }}>
          Para continuar e acessar o portal do seu filho, precisamos que confirme seu nome e informe seu CPF e telefone de contato.
        </p>

        {error && (
          <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
            <i className="ti ti-alert-circle" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.loginForm} style={{ gap: '20px' }}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Nome Completo</label>
            <div className={styles.inputWrapper}>
              <i className="ti ti-user" aria-hidden="true" />
              <input
                type="text"
                className={styles.formInput}
                placeholder="Seu nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

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

          <button type="submit" className={styles.submitBtn} disabled={loading} style={{ marginTop: '12px' }}>
            {loading ? 'Salvando...' : 'Salvar e Acessar Portal'}
          </button>
        </form>
      </div>
    </div>
  );
}
