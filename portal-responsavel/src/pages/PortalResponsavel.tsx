import React, { useCallback, useEffect, useState } from 'react';
import {
  getAlunosDoResponsavel,
  getFrequenciaDoAluno,
  getNotasDoAluno,
  updateProfile,
  ApiError,
  updateTutorial,
} from '../services/apiService';
import Header from '../components/Header';
import CompletarCadastro from '../components/CompletarCadastro';
import NotificationsModal from '../components/NotificationsModal';
import ProfileSidebar from '../components/ProfileSidebar';
import type { Student, Grade, Attendance, GmailUser, AuthUser } from '../types';
import ChatbotIA from '../components/ChatbotIA';
import schoolLogo from '../assets/logo-jaguari.png';
import styles from '../styles/portal.module.scss';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import PortalOnboardingManager from '../components/PortalOnboardingManager';
import Toast from '../components/Toast';
import LgpdConsentWidget from '../components/LgpdConsentWidget';
import { PortalTabContent } from '../components/PortalTabs';
import { getPhotoUrl } from '../utils/photoUtils';
import Icon from '../components/ui/Icon';

function toGmailUser(u: AuthUser, googleProfile?: GmailUser | null): GmailUser {
  return {
    email: u.email,
    name: u.nome,
    picture: u.foto || googleProfile?.picture || u.fotoGoogle || '',
    accessToken: googleProfile?.accessToken || '',
  };
}

