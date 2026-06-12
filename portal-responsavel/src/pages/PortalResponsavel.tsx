/**
 * pages/PortalResponsavel.tsx
 * Main page of the guardian portal.
 *
 * Authentication: e-mail + senha (same JWT cookie as the rest of the system).
 * Data: fetched from the real backend API (/api/responsavel/*).
 * Notifications: kept as mock until the school implements a notifications API.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  login,
  googleLogin,
  logout as apiLogout,
  getMe,
  getAlunosDoResponsavel,
  getNotasDoAluno,
  getFrequenciaDoAluno,
  getNotificacoesDoAluno,
  marcarNotificacaoLida,
  ocultarNotificacao,
  updateProfile,
  ApiError,
  type AuthUser,
} from '../services/apiService';
import Header from '../components/Header';
import StudentCard from '../components/StudentCard';
import NotesCard from '../components/NotesCard';
import FrequencyCard from '../components/FrequencyCard';
import AnnouncementFeed from '../components/AnnouncementFeed';
import NotificationsPanel from '../components/NotificationsPanel';
import CompletarCadastro from '../components/CompletarCadastro';
import NotificationsModal from '../components/NotificationsModal';
import ProfileSidebar from '../components/ProfileSidebar';
import EditarPerfil from '../components/EditarPerfil';
import VincularFilho from '../components/VincularFilho';
import FichaAluno from '../components/FichaAluno';
import NotificationSettings from '../components/NotificationSettings';
import OnboardingTour, { RESPONSAVEL_TOUR_STEPS } from '../components/OnboardingTour';
import { updateTutorial } from '../services/apiService';
import { useGmailAuth } from '../hooks/useGmailAuth';
import { socket } from '../services/socket';
import type { Student, Grade, Attendance, Notification, GmailUser } from '../types';
import schoolLogo from '../assets/logo-jaguari.png';
import styles from '../styles/portal.module.scss';

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Convert backend AuthUser to the GmailUser shape the Header expects. */
function toGmailUser(u: AuthUser, googleProfile?: GmailUser | null): GmailUser {
  return {
    email: u.email,
    name: u.nome,
    picture: googleProfile?.picture || u.fotoGoogle || u.foto || '',
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

// ─── Component ────────────────────────────────────────────────────────────────
const PortalResponsavel: React.FC = () => {
  const rawApiUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
    : '/api';
  const cleanApiUrl = rawApiUrl.replace(/\/api$/, '');

  // ── Auth state ─────────────────────────────────────────────────────────────
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // ── Login form ─────────────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  // ── Data state ─────────────────────────────────────────────────────────────
  const [students, setStudents] = useState<Student[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Auth UI states
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerForm, setRegisterForm] = useState({ nome: '', email: '', senha: '', cpf: '', telefone: '' });
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // Check initial session
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'linking' | 'profile'>('dashboard');
  const [showSidebar, setShowSidebar] = useState(false);

  // Forgot password states
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2 | 3>(1);
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [codeCountdown, setCodeCountdown] = useState(15 * 60);
  const [resendCountdown, setResendCountdown] = useState(60);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);

  // Timer refs
  const codeTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const resendTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const clearForgotTimers = useCallback(() => {
    if (codeTimerRef.current) { clearInterval(codeTimerRef.current); codeTimerRef.current = null; }
    if (resendTimerRef.current) { clearInterval(resendTimerRef.current); resendTimerRef.current = null; }
  }, []);

  const startTimers = useCallback(() => {
    clearForgotTimers();
    setCodeCountdown(15 * 60);
    setResendCountdown(60);

    codeTimerRef.current = setInterval(() => {
      setCodeCountdown(prev => {
        if (prev <= 1) { if (codeTimerRef.current) clearInterval(codeTimerRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);

    resendTimerRef.current = setInterval(() => {
      setResendCountdown(prev => {
        if (prev <= 1) { if (resendTimerRef.current) clearInterval(resendTimerRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, [clearForgotTimers]);

  const resetForgotModal = useCallback(() => {
    setForgotStep(1);
    setForgotEmail('');
    setForgotCode('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setForgotLoading(false);
    setShowNewPassword(false);
    clearForgotTimers();
  }, [clearForgotTimers]);

  // Step 1: Send code
  const handleForgotSendCode = async () => {
    if (!forgotEmail) {
      setToast({ message: 'Informe seu e-mail', type: 'error' });
      return;
    }

    setForgotLoading(true);
    try {
      const response = await fetch(`${cleanApiUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: data.message || 'Código enviado! Verifique seu e-mail.', type: 'success' });
        setForgotStep(2);
        startTimers();
      } else {
        setToast({ message: data.error || 'Erro ao enviar código', type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Erro de conexão', type: 'error' });
    } finally {
      setForgotLoading(false);
    }
  };

  // Resend code
  const handleResendCode = async () => {
    setForgotLoading(true);
    try {
      const response = await fetch(`${cleanApiUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Novo código enviado!', type: 'success' });
        setForgotCode('');
        startTimers();
      } else {
        setToast({ message: data.error || 'Erro ao reenviar', type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Erro de conexão', type: 'error' });
    } finally {
      setForgotLoading(false);
    }
  };

  // Step 2: Verify code
  const handleForgotVerifyCode = async () => {
    if (!forgotCode || forgotCode.length !== 6) {
      setToast({ message: 'Insira o código de 6 dígitos', type: 'error' });
      return;
    }

    setForgotLoading(true);
    try {
      const response = await fetch(`${cleanApiUrl}/api/auth/verify-recovery-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail, codigo: forgotCode })
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Código verificado!', type: 'success' });
        clearForgotTimers();
        setForgotStep(3);
      } else {
        setToast({ message: data.error || 'Código inválido', type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Erro de conexão', type: 'error' });
    } finally {
      setForgotLoading(false);
    }
  };

  // Step 3: Reset password
  const handleForgotResetPassword = async () => {
    if (forgotNewPassword.length < 8) {
      setToast({ message: 'A senha deve ter no mínimo 8 caracteres', type: 'error' }); return;
    }
    if (!/[A-Z]/.test(forgotNewPassword)) {
      setToast({ message: 'A senha deve conter pelo menos 1 letra maiúscula', type: 'error' }); return;
    }
    if (!/[0-9]/.test(forgotNewPassword)) {
      setToast({ message: 'A senha deve conter pelo menos 1 número', type: 'error' }); return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setToast({ message: 'As senhas não coincidem', type: 'error' }); return;
    }

    setForgotLoading(true);
    try {
      const response = await fetch(`${cleanApiUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail, codigo: forgotCode, password: forgotNewPassword })
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Senha alterada com sucesso! Faça login.', type: 'success' });
        setShowForgotModal(false);
        resetForgotModal();
      } else {
        setToast({ message: data.error || 'Erro ao alterar senha', type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Erro de conexão', type: 'error' });
    } finally {
      setForgotLoading(false);
    }
  };

  const activeStudent = students.find(s => s.id === activeId) || null;

  const [grades, setGrades] = useState<Grade[]>([]);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [priorityNotification, setPriorityNotification] = useState<Notification | null>(null);
  const tourEvaluatedRef = useRef(false);

  const {
    user: gmailUser,
    loginWithGmail,
    logout: gmailLogout,
    error: gmailAuthError,
  } = useGmailAuth();

  const handleGoogleLogin = async () => {
    setLoginLoading(true);
    setAuthError(null);
    try {
      const googleProfile = await loginWithGmail();
      const user = await googleLogin(googleProfile.accessToken);
      setAuthUser(user);
      setToast({ message: 'Login Google realizado com sucesso!', type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha na autenticação Google';
      setAuthError(msg);
      setToast({ message: msg, type: 'error' });
    } finally {
      setLoginLoading(false);
    }
  };

  // ─── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    getMe()
      .then((u) => setAuthUser(u))
      .catch(() => { /* not logged in */ })
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    // Se o tour já foi concluído ou avaliado nesta sessão, não faz nada
    if (tourEvaluatedRef.current || !authUser || authLoading || currentTab !== 'dashboard') {
      return;
    }

    // Se o usuário já concluiu o tutorial no passado, registra que já avaliamos e não mostra
    if (authUser.tutorialResponsavelConcluido === true) {
      tourEvaluatedRef.current = true;
      setShowTour(false);
      return;
    }

    // Só mostramos se o perfil estiver completo (não estamos no modo onboarding)
    if (!authUser.profileCompleted) {
      return;
    }

    // Se chegamos aqui e o perfil está completo, mas o tutorial não foi feito:
    // Mostramos o tour! Retiramos a trava de students.length === 0
    tourEvaluatedRef.current = true;
    setShowTour(true);
  }, [authUser, authLoading, currentTab, dataLoading]);

  const handleTourFinished = useCallback(() => {
    setShowTour(false);
    setAuthUser(u => u ? { ...u, tutorialResponsavelConcluido: true } : u);
  }, []);

  // Expondo função para reinício manual via Header
  useEffect(() => {
    (window as any).startTourManual = async () => {
      console.log('🔄 Reiniciando tour do responsável...');
      tourEvaluatedRef.current = false;
      // Opcional: resetar no backend se quiser que persista como não lido, 
      // mas o pedido implica apenas reexibir.
      setAuthUser(u => u ? { ...u, tutorialResponsavelConcluido: false } : u);
      setShowTour(true);
    };
    return () => { delete (window as any).startTourManual; };
  }, []);

  // ─── Load student list once authenticated ──────────────────────────────────
  const loadData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const alunos = await getAlunosDoResponsavel();
      setStudents(alunos);

      if (alunos.length > 0) {
        if (!activeId || !alunos.find(a => a.id === activeId)) {
          setActiveId(alunos[0].id);
        }
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao carregar lista de alunos.';
      setDataError(msg);
    } finally {
      setDataLoading(false);
    }
  }, [activeId]);

  // ─── Fetch Details when active student changes ─────────────────────────────
  useEffect(() => {
    if (!activeId) return;

    let isMounted = true;
    const fetchDetails = async () => {
      setDataLoading(true);
      try {
        const [notasData, freqData, notifData] = await Promise.all([
          getNotasDoAluno(activeId),
          getFrequenciaDoAluno(activeId),
          getNotificacoesDoAluno(activeId),
        ]);
        if (isMounted) {
          setGrades(notasData);
          setAttendance(freqData);
          setNotifications(notifData);
        }
      } catch (err) {
        if (isMounted) console.error('Erro ao buscar detalhes do aluno', err);
      } finally {
        if (isMounted) setDataLoading(false);
      }
    };
    fetchDetails();

    // Polling de notificações a cada 60s para manter badge atualizado
    const pollTimer = setInterval(async () => {
      try {
        const notifData = await getNotificacoesDoAluno(activeId);
        if (isMounted) setNotifications(notifData);
      } catch { /* silencioso */ }
    }, 60000);

    return () => { isMounted = false; clearInterval(pollTimer); };
  }, [activeId]);

  // ─── Real-time Notifications Listener ──────────────────────────────────────
  useEffect(() => {
    if (!authUser) return;

    const handleNewNotification = (notif: any) => {
      console.log('📣 Nova notificação recebida:', notif);
      
      // Adicionar à lista local se for para este usuário/aluno/todos
      setNotifications(prev => [notif, ...prev]);

      // Se for prioridade alta, exibir alerta instantâneo
      if (notif.prioridade === 'alta') {
        setPriorityNotification(notif);
      }
    };

    socket.on('notification:new', handleNewNotification);
    return () => {
      socket.off('notification:new', handleNewNotification);
    };
  }, [authUser]);

  useEffect(() => {
    if (authUser) loadData();
  }, [authUser, loadData]);

  // ─── Login handler ─────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !senha) return;

    setLoginLoading(true);
    setAuthError(null);
    try {
      const user = await login({ email, senha });
      setAuthUser(user);
      setToast({ message: 'Login realizado com sucesso!', type: 'success' });
    } catch (err) {
      const msg = err instanceof ApiError
        ? err.message
        : 'Erro de conexão. Verifique se o servidor está ativo.';
      setAuthError(msg);
      setToast({ message: msg, type: 'error' });
    } finally {
      setLoginLoading(false);
    }
  };

  // ─── Logout handler ────────────────────────────────────────────────────────
  const handleLogout = async () => {
    try { await apiLogout(); } catch { /* ignore */ }
    gmailLogout();
    setAuthUser(null);
    setShowTour(false);
    tourEvaluatedRef.current = false;
    setStudents([]);
    setActiveId(null);
    setGrades([]);
    setAttendance(null);
    setNotifications([]);
    setEmail('');
    setSenha('');
  };

  /**
   * Shortcut to logout and open the recovery modal as requested.
   */
  const handlePasswordRecoveryShortcut = async () => {
    await handleLogout();
    setShowForgotModal(true);
  };

  // ─── Notification handlers ─────────────────────────────────────────────────
  const handleMarkAsRead = async (id: string) => {
    if (!activeId) return;
    try {
      await marcarNotificacaoLida(id, activeId);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, lido: true } : n)));
    } catch (err) {
      console.error('Erro ao marcar notificação como lida:', err);
    }
  };

  const handleDeleteNotification = async (id: string) => {
    if (!activeId) return;
    try {
      await ocultarNotificacao(id, activeId);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      console.error('Erro ao ocultar notificação:', err);
    }
  };

  // ─── Auth loading spinner ──────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className={styles.fullscreenCenter} aria-live="polite" aria-busy="true">
        <span className={styles.spinner} aria-label="Verificando sessão…" />
        <p className={styles.loadingText}>Verificando sessão…</p>
      </div>
    );
  }

  // ─── Cadastro handler ────────────────────────────────────────────────────────
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setAuthError(null);
    try {
      const response = await fetch(`${cleanApiUrl}/api/auth/register-responsavel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(registerForm)
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao criar conta');
      
      setToast({ message: 'Conta criada com sucesso! Entrando...', type: 'success' });
      
      // Realiza o login automático imediatamente
      const user = await login({ email: registerForm.email, senha: registerForm.senha });
      setAuthUser(user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao criar conta.';
      setAuthError(msg);
      setToast({ message: msg, type: 'error' });
    } finally {
      setLoginLoading(false);
    }
  };

  // ─── Login screen ──────────────────────────────────────────────────────────
  if (!authUser) {
    return (
      <div className={styles.loginPage}>
        {/* Toast Notification */}
        {toast && (
          <div style={{
            position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
            padding: '12px 24px', borderRadius: '8px', color: '#fff',
            fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            background: toast.type === 'success' ? '#10b981' : '#ef4444',
            display: 'flex', alignItems: 'center', gap: '8px',
            animation: 'slideIn 0.3s ease-out'
          }}>
            <i className={`ti ${toast.type === 'success' ? 'ti-check' : 'ti-alert-circle'}`} />
            {toast.message}
            <button onClick={() => setToast(null)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: '12px' }}>×</button>
          </div>
        )}

        <div className={styles.loginCard}>
          <div className={styles.loginLogo}>
            <img src={schoolLogo} alt="Escola Jaguari Logo" />
          </div>
          <h1 className={styles.loginTitle}>Escola Jaguari</h1>
          <p className={styles.loginSubtitle}>Portal do Responsável</p>
          <p className={styles.loginDescription}>
            Acompanhe notas, frequência e comunicados do seu filho(a).
          </p>

          {(authError || gmailAuthError) && (
            <div className={styles.errorAlert} role="alert">
              <i className="ti ti-alert-circle" aria-hidden="true" />
              {authError || gmailAuthError}
            </div>
          )}

          {isRegistering ? (
            <form onSubmit={handleRegister} className={styles.loginForm} noValidate>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Nome Completo</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-user" aria-hidden="true" />
                  <input type="text" className={styles.formInput} placeholder="Seu nome"
                    value={registerForm.nome} onChange={(e) => setRegisterForm({ ...registerForm, nome: e.target.value })} required />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>E-mail</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-mail" aria-hidden="true" />
                  <input type="email" className={styles.formInput} placeholder="seu@email.com"
                    value={registerForm.email} onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })} required />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Senha</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-lock" aria-hidden="true" />
                  <input
                    type={showRegisterPassword ? 'text' : 'password'}
                    className={`${styles.formInput} ${styles.passwordInput}`}
                    placeholder="Crie uma senha forte"
                    value={registerForm.senha}
                    onChange={(e) => setRegisterForm({ ...registerForm, senha: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                    aria-label={showRegisterPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    <i className={`ti ${showRegisterPassword ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <button type="submit" className={styles.submitBtn} disabled={loginLoading}>
                {loginLoading ? 'Criando...' : 'Criar Conta'}
              </button>
              <div className={styles.divider}>
                <span>ou</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0', width: '100%' }}>
                <button
                  type="button"
                  className={styles.gmailBtn}
                  onClick={() => void handleGoogleLogin()}
                  disabled={loginLoading}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <img
                    src='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48px" height="48px"><path fill="%23fbc02d" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="%23e53935" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="%234caf50" d="M24,44c5.166,0,9.86-1.977,13.422-5.189l-6.19-5.158C29.255,34.908,26.74,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="%231565c0" d="M43.611,20.083L43.611,20.083L42,20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.158C36.914,39.112,44,34.429,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>'
                    alt="Google Logo"
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span>{loginLoading ? 'Conectando...' : 'Cadastrar com o Google'}</span>
                </button>
              </div>
              <div className={styles.registerSection}>
                <p>Já tem uma conta?</p>
                <button type="button" onClick={() => { setIsRegistering(false); setAuthError(null); }} className={styles.registerLink} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                  Fazer Login
                </button>
              </div>
            </form>
          ) : (
            <>
              <form onSubmit={handleLogin} className={styles.loginForm} noValidate>
                <div className={styles.formGroup}>
                  <label htmlFor="email" className={styles.formLabel}>
                    E-mail
                  </label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-mail" aria-hidden="true" />
                    <input
                      id="email"
                      type="email"
                      className={styles.formInput}
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      aria-label="E-mail do responsável"
                    />
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="senha" className={styles.formLabel}>
                    Senha
                  </label>
                  <div className={styles.inputWrapper}>
                    <i className="ti ti-lock" aria-hidden="true" />
                    <input
                      id="senha"
                      type={showPassword ? 'text' : 'password'}
                      className={`${styles.formInput} ${styles.passwordInput}`}
                      placeholder="••••••••"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      required
                      autoComplete="current-password"
                      aria-label="Senha"
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-8px', marginBottom: '16px' }}>
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(true)}
                    className={styles.registerLink}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Esqueceu a senha?
                  </button>
                </div>

                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={loginLoading}
                  aria-busy={loginLoading}
                >
                  {loginLoading ? (
                    <>
                      <span className={styles.spinnerSm} aria-hidden="true" />
                      Entrando…
                    </>
                  ) : (
                    <>
                      <i className="ti ti-login" aria-hidden="true" />
                      Entrar
                    </>
                  )}
                </button>
              </form>

              {/* Forgot Password Modal — rendered OUTSIDE the login form to prevent
                  Enter-key from submitting the login form and closing the modal */}
              {showForgotModal && (
                <div
                  style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999
                  }}
                  onClick={() => { setShowForgotModal(false); resetForgotModal(); }}
                >
                  <div
                    className={styles.loginCard}
                    style={{ maxWidth: '420px', width: '90%', padding: '28px', border: '1px solid rgba(255,255,255,0.08)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Wrap modal body in its own form to isolate Enter-key behavior */}
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      if (forgotStep === 1) handleForgotSendCode();
                      else if (forgotStep === 2) handleForgotVerifyCode();
                      else if (forgotStep === 3) handleForgotResetPassword();
                    }} noValidate>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <i className="ti ti-key" style={{ color: '#06b6d4' }} /> Recuperar Senha
                        </h3>
                        <button type="button" onClick={() => { setShowForgotModal(false); resetForgotModal(); }} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1.4rem' }}>&times;</button>
                      </div>

                      {/* Step Indicator */}
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '20px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: forgotStep >= 1 ? '#06b6d4' : 'rgba(255,255,255,0.1)' }} />
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: forgotStep >= 2 ? '#06b6d4' : 'rgba(255,255,255,0.1)' }} />
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: forgotStep >= 3 ? '#06b6d4' : 'rgba(255,255,255,0.1)' }} />
                      </div>

                      {/* Step 1: Request Code */}
                      {forgotStep === 1 && (
                        <div className={styles.loginForm}>
                          <p style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: '1.5', marginBottom: '20px' }}>
                            Informe seu e-mail cadastrado. Enviaremos um código de 6 dígitos para redefinir sua senha.
                          </p>
                          <div className={styles.formGroup} style={{ marginBottom: '24px' }}>
                            <label className={styles.formLabel}>E-mail</label>
                            <div className={styles.inputWrapper}>
                              <i className="ti ti-mail" aria-hidden="true" />
                              <input
                                type="email"
                                className={styles.formInput}
                                placeholder="seu@email.com"
                                value={forgotEmail}
                                onChange={(e) => setForgotEmail(e.target.value)}
                                autoFocus
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '12px' }}>
                            <button
                              type="button"
                              onClick={() => { setShowForgotModal(false); resetForgotModal(); }}
                              className={styles.gmailBtn}
                              style={{ flex: 1, margin: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                            >
                              Cancelar
                            </button>
                            <button
                              type="submit"
                              className={styles.submitBtn}
                              disabled={forgotLoading}
                              style={{ flex: 2, margin: 0 }}
                            >
                              {forgotLoading ? 'Enviando...' : 'Enviar Código'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Step 2: Verify Code */}
                      {forgotStep === 2 && (
                        <div className={styles.loginForm}>
                          <p style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: '1.5', marginBottom: '20px' }}>
                            Enviamos um código de recuperação para <strong>{forgotEmail}</strong>. Insira-o abaixo.
                          </p>
                          <div className={styles.formGroup} style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <label className={styles.formLabel} style={{ alignSelf: 'flex-start' }}>Código de 6 dígitos</label>
                            <input
                              type="text"
                              className={styles.formInput}
                              placeholder="000000"
                              value={forgotCode}
                              onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              maxLength={6}
                              style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '6px', maxWidth: '200px', fontWeight: 'bold' }}
                              autoFocus
                            />
                          </div>

                          <div style={{ textAlign: 'center', marginBottom: '16px', fontSize: '0.85rem' }}>
                            <p style={{ color: '#64748b', margin: '0 0 8px 0' }}>
                              <i className="ti ti-clock" /> Código válido por{' '}
                              <strong style={{ color: '#06b6d4' }}>
                                {Math.floor(codeCountdown / 60)}:{String(codeCountdown % 60).padStart(2, '0')}
                              </strong>
                            </p>
                            <div>
                              <span style={{ color: '#64748b' }}>Não recebeu? </span>
                              <button
                                type="button"
                                onClick={handleResendCode}
                                disabled={resendCountdown > 0 || forgotLoading}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: resendCountdown > 0 ? '#64748b' : '#06b6d4',
                                  textDecoration: 'underline',
                                  cursor: resendCountdown > 0 ? 'not-allowed' : 'pointer',
                                  padding: 0
                                }}
                              >
                                {resendCountdown > 0 ? `Reenviar em ${resendCountdown}s` : 'Reenviar Código'}
                              </button>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '12px' }}>
                            <button
                              type="button"
                              onClick={() => setForgotStep(1)}
                              className={styles.gmailBtn}
                              style={{ flex: 1, margin: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                            >
                              Voltar
                            </button>
                            <button
                              type="submit"
                              className={styles.submitBtn}
                              disabled={forgotLoading}
                              style={{ flex: 2, margin: 0 }}
                            >
                              {forgotLoading ? 'Verificando...' : 'Verificar Código'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Step 3: Reset Password */}
                      {forgotStep === 3 && (
                        <div className={styles.loginForm}>
                          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                            <i className="ti ti-circle-check" style={{ fontSize: '2rem', color: '#10b981' }} />
                            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '4px' }}>Código validado com sucesso!</p>
                          </div>

                          <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
                            <label className={styles.formLabel}>Nova Senha</label>
                            <div className={styles.inputWrapper}>
                              <i className="ti ti-lock" aria-hidden="true" />
                              <input
                                type={showNewPassword ? 'text' : 'password'}
                                className={styles.formInput}
                                placeholder="Mínimo 8 caracteres"
                                value={forgotNewPassword}
                                onChange={(e) => setForgotNewPassword(e.target.value)}
                                autoFocus
                              />
                              <button
                                type="button"
                                className={styles.passwordToggle}
                                onClick={() => setShowNewPassword(!showNewPassword)}
                              >
                                <i className={`ti ${showNewPassword ? 'ti-eye-off' : 'ti-eye'}`} aria-hidden="true" />
                              </button>
                            </div>
                          </div>

                          {/* Password Strength Progress Bar */}
                          {forgotNewPassword && (
                            <div style={{ marginBottom: '16px' }}>
                              <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                                <div
                                  style={{
                                    height: '100%',
                                    transition: 'all 0.3s',
                                    ...(() => {
                                      const str = getPasswordStrength(forgotNewPassword);
                                      return { width: str.width, backgroundColor: str.color };
                                    })()
                                  }}
                                />
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '0.75rem' }}>
                                <span style={{
                                  color: (() => {
                                    const str = getPasswordStrength(forgotNewPassword);
                                    return str.color;
                                  })()
                                }}>
                                  Força: {getPasswordStrength(forgotNewPassword).text}
                                </span>
                              </div>
                            </div>
                          )}

                          <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(6, 182, 212, 0.05)', borderRadius: '6px', fontSize: '0.75rem', color: '#94a3b8' }}>
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
                              <i className="ti ti-lock" aria-hidden="true" />
                              <input
                                type={showNewPassword ? 'text' : 'password'}
                                className={styles.formInput}
                                placeholder="••••••••"
                                value={forgotConfirmPassword}
                                onChange={(e) => setForgotConfirmPassword(e.target.value)}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '12px' }}>
                            <button
                              type="button"
                              onClick={() => setForgotStep(2)}
                              className={styles.gmailBtn}
                              style={{ flex: 1, margin: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                            >
                              Voltar
                            </button>
                            <button
                              type="submit"
                              className={styles.submitBtn}
                              disabled={forgotLoading}
                              style={{ flex: 2, margin: 0 }}
                            >
                              {forgotLoading ? 'Alterando...' : 'Alterar Senha'}
                            </button>
                          </div>
                        </div>
                      )}
                    </form>
                  </div>
                </div>
              )}

              <div className={styles.divider}>
                <span>ou</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0', width: '100%' }}>
                <button
                  type="button"
                  className={styles.gmailBtn}
                  onClick={() => void handleGoogleLogin()}
                  disabled={loginLoading}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <img
                    src='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48px" height="48px"><path fill="%23fbc02d" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="%23e53935" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="%234caf50" d="M24,44c5.166,0,9.86-1.977,13.422-5.189l-6.19-5.158C29.255,34.908,26.74,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="%231565c0" d="M43.611,20.083L43.611,20.083L42,20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.158C36.914,39.112,44,34.429,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>'
                    alt="Google Logo"
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span>{loginLoading ? 'Conectando...' : 'Entrar com o Google'}</span>
                </button>
              </div>

              <div className={styles.registerSection}>
                <p>Novo por aqui?</p>
                <button
                  type="button"
                  onClick={() => {
                    try { sessionStorage.setItem('primeiroAcessoTipo', 'responsavel'); } catch(e) {}
                    window.location.href = '/primeiro-acesso.html';
                  }}
                  className={styles.registerLink}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-block' }}
                >
                  Criar perfil
                </button>
              </div>
            </>
          )}

          <p className={styles.loginDisclaimer} style={{ marginTop: '24px' }}>
            Seus dados são protegidos pela LGPD. Apenas responsáveis cadastrados têm acesso.
          </p>
        </div>
      </div>
    );
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  const headerUser = toGmailUser(authUser, gmailUser);

  // If profile is incomplete according to the new LGPD flow
  // If profile is incomplete according to the new LGPD flow
  const isProfileIncomplete = authUser && authUser.profileCompleted === false;

  // If profile is incomplete, render the complete registration view
  if (authUser && isProfileIncomplete) {
    return (
      <div className={styles.portal}>
        <Header
          user={headerUser}
          notifications={notifications}
          onLogout={handleLogout}
          onBellClick={() => setShowNotifications((v) => !v)}
          onProfileClick={() => { }}
        />
        <CompletarCadastro
          user={authUser}
          onSuccess={(updatedUser) => {
            // Atualiza o usuário no estado local
            setAuthUser(updatedUser);
            // Reseta a ref do tour para garantir que ele seja re-avaliado no próximo render
            tourEvaluatedRef.current = false;
            setToast({ message: 'Cadastro completado com sucesso!', type: 'success' });
          }}
        />
      </div>
    );
  }

  // LGPD Check
  const lgpdAccepted = !!(authUser as any).consentimentoAceiteEm;

  const handleSignLgpd = async () => {
    try {
      const updated = await updateProfile({
        nome: authUser.nome || '',
        telefone: authUser.telefone || '',
        consentimentoAceiteEm: true
      });
      setAuthUser(updated);
      setToast({ message: 'Termo LGPD assinado com sucesso!', type: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Erro ao assinar LGPD.', type: 'error' });
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

  return (
    <div className={styles.portal}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          padding: '12px 24px', borderRadius: '8px', color: '#fff',
          fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          background: toast.type === 'success' ? '#10b981' : '#ef4444',
          display: 'flex', alignItems: 'center', gap: '8px',
          animation: 'slideIn 0.3s ease-out'
        }}>
          <i className={`ti ${toast.type === 'success' ? 'ti-check' : 'ti-alert-circle'}`} />
          {toast.message}
          <button onClick={() => setToast(null)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: '12px' }}>×</button>
        </div>
      )}

      <Header
        user={headerUser}
        notifications={notifications}
        onLogout={handleLogout}
        onBellClick={() => setShowNotificationsModal(true)}
        onProfileClick={() => setShowSidebar(true)}
      />

      <div className={styles.portalBody}>
        {/* Left Sidebar on Desktop */}
        <aside className={styles.desktopSidebar} data-tour="sidebar">
          <div className={styles.desktopSidebarUserCard} data-tour="profile">
            <div className={styles.desktopSidebarAvatar}>
              <span>{getInitials(authUser.nome)}</span>
            </div>
            <h4>{authUser.nome}</h4>
            <p>{authUser.email}</p>
          </div>

          {/* LGPD Consent Widget */}
          <div className={`${styles.lgpdConsentBox} ${lgpdAccepted ? styles.accepted : ''}`}>
            <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i className={lgpdAccepted ? "ti ti-shield-check" : "ti ti-shield-alert"} style={{ fontSize: '1.1rem' }} />
              Políticas de Privacidade
            </span>
            {lgpdAccepted ? (
              <span style={{ fontSize: '0.75rem' }}>✓ Termo LGPD assinado. Seus dados estão protegidos.</span>
            ) : (
              <>
                <span style={{ fontSize: '0.75rem' }}>Você ainda não assinou o consentimento de privacidade.</span>
                <button className={styles.btnSignLgpd} onClick={handleSignLgpd}>
                  Assinar LGPD
                </button>
              </>
            )}
          </div>

          {/* Navigation Links */}
          <nav className={styles.desktopSidebarNav} aria-label="Menu principal">
            <button
              onClick={() => setCurrentTab('dashboard')}
              className={`${styles.desktopSidebarNavLink} ${currentTab === 'dashboard' ? styles.active : ''}`}
            >
              <i className="ti ti-home" /> Painel Geral
            </button>
            <button
              onClick={() => setCurrentTab('linking')}
              className={`${styles.desktopSidebarNavLink} ${currentTab === 'linking' ? styles.active : ''}`}
            >
              <i className="ti ti-user-plus" /> Vincular meu Filho
            </button>
            <button
              onClick={() => setCurrentTab('profile')}
              className={`${styles.desktopSidebarNavLink} ${currentTab === 'profile' ? styles.active : ''}`}
            >
              <i className="ti ti-signature" /> {authUser?.consentimentoAceiteEm ? 'Alterar Cadastro / Termo LGPD' : 'Assinar Termo LGPD e Cadastro'}
            </button>
            <button
              onClick={handlePasswordRecoveryShortcut}
              className={styles.desktopSidebarNavLink}
            >
              <i className="ti ti-lock" /> Alterar Senha
            </button>
          </nav>

          <button className={styles.desktopSidebarLogoutBtn} onClick={handleLogout}>
            <i className="ti ti-logout" /> Sair da Conta
          </button>
        </aside>

        {/* Main Content Area */}
        <main className={styles.container} id="main-content" style={{ flex: 1, padding: '24px' }}>
          {currentTab === 'profile' && (
            <EditarPerfil
              user={authUser}
              activeStudent={activeStudent}
              onSuccess={(updated) => {
                setAuthUser(updated);
                loadData();
              }}
            />
          )}

          {currentTab === 'profile' && authUser && (
            <NotificationSettings 
              initialPrefs={authUser.notificacoesPreferencias || { portal: true, push: true, email: true }}
              onUpdate={(updatedPrefs) => {
                setAuthUser(prev => prev ? { ...prev, notificacoesPreferencias: updatedPrefs } : null);
              }}
            />
          )}

          {currentTab === 'linking' && (
            <VincularFilho
              onSuccess={() => {
                loadData();
                setCurrentTab('dashboard');
              }}
              onCancel={() => setCurrentTab('dashboard')}
              canCancel={true}
            />
          )}

          {currentTab === 'dashboard' && (
            <>
              {students.length === 0 ? (
                <div className={styles.emptyDashboardCard}>
                  <i className="ti ti-users" style={{ fontSize: '3.5rem', color: '#60a5fa', marginBottom: '16px' }} />
                  <h3>Nenhum aluno vinculado</h3>
                  <p style={{ margin: '8px 0 24px', color: '#94a3b8' }}>
                    Sua conta de responsável não possui nenhum aluno vinculado. Entre em contato com a secretaria/direção da escola para verificar seu cadastro.
                  </p>
                </div>
              ) : (
                <>
                  <div className={styles.topBarSelectors}>
                    <div className={styles.studentTabs}>
                      {students.map((s) => (
                        <button
                          key={s.id}
                          className={s.id === activeId ? styles.active : ''}
                          onClick={() => setActiveId(s.id)}
                        >
                          {s.nome} {s.sobrenome}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.pageHeader}>
                    <h1 className={styles.pageTitle}>
                      Olá, {authUser.nome.split(' ')[0]}! <span aria-hidden="true">👋</span>
                    </h1>
                    <p className={styles.pageSubtitle}>
                      {activeStudent ? (
                        <>Acompanhe o desempenho de <strong>{activeStudent.nome} {activeStudent.sobrenome}</strong></>
                      ) : (
                        'Carregando dados do aluno…'
                      )}
                    </p>
                  </div>

                  {/* Global data error */}
                  {dataError && (
                    <div className={styles.errorAlert} role="alert" style={{ marginBottom: '24px' }}>
                      <i className="ti ti-alert-circle" aria-hidden="true" />
                      {dataError}
                      <button
                        className={styles.retryBtn}
                        onClick={() => loadData()}
                        aria-label="Tentar novamente"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  )}

                  {/* Data loading spinner */}
                  {dataLoading ? (
                    <div className={styles.fullscreenCenter} style={{ minHeight: '300px' }} aria-busy="true">
                      <span className={styles.spinner} aria-label="Carregando dados…" />
                      <p className={styles.loadingText}>Buscando dados do banco de dados…</p>
                    </div>
                  ) : (
                      <>
                        {/* Top: student + notifications */}
                        <div className={styles.topGrid} data-tour="summary-cards">
                          {activeStudent && <StudentCard student={activeStudent} lgpdAccepted={lgpdAccepted} />}

                          <div data-tour="notifications">
                            {showNotifications || notifications.some((n) => !n.lido) ? (
                              <NotificationsPanel
                                notifications={notifications}
                                onMarkAsRead={handleMarkAsRead}
                                onDelete={handleDeleteNotification}
                              />
                            ) : (
                              <div className={styles.noNotifCard}>
                                <i className="ti ti-bell-off" aria-hidden="true" />
                                <p>Sem novas notificações</p>
                                <button
                                  className={styles.showAllBtn}
                                  onClick={() => setShowNotifications(true)}
                                  aria-label="Ver todas as notificações"
                                >
                                  Ver todas
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Middle: Announcement Feed and Academics */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                          <div className="lg:col-span-8 flex flex-col gap-8">
                            <AnnouncementFeed />
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                              <FrequencyCard attendance={attendance} loading={dataLoading} />
                              <NotesCard grades={grades} loading={dataLoading} />
                            </div>
                          </div>

                          <div className="lg:col-span-4">
                            {activeStudent && (
                              <FichaAluno
                                student={activeStudent}
                                onUpdate={(partial) => {
                                  setStudents(prev => prev.map(s => s.id === activeStudent.id ? { ...s, ...partial } : s));
                                }}
                              />
                            )}
                          </div>
                        </div>
                      </>
                  )}
                </>
              )}
            </>
          )}
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
        onLogout={handleLogout}
        onPasswordRecovery={handlePasswordRecoveryShortcut}
        onNavigate={setCurrentTab}
        onRestartTour={async () => {
          tourEvaluatedRef.current = false;
          await updateTutorial({ reiniciar: true });
          setAuthUser(u => u ? { ...u, tutorialResponsavelConcluido: false } : u);
          tourEvaluatedRef.current = true;
          setShowTour(true);
        }}
      />

      {showTour && authUser?.tutorialResponsavelConcluido !== true && (
        <OnboardingTour
          steps={RESPONSAVEL_TOUR_STEPS}
          onComplete={handleTourFinished}
          onSkip={handleTourFinished}
        />
      )}

      <NotificationsModal
        isOpen={showNotificationsModal}
        onClose={() => setShowNotificationsModal(false)}
        notifications={notifications}
        onMarkAsRead={handleMarkAsRead}
        onDelete={handleDeleteNotification}
      />

      {/* High Priority Notification Overlay */}
      {priorityNotification && (
        <div className={styles.priorityAlertOverlay}>
          <div className={styles.priorityAlertCard}>
            <div className={styles.priorityAlertHeader}>
              <i className="ti ti-alert-triangle" />
              <span>Comunicado Importante</span>
            </div>
            <h3 className={styles.priorityAlertTitle}>{priorityNotification.titulo}</h3>
            <p className={styles.priorityAlertBody}>{priorityNotification.mensagem}</p>
            <div className={styles.priorityAlertActions}>
              <button 
                className={styles.btnViewNow}
                onClick={() => {
                  setPriorityNotification(null);
                  setShowNotificationsModal(true);
                }}
              >
                Ver Detalhes
              </button>
              <button 
                className={styles.btnDismiss}
                onClick={() => setPriorityNotification(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalResponsavel;
