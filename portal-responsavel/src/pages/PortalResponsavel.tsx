/**
 * pages/PortalResponsavel.tsx
 * Main page of the guardian portal.
 *
 * Authentication: e-mail + senha (same JWT cookie as the rest of the system).
 * Data: fetched from the real backend API (/api/responsavel/*).
 * Notifications: kept as mock until the school implements a notifications API.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import {
  login,
  logout as apiLogout,
  getMe,
  getAlunosDoResponsavel,
  getNotasDoAluno,
  getFrequenciaDoAluno,
  getNotificacoesDoAluno,
  ApiError,
  type AuthUser,
} from '../services/apiService';
import Header from '../components/Header';
import StudentCard from '../components/StudentCard';
import NotesCard from '../components/NotesCard';
import FrequencyCard from '../components/FrequencyCard';
import NotificationsPanel from '../components/NotificationsPanel';
import VincularFilho from '../components/VincularFilho';
import CompletarCadastro from '../components/CompletarCadastro';
import type { Student, Grade, Attendance, Notification, GmailUser } from '../types';
import styles from '../styles/portal.module.scss';

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Convert backend AuthUser to the GmailUser shape the Header expects. */
function toGmailUser(u: AuthUser): GmailUser {
  return {
    email:       u.email,
    name:        u.nome,
    picture:     '',
    accessToken: '',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
const PortalResponsavel: React.FC = () => {
  const isLocal = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const rawApiUrl = isLocal 
    ? (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
    : `${window.location.origin}/api`;
  const cleanApiUrl = rawApiUrl.replace(/\/api$/, '');

  // ── Auth state ─────────────────────────────────────────────────────────────
  const [authUser,  setAuthUser]  = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError,   setAuthError]   = useState<string | null>(null);

  // ── Login form ─────────────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // ── Data state ─────────────────────────────────────────────────────────────
  const [students,   setStudents]   = useState<Student[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Auth UI states
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerForm, setRegisterForm] = useState({ nome: '', email: '', senha: '', cpf: '', telefone: '' });
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  // Check initial session
  const [isLinking,  setIsLinking]  = useState(false);
  
  const activeStudent = students.find(s => s.id === activeId) || null;

  const [grades,     setGrades]     = useState<Grade[]>([]);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError,   setDataError]   = useState<string | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);

  // Real Google login callback using useGoogleLogin hook
  const handleGoogleLoginSuccess = async (tokenResponse: any) => {
    try {
      setLoginLoading(true);
      setAuthError(null);
      
      const response = await fetch(`${cleanApiUrl}/api/auth/google-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenResponse.access_token })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Erro no login Google');
      
      setAuthUser(data.user);
      setToast({ message: 'Login Google realizado com sucesso!', type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha na autenticação Google';
      setAuthError(msg);
      setToast({ message: msg, type: 'error' });
    } finally {
      setLoginLoading(false);
    }
  };

  const loginWithGoogle = useGoogleLogin({
    onSuccess: handleGoogleLoginSuccess,
    onError: () => {
      setAuthError('O login com Google falhou');
      setToast({ message: 'O login com Google falhou', type: 'error' });
    }
  });

  // ─── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    getMe()
      .then((u) => setAuthUser(u))
      .catch(() => { /* not logged in */ })
      .finally(() => setAuthLoading(false));
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

    return () => { isMounted = false; };
  }, [activeId]);

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
    setAuthUser(null);
    setStudents([]);
    setActiveId(null);
    setGrades([]);
    setAttendance(null);
    setNotifications([]);
    setEmail('');
    setSenha('');
  };

  // ─── Notification handlers ─────────────────────────────────────────────────
  const handleMarkAsRead = async (id: string) => {
    // Optionally hit backend to mark as read here (e.g. POST /api/notificacoes/:id/read)
    // For now we just update state locally to clear the 'NOVA' badge
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, lido: true } : n)));
  };

  const handleDeleteNotification = async (id: string) => {
    // Optionally hit backend to delete/hide it for the user
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, lido: true } : n)));
    // We keep it in the list but marked as read, or actually remove it from UI:
    setNotifications((prev) => prev.filter((n) => n.id !== id));
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
        body: JSON.stringify(registerForm)
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao criar conta');
      
      setToast({ message: 'Conta criada com sucesso! Você já pode fazer login.', type: 'success' });
      setIsRegistering(false); // Volta para a tela de login
      setEmail(registerForm.email); // Preenche o e-mail para o usuário
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
            <button onClick={() => setToast(null)} style={{background:'transparent', border:'none', color:'#fff', cursor:'pointer', marginLeft:'12px'}}>×</button>
          </div>
        )}

        <div className={styles.loginCard}>
          <div className={styles.loginLogo}>
            <i className="ti ti-school" aria-hidden="true" />
          </div>
          <h1 className={styles.loginTitle}>Escola Jaguari</h1>
          <p className={styles.loginSubtitle}>Portal do Responsável</p>
          <p className={styles.loginDescription}>
            Acompanhe notas, frequência e comunicados do seu filho(a).
          </p>

          {authError && (
            <div className={styles.errorAlert} role="alert">
              <i className="ti ti-alert-circle" aria-hidden="true" />
              {authError}
            </div>
          )}

          {isRegistering ? (
            <form onSubmit={handleRegister} className={styles.loginForm} noValidate>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Nome Completo</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-user" aria-hidden="true" />
                  <input type="text" className={styles.formInput} placeholder="Seu nome"
                    value={registerForm.nome} onChange={(e) => setRegisterForm({...registerForm, nome: e.target.value})} required />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>E-mail</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-mail" aria-hidden="true" />
                  <input type="email" className={styles.formInput} placeholder="seu@email.com"
                    value={registerForm.email} onChange={(e) => setRegisterForm({...registerForm, email: e.target.value})} required />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Senha</label>
                <div className={styles.inputWrapper}>
                  <i className="ti ti-lock" aria-hidden="true" />
                  <input type="password" className={styles.formInput} placeholder="Crie uma senha forte"
                    value={registerForm.senha} onChange={(e) => setRegisterForm({...registerForm, senha: e.target.value})} required />
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
                  onClick={() => loginWithGoogle()}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <img
                    src='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48px" height="48px"><path fill="%23fbc02d" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="%23e53935" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="%234caf50" d="M24,44c5.166,0,9.86-1.977,13.422-5.189l-6.19-5.158C29.255,34.908,26.74,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="%231565c0" d="M43.611,20.083L43.611,20.083L42,20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.158C36.914,39.112,44,34.429,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>'
                    alt="Google Logo"
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span>Cadastrar com o Google</span>
                </button>
              </div>
              <div className={styles.registerSection}>
                <p>Já tem uma conta?</p>
                <button type="button" onClick={() => { setIsRegistering(false); setAuthError(null); }} className={styles.registerLink} style={{background: 'none', border: 'none', padding: 0, cursor: 'pointer'}}>
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
                      type="password"
                      className={styles.formInput}
                      placeholder="••••••••"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      required
                      autoComplete="current-password"
                      aria-label="Senha"
                    />
                  </div>
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

              <div className={styles.divider}>
                <span>ou</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0', width: '100%' }}>
                <button
                  type="button"
                  className={styles.gmailBtn}
                  onClick={() => loginWithGoogle()}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <img
                    src='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48px" height="48px"><path fill="%23fbc02d" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="%23e53935" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="%234caf50" d="M24,44c5.166,0,9.86-1.977,13.422-5.189l-6.19-5.158C29.255,34.908,26.74,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="%231565c0" d="M43.611,20.083L43.611,20.083L42,20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.158C36.914,39.112,44,34.429,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>'
                    alt="Google Logo"
                    style={{ width: '18px', height: '18px' }}
                  />
                  <span>Entrar com o Google</span>
                </button>
              </div>

              <div className={styles.registerSection}>
                <p>Novo por aqui?</p>
                <button 
                  type="button" 
                  onClick={() => setIsRegistering(true)} 
                  className={styles.registerLink}
                  style={{background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-block'}}
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
  const gmailUser = toGmailUser(authUser);

  // Check if profile details are incomplete
  const isProfileIncomplete = authUser && (
    !authUser.cpf ||
    authUser.cpf.startsWith('temp_cpf') ||
    authUser.cpf === '000.000.000-00' ||
    !authUser.telefone ||
    authUser.telefone === '(00) 00000-0000'
  );

  // If profile is incomplete, render the complete registration view
  if (authUser && isProfileIncomplete) {
    return (
      <div className={styles.portal}>
        <Header 
          user={gmailUser} 
          notifications={notifications}
          onLogout={handleLogout} 
          onBellClick={() => setShowNotifications((v) => !v)}
        />
        <CompletarCadastro 
          user={authUser}
          onSuccess={(updatedUser) => {
            setAuthUser(updatedUser);
            setToast({ message: 'Cadastro completado com sucesso!', type: 'success' });
          }}
        />
      </div>
    );
  }

  // ─── Link child screen ───────────────────────────────────────────────────
  if (students.length === 0 || isLinking) {
    return (
      <div className={styles.portal}>
        <Header 
          user={gmailUser} 
          notifications={notifications}
          onLogout={handleLogout} 
          onBellClick={() => setShowNotifications((v) => !v)}
        />
        <VincularFilho 
          onSuccess={() => {
            setIsLinking(false);
            if (authUser) loadData();
          }} 
          canCancel={students.length > 0}
          onCancel={() => setIsLinking(false)}
        />
      </div>
    );
  }

  // LGPD Check
  const lgpdAccepted = !!(authUser as any).consentimentoAceiteEm;

  return (
    <div className={styles.portal}>
      <Header
        user={gmailUser}
        notifications={notifications}
        onLogout={handleLogout}
        onBellClick={() => setShowNotifications((v) => !v)}
      />

      <main className={styles.container} id="main-content">
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
          <button className={styles.btnAddChild} onClick={() => setIsLinking(true)}>
            <i className="ti ti-plus" /> Adicionar outro filho
          </button>
        </div>

        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>
            Olá, {authUser.nome.split(' ')[0]}! <span aria-hidden="true">👋</span>
          </h1>
          <p className={styles.pageSubtitle}>
            {activeStudent
              ? <>Acompanhe o desempenho de <strong>{activeStudent.nome} {activeStudent.sobrenome}</strong></>
              : 'Carregando dados do aluno…'}
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
            <div className={styles.topGrid}>
              {activeStudent && <StudentCard student={activeStudent} lgpdAccepted={lgpdAccepted} />}

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

            {/* Bottom: grades + attendance */}
            <div className={styles.cardsGrid}>
              <NotesCard grades={grades} />
              {attendance && <FrequencyCard attendance={attendance} />}
            </div>
          </>
        )}
      </main>

      <footer className={styles.footer}>
        <p>
          © {new Date().getFullYear()} Escola Jaguari — Portal do Responsável |{' '}
          <a href="/politica-privacidade.html" target="_blank" rel="noreferrer">
            Política de Privacidade
          </a>
        </p>
      </footer>
    </div>
  );
};

export default PortalResponsavel;