const getPasswordStrength = (pwd: string) => {
  if (!pwd) return { width: '0%', color: '#ef4444', text: '' };
  if (pwd.length < 6) return { width: '15%', color: '#ef4444', text: 'Muito curta' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  switch (score) {
    case 0:
    case 1: return { width: '25%', color: '#ef4444', text: 'Fraca' };
    case 2: return { width: '50%', color: '#f59e0b', text: 'Média' };
    case 3: return { width: '75%', color: '#3b82f6', text: 'Boa' };
    case 4: return { width: '100%', color: '#10b981', text: 'Forte' };
    default: return { width: '0%', color: '#ef4444', text: '' };
  }
};

type PortalTab = 'dashboard' | 'ficha' | 'linking' | 'profile';

const PortalResponsavel: React.FC = () => {
  const rawApiUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
    : '/api';
  const cleanApiUrl = rawApiUrl.replace(/\/api$/, '');

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const {
    authUser,
    setAuthUser,
    authLoading,
    authError,
    email,
    setEmail,
    senha,
    setSenha,
    loginLoading,
    showPassword,
    setShowPassword,
    showRegisterPassword,
    setShowRegisterPassword,
    isRegistering,
    setIsRegistering,
    registerForm,
    setRegisterForm,
    showForgotModal,
    setShowForgotModal,
    forgotEmail,
    setForgotEmail,
    forgotLoading,
    forgotStep,
    setForgotStep,
    forgotCode,
    setForgotCode,
    forgotNewPassword,
    setForgotNewPassword,
    forgotConfirmPassword,
    setForgotConfirmPassword,
    codeCountdown,
    resendCountdown,
    showNewPassword,
    setShowNewPassword,
    gmailUser,
    gmailAuthError,
    resetForgotModal,
    handleForgotSendCode,
    handleResendCode,
    handleForgotVerifyCode,
    handleForgotResetPassword,
    handleGoogleLogin,
    handleLogin,
    handleRegister,
    handleLogout,
  } = useAuth({ cleanApiUrl, onToast: setToast });

  const [students, setStudents] = useState<Student[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<PortalTab>('dashboard');
  const [showSidebar, setShowSidebar] = useState(false);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const {
    notifications,
    showNotifications,
    setShowNotifications,
    showNotificationsModal,
    setShowNotificationsModal,
    priorityNotification,
    setPriorityNotification,
    handleMarkAsRead,
    handleDeleteNotification,
  } = useNotifications({ authUser, activeId });

  const activeStudent = students.find((student) => student.id === activeId) || null;

  const loadData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const alunos = await getAlunosDoResponsavel();
      setStudents(alunos);

      // Seleciona o primeiro aluno se nenhum válido estiver ativo.
      // setActiveId funcional evita depender de activeId — antes cada troca
      // de aluno recriava loadData e refazia o fetch da lista inteira.
      setActiveId((atual) => {
        if (alunos.length === 0) return null;
        if (atual && alunos.find((aluno) => aluno.id === atual)) return atual;
        return alunos[0].id;
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erro ao carregar lista de alunos.';
      setDataError(message);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authUser) void loadData();
  }, [authUser, loadData]);

  useEffect(() => {
    if (!activeId) return;

    let isMounted = true;
    const fetchDetails = async () => {
      setDetailsLoading(true);
      try {
        const [notasData, freqData] = await Promise.all([
          getNotasDoAluno(activeId),
          getFrequenciaDoAluno(activeId),
        ]);
        if (isMounted) {
          setGrades(notasData);
          setAttendance(freqData);
        }
      } catch (err) {
        if (isMounted) console.error('Erro ao buscar detalhes do aluno', err);
      } finally {
        if (isMounted) setDetailsLoading(false);
      }
    };

    void fetchDetails();
    return () => {
      isMounted = false;
    };
  }, [activeId]);

  const handlePasswordRecoveryShortcut = async () => {
    await handleLogout();
    setShowForgotModal(true);
  };

  if (authLoading) {
    return (
      <div className={styles.fullscreenCenter} aria-live="polite" aria-busy="true">
        <span className={styles.spinner} aria-label="Verificando sessão…" />
        <p className={styles.loadingText}>Verificando sessão…</p>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className={styles.loginPage}>
        <Toast toast={toast} onClose={() => setToast(null)} />

        <div className={styles.loginCard}>
          <div className={styles.loginLogo}>
            <img src={schoolLogo} alt="Escola Jaguari Logo" />
          </div>
          <h1 className={styles.loginTitle}>Escola Jaguari</h1>
          <p className={styles.loginSubtitle}>Portal do Responsável</p>
          <p className={styles.loginDescription}>Acompanhe notas, frequência e comunicados do seu filho(a).</p>

          {(authError || gmailAuthError) && (
            <div className={styles.errorAlert} role="alert">
              <Icon name="alert-circle" aria-hidden="true" />
              {authError || gmailAuthError}
            </div>
          )}

          {isRegistering ? (
            <form onSubmit={handleRegister} className={styles.loginForm} noValidate>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Nome Completo</label>
                <div className={styles.inputWrapper}>
                  <Icon name="user" aria-hidden="true" />
                  <input type="text" className={styles.formInput} placeholder="Seu nome" value={registerForm.nome} onChange={(e) => setRegisterForm({ ...registerForm, nome: e.target.value })} required />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>E-mail</label>
                <div className={styles.inputWrapper}>
                  <Icon name="mail" aria-hidden="true" />
                  <input type="email" className={styles.formInput} placeholder="seu@email.com" value={registerForm.email} onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })} required />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Senha</label>
                <div className={styles.inputWrapper}>
                  <Icon name="lock" aria-hidden="true" />
                  <input type={showRegisterPassword ? 'text' : 'password'} className={`${styles.formInput} ${styles.passwordInput}`} placeholder="Crie uma senha forte" value={registerForm.senha} onChange={(e) => setRegisterForm({ ...registerForm, senha: e.target.value })} required />
                  <button type="button" className={styles.passwordToggle} onClick={() => setShowRegisterPassword(!showRegisterPassword)} aria-label={showRegisterPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                    <i className={`ti ${showRegisterPassword ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <button type="submit" className={styles.submitBtn} disabled={loginLoading}>
                {loginLoading ? 'Criando...' : 'Criar Conta'}
              </button>
              <div className={styles.divider}><span>ou</span></div>
              <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0', width: '100%' }}>
                <button type="button" className={styles.gmailBtn} onClick={() => void handleGoogleLogin()} disabled={loginLoading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48px" height="48px"><path fill="%23fbc02d" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="%23e53935" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="%234caf50" d="M24,44c5.166,0,9.86-1.977,13.422-5.189l-6.19-5.158C29.255,34.908,26.74,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="%231565c0" d="M43.611,20.083L43.611,20.083L42,20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.158C36.914,39.112,44,34.429,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>' alt="Google Logo" style={{ width: '18px', height: '18px' }} />
                  <span>{loginLoading ? 'Conectando...' : 'Cadastrar com o Google'}</span>
                </button>
              </div>
              <div className={styles.registerSection}>
                <p>Já tem uma conta?</p>
                <button type="button" onClick={() => { setIsRegistering(false); }} className={styles.registerLink} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                  Fazer Login
                </button>
              </div>
            </form>
          ) : (
            <>
              <form onSubmit={handleLogin} className={styles.loginForm} noValidate>
                <div className={styles.formGroup}>
                  <label htmlFor="email" className={styles.formLabel}>E-mail</label>
                  <div className={styles.inputWrapper}>
                    <Icon name="mail" aria-hidden="true" />
                    <input id="email" type="email" className={styles.formInput} placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" aria-label="E-mail do responsável" />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="senha" className={styles.formLabel}>Senha</label>
                  <div className={styles.inputWrapper}>
                    <Icon name="lock" aria-hidden="true" />
                    <input id="senha" type={showPassword ? 'text' : 'password'} className={`${styles.formInput} ${styles.passwordInput}`} placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="current-password" aria-label="Senha" />
                    <button type="button" className={styles.passwordToggle} onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                      <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-8px', marginBottom: '16px' }}>
                  <button type="button" onClick={() => setShowForgotModal(true)} className={styles.registerLink} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.85rem' }}>
                    Esqueceu a senha?
                  </button>
                </div>
                <button type="submit" className={styles.submitBtn} disabled={loginLoading} aria-busy={loginLoading}>
                  {loginLoading ? (
                    <>
                      <span className={styles.spinnerSm} aria-hidden="true" />
                      Entrando…
                    </>
                  ) : (
                    <>
                      <Icon name="login" aria-hidden="true" />
                      Entrar
                    </>
                  )}
                </button>
              </form>

              {showForgotModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }} onClick={() => { setShowForgotModal(false); resetForgotModal(); }}>
                  <div className={styles.loginCard} style={{ maxWidth: '420px', width: '90%', padding: '28px', border: '1px solid rgba(255,255,255,0.08)' }} onClick={(e) => e.stopPropagation()}>
                    <form onSubmit={(e) => { e.preventDefault(); if (forgotStep === 1) void handleForgotSendCode(); else if (forgotStep === 2) void handleForgotVerifyCode(); else if (forgotStep === 3) void handleForgotResetPassword(); }} noValidate>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Icon name="key" style={{ color: '#10b981' }} /> Recuperar Senha
                        </h3>
                        <button type="button" onClick={() => { setShowForgotModal(false); resetForgotModal(); }} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1.4rem' }}>&times;</button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '20px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: forgotStep >= 1 ? '#10b981' : 'rgba(255,255,255,0.1)' }} />
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: forgotStep >= 2 ? '#10b981' : 'rgba(255,255,255,0.1)' }} />
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: forgotStep >= 3 ? '#10b981' : 'rgba(255,255,255,0.1)' }} />
                      </div>
                      {forgotStep === 1 && (
                        <div className={styles.loginForm}>
                          <p style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: '1.5', marginBottom: '20px' }}>Informe seu e-mail cadastrado. Enviaremos um código de 6 dígitos para redefinir sua senha.</p>
                          <div className={styles.formGroup} style={{ marginBottom: '24px' }}>
                            <label className={styles.formLabel}>E-mail</label>
                            <div className={styles.inputWrapper}>
                              <Icon name="mail" aria-hidden="true" />
                              <input type="email" className={styles.formInput} placeholder="seu@email.com" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} autoFocus />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="button" onClick={() => { setShowForgotModal(false); resetForgotModal(); }} className={styles.gmailBtn} style={{ flex: 1, margin: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>Cancelar</button>
                            <button type="submit" className={styles.submitBtn} disabled={forgotLoading} style={{ flex: 2, margin: 0 }}>{forgotLoading ? 'Enviando...' : 'Enviar Código'}</button>
                          </div>
                        </div>
                      )}
                      {forgotStep === 2 && (
                        <div className={styles.loginForm}>
                          <p style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: '1.5', marginBottom: '20px' }}>Enviamos um código de recuperação para <strong>{forgotEmail}</strong>. Insira-o abaixo.</p>
                          <div className={styles.formGroup} style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <label className={styles.formLabel} style={{ alignSelf: 'flex-start' }}>Código de 6 dígitos</label>
                            <input type="text" className={styles.formInput} placeholder="000000" value={forgotCode} onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '6px', maxWidth: '200px', fontWeight: 'bold' }} autoFocus />
                          </div>
                          <div style={{ textAlign: 'center', marginBottom: '16px', fontSize: '0.85rem' }}>
                            <p style={{ color: '#64748b', margin: '0 0 8px 0' }}>
                              <Icon name="clock" /> Código válido por <strong style={{ color: '#10b981' }}>{Math.floor(codeCountdown / 60)}:{String(codeCountdown % 60).padStart(2, '0')}</strong>
                            </p>
                            <div>
                              <span style={{ color: '#64748b' }}>Não recebeu? </span>
                              <button type="button" onClick={() => void handleResendCode()} disabled={resendCountdown > 0 || forgotLoading} style={{ background: 'none', border: 'none', color: resendCountdown > 0 ? '#64748b' : '#10b981', textDecoration: 'underline', cursor: resendCountdown > 0 ? 'not-allowed' : 'pointer', padding: 0 }}>
                                {resendCountdown > 0 ? `Reenviar em ${resendCountdown}s` : 'Reenviar Código'}
                              </button>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="button" onClick={() => setForgotStep(1)} className={styles.gmailBtn} style={{ flex: 1, margin: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>Voltar</button>
                            <button type="submit" className={styles.submitBtn} disabled={forgotLoading} style={{ flex: 2, margin: 0 }}>{forgotLoading ? 'Verificando...' : 'Verificar Código'}</button>
                          </div>
                        </div>
                      )}
                      {forgotStep === 3 && (
                        <div className={styles.loginForm}>
                          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                            <Icon name="circle-check" style={{ fontSize: '2rem', color: '#10b981' }} />
                            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '4px' }}>Código validado com sucesso!</p>
                          </div>
                          <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
                            <label className={styles.formLabel}>Nova Senha</label>
                            <div className={styles.inputWrapper}>
                              <Icon name="lock" aria-hidden="true" />
                              <input type={showNewPassword ? 'text' : 'password'} className={styles.formInput} placeholder="Mínimo 8 caracteres" value={forgotNewPassword} onChange={(e) => setForgotNewPassword(e.target.value)} autoFocus />
                              <button type="button" className={styles.passwordToggle} onClick={() => setShowNewPassword(!showNewPassword)}>
                                <i className={`ti ${showNewPassword ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                          {forgotNewPassword && (
                            <div style={{ marginBottom: '16px' }}>
                              <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', transition: 'all 0.3s', ...(() => { const str = getPasswordStrength(forgotNewPassword); return { width: str.width, backgroundColor: str.color }; })() }} />
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '0.75rem' }}>
                                <span style={{ color: (() => { const str = getPasswordStrength(forgotNewPassword); return str.color; })() }}>
                                  Força: {getPasswordStrength(forgotNewPassword).text}
                                </span>
                              </div>
                            </div>
                          )}
                          <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '6px', fontSize: '0.75rem', color: '#94a3b8' }}>
                            <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', color: '#fff' }}>Requisitos da senha:</p>
                            <ul style={{ margin: 0, paddingLeft: '16px', listStyleType: 'disc' }}>
                              <li style={{ color: forgotNewPassword.length >= 8 ? '#10b981' : '#94a3b8' }}>Mínimo 8 caracteres</li>
                              <li style={{ color: /[A-Z]/.test(forgotNewPassword) ? '#10b981' : '#94a3b8' }}>Pelo menos 1 letra maiúscula</li>
                              <li style={{ color: /[0-9]/.test(forgotNewPassword) ? '#10b981' : '#94a3b8' }}>Pelo menos 1 número</li>
                            </ul>
                          </div>
                          <div className={styles.formGroup} style={{ marginBottom: '24px' }}>
                            <label className={styles.formLabel}>Confirmar Senha</label>
                            <div className={styles.inputWrapper}>
                              <Icon name="lock" aria-hidden="true" />
                              <input type={showNewPassword ? 'text' : 'password'} className={styles.formInput} placeholder="••••••••" value={forgotConfirmPassword} onChange={(e) => setForgotConfirmPassword(e.target.value)} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="button" onClick={() => setForgotStep(2)} className={styles.gmailBtn} style={{ flex: 1, margin: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>Voltar</button>
                            <button type="submit" className={styles.submitBtn} disabled={forgotLoading} style={{ flex: 2, margin: 0 }}>{forgotLoading ? 'Alterando...' : 'Alterar Senha'}</button>
                          </div>
                        </div>
                      )}
                    </form>
                  </div>
                </div>
              )}

              <div className={styles.divider}><span>ou</span></div>
              <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0', width: '100%' }}>
                <button type="button" className={styles.gmailBtn} onClick={() => void handleGoogleLogin()} disabled={loginLoading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48px" height="48px"><path fill="%23fbc02d" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="%23e53935" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="%234caf50" d="M24,44c5.166,0,9.86-1.977,13.422-5.189l-6.19-5.158C29.255,34.908,26.74,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="%231565c0" d="M43.611,20.083L43.611,20.083L42,20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.158C36.914,39.112,44,34.429,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>' alt="Google Logo" style={{ width: '18px', height: '18px' }} />
                  <span>{loginLoading ? 'Conectando...' : 'Entrar com o Google'}</span>
                </button>
              </div>
              <div className={styles.registerSection}>
                <p>Novo por aqui?</p>
                <button type="button" onClick={() => { try { sessionStorage.setItem('primeiroAcessoTipo', 'responsavel'); } catch (e) {} window.location.href = '/primeiro-acesso.html'; }} className={styles.registerLink} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-block' }}>
                  Criar perfil
                </button>
              </div>
            </>
          )}

          <p className={styles.loginDisclaimer} style={{ marginTop: '24px' }}>Seus dados são protegidos pela LGPD. Apenas responsáveis cadastrados têm acesso.</p>
        </div>
      </div>
    );
  }

  const headerUser = toGmailUser(authUser, gmailUser);
  const isProfileIncomplete = authUser.profileCompleted === false;

  if (isProfileIncomplete) {
    return (
      <div className={styles.portal}>
        <Header user={headerUser} notifications={notifications} onLogout={handleLogout} onBellClick={() => setShowNotifications((value) => !value)} onProfileClick={() => {}} />
        <CompletarCadastro user={authUser} onSuccess={(updatedUser) => { setAuthUser(updatedUser); setToast({ message: 'Cadastro completado com sucesso!', type: 'success' }); }} />
      </div>
    );
  }

  const lgpdAccepted = !!(authUser as any).consentimentoAceiteEm;

  const handleSignLgpd = async () => {
    try {
      const updated = await updateProfile({
        nome: authUser.nome || '',
        telefone: authUser.telefone || '',
        consentimentoAceiteEm: true,
      });
      setAuthUser(updated);
      setToast({ message: 'Termo LGPD assinado com sucesso!', type: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Erro ao assinar LGPD.', type: 'error' });
    }
  };

  const getInitials = (name: string) => {
    if (!name) return 'U';
    return name.split(' ').slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  };

  return (
    <div className={styles.portal}>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <Header user={headerUser} notifications={notifications} onLogout={handleLogout} onBellClick={() => setShowNotificationsModal(true)} onProfileClick={() => setShowSidebar(true)} activeTab={currentTab} />

      <div className={styles.portalBody}>
        <aside className={styles.desktopSidebar} data-tour="sidebar">
          <div className={styles.desktopSidebarUserCard} data-tour="profile">
            <div className={styles.desktopSidebarAvatar}>
              {(() => {
                const photoUrl = getPhotoUrl(authUser.foto || authUser.fotoGoogle || '');
                const hasPhoto = photoUrl !== '/img/default-avatar.png';
                return hasPhoto ? (
                  <img
                    src={photoUrl}
                    alt={authUser.nome}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <span>{getInitials(authUser.nome)}</span>
                );
              })()}
            </div>
            <h4>{authUser.nome}</h4>
            <p>{authUser.email}</p>
          </div>

          {students.length > 0 && (
            <div className={styles.desktopSidebarSchoolCard} aria-label="Escola dos filhos vinculados">
              <span className={styles.desktopSidebarSchoolTitle}>
                <Icon name="school" aria-hidden="true" /> {students.length > 1 ? 'Escolas dos filhos' : 'Escola do filho'}
              </span>
              <ul className={styles.desktopSidebarSchoolList}>
                {students.map((student) => (
                  <li key={student.id}>
                    <span className={styles.schoolChildName}>{student.nome} {student.sobrenome}</span>
                    <span className={styles.schoolName}>
                      <Icon name="building" aria-hidden="true" /> {student.escolaNome || 'Escola Jaguari'}
                      {student.turma ? <span className={styles.schoolTurma}> · {student.turma}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <LgpdConsentWidget accepted={lgpdAccepted} onSign={handleSignLgpd} />

          <nav className={styles.desktopSidebarNav} aria-label="Menu principal">
            <button onClick={() => setCurrentTab('dashboard')} className={`${styles.desktopSidebarNavLink} ${currentTab === 'dashboard' ? styles.active : ''}`}>
              <Icon name="home" /> Painel Geral
            </button>
            <button onClick={() => setCurrentTab('ficha')} className={`${styles.desktopSidebarNavLink} ${currentTab === 'ficha' ? styles.active : ''}`}>
              <Icon name="clipboard-list" /> Ficha &amp; Autorizações
            </button>
            <button onClick={() => setCurrentTab('linking')} className={`${styles.desktopSidebarNavLink} ${currentTab === 'linking' ? styles.active : ''}`}>
              <Icon name="user-plus" /> Vincular meu Filho
            </button>
            <button onClick={() => setCurrentTab('profile')} className={`${styles.desktopSidebarNavLink} ${currentTab === 'profile' ? styles.active : ''}`}>
              <Icon name="signature" /> {authUser?.consentimentoAceiteEm ? 'Alterar Cadastro / Termo LGPD' : 'Assinar Termo LGPD e Cadastro'}
            </button>
            <button onClick={() => void handlePasswordRecoveryShortcut()} className={styles.desktopSidebarNavLink}>
              <Icon name="lock" /> Alterar Senha
            </button>
          </nav>

          <button className={styles.desktopSidebarLogoutBtn} onClick={() => void handleLogout()}>
            <Icon name="logout" /> Sair da Conta
          </button>
        </aside>

        <main className={styles.container} id="main-content" style={{ flex: 1, padding: '24px' }}>
          <div key={currentTab} className={styles.tabFade}>
          <PortalTabContent
            currentTab={currentTab}
            authUser={authUser}
            activeStudent={activeStudent}
            students={students}
            activeId={activeId}
            lgpdAccepted={lgpdAccepted}
            notifications={notifications}
            showNotifications={showNotifications}
            dataLoading={dataLoading}
            detailsLoading={detailsLoading}
            dataError={dataError}
            grades={grades}
            attendance={attendance}
            onUserUpdate={(updated) => {
              setAuthUser(updated);
              void loadData();
            }}
            onLinkingSuccess={() => {
              void loadData();
              setCurrentTab('dashboard');
            }}
            onLinkingCancel={() => setCurrentTab('dashboard')}
            onSelectStudent={setActiveId}
            onRetry={() => void loadData()}
            onShowAllNotifications={() => setShowNotifications(true)}
            onMarkAsRead={(id) => void handleMarkAsRead(id)}
            onDeleteNotification={(id) => void handleDeleteNotification(id)}
            onStudentUpdate={(studentId, partial) => {
              setStudents((prev) => prev.map((student) => (
                student.id === studentId ? { ...student, ...partial } : student
              )));
            }}
          />
          </div>
        </main>
      </div>

      <footer className={styles.footer}>
        <p>
          © {new Date().getFullYear()} Escola Jaguari — Portal do Responsável |{' '}
          <a href="/politica-privacidade.html" target="_blank" rel="noreferrer">
            Política de Privacidade
          </a>
        </p>
      </footer>

      <ProfileSidebar
        isOpen={showSidebar}
        onClose={() => setShowSidebar(false)}
        user={authUser}
        onUpdateUser={(updated) => setAuthUser(updated)}
        onLogout={() => void handleLogout()}
        onPasswordRecovery={() => void handlePasswordRecoveryShortcut()}
        onNavigate={setCurrentTab}
        onRestartTour={async () => {
          await updateTutorial({ reiniciar: true });
          setAuthUser((user) => (user ? { ...user, tutorialResponsavelConcluido: false } : user));
        }}
      />

      <PortalOnboardingManager
        authUser={authUser}
        authLoading={authLoading}
        currentTab={currentTab}
        onUserChange={setAuthUser}
      />

      <NotificationsModal
        isOpen={showNotificationsModal}
        onClose={() => setShowNotificationsModal(false)}
        notifications={notifications}
        onMarkAsRead={(id) => void handleMarkAsRead(id)}
        onDelete={(id) => void handleDeleteNotification(id)}
      />

      {priorityNotification && (
        <div className={styles.priorityAlertOverlay}>
          <div className={styles.priorityAlertCard}>
            <div className={styles.priorityAlertHeader}>
              <Icon name="alert-triangle" />
              <span>Comunicado Importante</span>
            </div>
            <h3 className={styles.priorityAlertTitle}>{priorityNotification.titulo}</h3>
            <p className={styles.priorityAlertBody}>{priorityNotification.mensagem}</p>
            <div className={styles.priorityAlertActions}>
              <button className={styles.btnViewNow} onClick={() => { setPriorityNotification(null); setShowNotificationsModal(true); }}>
                Ver Detalhes
              </button>
              <button className={styles.btnDismiss} onClick={() => setPriorityNotification(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      <ChatbotIA alunoId={activeStudent?.id} />
    </div>
  );
};

export default PortalResponsavel;