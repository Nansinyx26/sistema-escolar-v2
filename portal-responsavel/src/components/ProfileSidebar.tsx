import React, { useState, useEffect } from 'react';
import { updateProfile, ApiError } from '../services/apiService';
import type { AuthUser } from '../types';
import styles from '../styles/portal.module.scss';
import { getPhotoUrl } from '../utils/photoUtils';

interface ProfileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  user: AuthUser;
  onUpdateUser: (updatedUser: AuthUser) => void;
  onLogout: () => void;
  onPasswordRecovery: () => void;
  onNavigate: (tab: 'dashboard' | 'linking' | 'profile') => void;
  onRestartTour?: () => void;
}

function getInitials(name: string): string {
  if (!name) return 'U';
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export default function ProfileSidebar({
  isOpen,
  onClose,
  user,
  onUpdateUser,
  onLogout,
  onPasswordRecovery,
  onNavigate,
  onRestartTour,
}: ProfileSidebarProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [nome, setNome] = useState(user.nome || '');
  const [telefone, setTelefone] = useState(user.telefone || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Sync state if user prop changes
  useEffect(() => {
    setNome(user.nome || '');
    setTelefone(user.telefone || '');
  }, [user]);

  if (!isOpen) return null;

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
    if (telefone.length < 14) {
      setError('Telefone inválido. Preencha o telefone com DDD.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const updatedUser = await updateProfile({ nome, telefone });
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

  return (
    <div className={styles.sidebarOverlay} onClick={onClose}>
      <div className={styles.sidebarContainer} onClick={(e) => e.stopPropagation()} data-tour="sidebar">
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
          <div className={styles.sidebarUserCard} data-tour="profile">
            <div className={styles.sidebarAvatar}>
              {(() => {
                const photoUrl = getPhotoUrl(user.foto || user.fotoGoogle || '');
                const hasPhoto = photoUrl !== '/img/default-avatar.png';
                return hasPhoto ? (
                  <img
                    src={photoUrl}
                    alt={user.nome}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <span>{getInitials(user.nome)}</span>
                );
              })()}
            </div>
            <h4>{user.nome}</h4>
            <p>{user.email}</p>
            <span className={styles.sidebarRoleBadge}>Responsável</span>
            {/* Quick link to edit photo/name */}
            <button
              type="button"
              onClick={() => { onNavigate('profile'); onClose(); }}
              style={{
                marginTop: '8px',
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '5px 12px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 600,
                background: 'rgba(16, 185, 129,0.08)', border: '1px solid rgba(16, 185, 129,0.2)',
                color: '#10b981', cursor: 'pointer', transition: 'background 0.2s',
              }}
            >
              <i className="ti ti-camera" /> Editar foto e nome
            </button>
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
                      background: 'linear-gradient(135deg, #10b981, #8b5cf6)',
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
                    onNavigate('profile');
                    onClose();
                  }}
                  className={styles.sidebarNavLink}
                >
                  <i className="ti ti-shield-lock" /> {user.consentimentoAceiteEm ? 'Visualizar Termo LGPD' : 'Assinar Termo LGPD e Cadastro'}
                </button>
                <button
                  onClick={onPasswordRecovery}
                  className={styles.sidebarNavLink}
                >
                  <i className="ti ti-lock" /> Mudar Senha da Conta
                </button>
                {onRestartTour && (
                  <button
                    type="button"
                    onClick={() => { onRestartTour(); onClose(); }}
                    className={styles.sidebarNavLink}
                  >
                    <i className="ti ti-help" /> Ver Tutorial Novamente
                  </button>
                )}
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
