import React, { useState, useEffect } from 'react';
import { updateProfile, ApiError, AuthUser } from '../services/apiService';
import styles from '../styles/portal.module.scss';

interface ProfileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  user: AuthUser;
  onUpdateUser: (updatedUser: AuthUser) => void;
  onLogout: () => void;
  onNavigate: (tab: 'dashboard' | 'linking' | 'profile') => void;
}

function getInitials(name: string): string {
  if (!name) return 'U';
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export default function ProfileSidebar({
  isOpen,
  onClose,
  user,
  onUpdateUser,
  onLogout,
  onNavigate,
}: ProfileSidebarProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [nome, setNome] = useState(user.nome || '');
  const [cpf, setCpf] = useState(user.cpf || '');
  const [telefone, setTelefone] = useState(user.telefone || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Sync state if user prop changes
  useEffect(() => {
    setNome(user.nome || '');
    setCpf(user.cpf || '');
    setTelefone(user.telefone || '');
  }, [user]);

  if (!isOpen) return null;

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

    try {
      const updatedUser = await updateProfile({ nome, cpf, telefone });
      onUpdateUser(updatedUser);
      setIsEditing(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Erro ao salvar os dados.');
      }
    } finally {
      setLoading(false);
    }
  };

  const hasTempCpf = user.cpf?.startsWith('temp_cpf');

  return (
    <div className={styles.sidebarOverlay} onClick={onClose}>
      <div className={styles.sidebarContainer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sidebarHeader}>
          <h3>
            <i className="ti ti-user-circle" /> Opções do Perfil
          </h3>
          <button className={styles.sidebarCloseBtn} onClick={onClose} aria-label="Fechar menu lateral">
            <i className="ti ti-x" />
          </button>
        </div>

        <div className={styles.sidebarScrollContent}>
          {/* User Card */}
          <div className={styles.sidebarUserCard}>
            <div className={styles.sidebarAvatar}>
              <span>{getInitials(user.nome)}</span>
            </div>
            <h4>{user.nome}</h4>
            <p>{user.email}</p>
            <span className={styles.sidebarRoleBadge}>Responsável</span>
          </div>

          {error && (
            <div className={styles.sidebarError}>
              <i className="ti ti-alert-circle" />
              <span>{error}</span>
            </div>
          )}

          {isEditing ? (
            <form onSubmit={handleSubmit} className={styles.sidebarForm}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Nome Completo</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-user" />
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
                <label className={styles.formLabel}>CPF</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-id" />
                  <input
                    type="text"
                    className={styles.formInput}
                    value={hasTempCpf ? '' : cpf}
                    placeholder="000.000.000-00"
                    onChange={handleCpfChange}
                    required
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Telefone Celular</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-phone" />
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

              <div className={styles.sidebarFormActions}>
                <button type="submit" className={styles.btnPrimary} disabled={loading}>
                  {loading ? 'Salvando...' : 'Salvar'}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => {
                    setIsEditing(false);
                    setError('');
                  }}
                  disabled={loading}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
             <div className={styles.sidebarDetailsList}>
              <div className={styles.sidebarDetailItem}>
                <label>CPF</label>
                <span>{hasTempCpf ? 'Não informado' : user.cpf}</span>
              </div>
              <div className={styles.sidebarDetailItem}>
                <label>Telefone</label>
                <span>{user.telefone === '(00) 00000-0000' ? 'Não informado' : user.telefone}</span>
              </div>
              <div className={styles.sidebarDetailItem}>
                <label>LGPD</label>
                {user.consentimentoAceiteEm ? (
                  <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ Assinado</span>
                ) : (
                  <button
                    onClick={async () => {
                      try {
                        setLoading(true);
                        const updated = await updateProfile({
                          nome: user.nome || '',
                          cpf: user.cpf || '',
                          telefone: user.telefone || '',
                          consentimentoAceiteEm: true
                        });
                        onUpdateUser(updated);
                        alert('Termo LGPD assinado com sucesso!');
                      } catch (err) {
                        alert(err instanceof Error ? err.message : 'Erro ao assinar LGPD.');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    style={{
                      background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
                      border: 'none',
                      color: '#fff',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      fontWeight: 700
                    }}
                    disabled={loading}
                  >
                    Assinar LGPD
                  </button>
                )}
              </div>

              <button className={styles.sidebarEditBtn} onClick={() => {
                onNavigate('profile');
                onClose();
              }}>
                <i className="ti ti-signature" /> {user.consentimentoAceiteEm ? 'Alterar Cadastro / Termo LGPD' : 'Assinar Termo LGPD e Cadastro'}
              </button>

              <hr className={styles.sidebarSeparator} />

              <div className={styles.sidebarNav}>
                <button
                  onClick={() => {
                    onNavigate('dashboard');
                    onClose();
                  }}
                  className={styles.sidebarNavLink}
                >
                  <i className="ti ti-home" /> Ir para o Painel (Home)
                </button>
                <button
                  onClick={() => {
                    onNavigate('linking');
                    onClose();
                  }}
                  className={styles.sidebarNavLink}
                >
                  <i className="ti ti-user-plus" /> Vincular Novo Filho
                </button>
                <button
                  onClick={() => {
                    onNavigate('profile');
                    onClose();
                  }}
                  className={styles.sidebarNavLink}
                >
                  <i className="ti ti-shield-lock" /> {user.consentimentoAceiteEm ? 'Visualizar Termo LGPD' : 'Assinar Termo LGPD e Cadastro'}
                </button>
                <a
                  href="/mudar-senha.html"
                  target="_blank"
                  rel="noreferrer"
                  className={styles.sidebarNavLink}
                >
                  <i className="ti ti-lock" /> Mudar Senha da Conta
                </a>
              </div>

              <hr className={styles.sidebarSeparator} />

              <button className={styles.sidebarLogoutBtn} onClick={onLogout}>
                <i className="ti ti-logout" /> Sair da Conta
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
