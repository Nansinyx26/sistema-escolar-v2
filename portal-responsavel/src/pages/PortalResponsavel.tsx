/**
 * pages/PortalResponsavel.tsx
 * Main page of the guardian portal.
 *
 * Authentication: e-mail + senha (same JWT cookie as the rest of the system).
 * Data: fetched from the real backend API (/api/responsavel/*).
 * Notifications: kept as mock until the school implements a notifications API.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useGmailAuth } from '../hooks/useGmailAuth';
import {
  login,
  mockGoogleLogin,
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
  // ── Auth state ─────────────────────────────────────────────────────────────
  const [authUser,  setAuthUser]  = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError,   setAuthError]   = useState<string | null>(null);

  // ── Gmail hook ─────────────────────────────────────────────────────────────
  const { loginWithGmail } = useGmailAuth();

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
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/auth/register-responsavel`, {
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

              <button
                className={styles.gmailBtn}
                onClick={async () => {
                  try {
                    await loginWithGmail();
                    const savedUserStr = localStorage.getItem('gmailUser');
                    if (savedUserStr) {
                      const gmailUserLocal = JSON.parse(savedUserStr);
                      const realAuthUser = await mockGoogleLogin(gmailUserLocal.email);
                      setAuthUser(realAuthUser);
                      setToast({ message: 'Login realizado com sucesso!', type: 'success' });
                    }
                  } catch (err) {
                    if (err instanceof Error && err.message === 'Login cancelado pelo usuário.') {
                      return;
                    }
                    const msg = 'Erro ao autenticar com Google (Mock API)';
                    setAuthError(msg);
                    setToast({ message: msg, type: 'error' });
                  }
                }}
                aria-label="Entrar com conta Gmail"
              >
                <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                Entrar com Gmail
              </button>

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
