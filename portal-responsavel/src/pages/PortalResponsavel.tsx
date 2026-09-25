import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import ChatbotIA from '../components/ChatbotIA';
import CompletarCadastro from '../components/CompletarCadastro';
import ConfirmeSeuEmail from '../components/ConfirmeSeuEmail';
import Header from '../components/Header';
import LgpdConsentWidget from '../components/LgpdConsentWidget';
import LoginResponsavel from '../components/LoginResponsavel';
import NotificationsModal from '../components/NotificationsModal';
import PortalOnboardingManager from '../components/PortalOnboardingManager';
import { PortalTabContent } from '../components/PortalTabs';
import ProfileSidebar from '../components/ProfileSidebar';
import Toast from '../components/Toast';
import Icon from '../components/ui/Icon';
import { useAuth } from '../hooks/useAuth';
import { useNotifications } from '../hooks/useNotifications';
import {
  ApiError,
  getAlunosDoResponsavel,
  getFrequenciaDoAluno,
  getNotasDoAluno,
  updateProfile,
  updateTutorial,
} from '../services/apiService';
import styles from '../styles/portal.module.scss';
import type { Attendance, AuthUser, GmailUser, Grade, Student } from '../types';

function toGmailUser(u: AuthUser, googleProfile?: GmailUser | null): GmailUser {
  return {
    email: u.email,
    name: u.nome,
    picture: u.foto || googleProfile?.picture || u.fotoGoogle || '',
  };
}

type PortalTab = 'dashboard' | 'ficha' | 'linking' | 'profile' | 'privacidade';

/** Itens da sidebar, na ordem da referência visual (Issue #436). */
const NAV_ITEMS: { tab: PortalTab; label: string; icon: string }[] = [
  { tab: 'dashboard', label: 'Painel Geral', icon: 'home' },
  { tab: 'ficha', label: 'Ficha e Autorizações', icon: 'clipboard-list' },
  { tab: 'linking', label: 'Vincular meu Filho', icon: 'link' },
];

const PortalResponsavel: React.FC = () => {
  const rawApiUrl = import.meta.env.DEV
    ? import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
    : '/api';
  const cleanApiUrl = rawApiUrl.replace(/\/api$/, '');

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const auth = useAuth({ cleanApiUrl, onToast: setToast });
  const { authUser, setAuthUser, authLoading, setShowForgotModal, gmailUser, handleLogout } = auth;

  const [students, setStudents] = useState<Student[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<PortalTab>('dashboard');
  const [showSidebar, setShowSidebar] = useState(false);
  // Gaveta de navegação no celular (no desktop a sidebar fica sempre visível)
  const [showNav, setShowNav] = useState(false);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [emailNaoConfirmado, setEmailNaoConfirmado] = useState(false);

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

  const goTo = (tab: PortalTab) => {
    setCurrentTab(tab);
    setShowNav(false);
  };

  // Esc fecha a gaveta de navegação do celular
  useEffect(() => {
    if (!showNav) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNav(false);
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [showNav]);

  const loadData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    setEmailNaoConfirmado(false);
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
      // Issue #412: enquanto o e-mail do cadastro não for confirmado, o
      // servidor não entrega dado de aluno — e a tela explica o porquê em vez
      // de mostrar "erro ao carregar".
      if (err instanceof ApiError && err.codigo === 'EMAIL_NAO_VERIFICADO') {
        setEmailNaoConfirmado(true);
        setStudents([]);
        setDataError(null);
        return;
      }
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
        <span className={styles.spinner} aria-hidden="true" />
        <p className={styles.loadingText}>Verificando sessão…</p>
      </div>
    );
  }

  if (!authUser) {
    return <LoginResponsavel auth={auth} toast={toast} onCloseToast={() => setToast(null)} />;
  }

  const headerUser = toGmailUser(authUser, gmailUser);
  const isProfileIncomplete = authUser.profileCompleted === false;

  if (isProfileIncomplete) {
    return (
      <div className={styles.portal}>
        <Header
          user={headerUser}
          notifications={notifications}
          onLogout={handleLogout}
          onBellClick={() => setShowNotifications((value) => !value)}
          onProfileClick={() => {}}
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

  const lgpdAccepted = !!authUser.consentimentoAceiteEm;

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
      setToast({
        message: err instanceof Error ? err.message : 'Erro ao assinar LGPD.',
        type: 'error',
      });
    }
  };

  return (
    <div className={styles.portal}>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <Header
        user={headerUser}
        notifications={notifications}
        onLogout={handleLogout}
        onBellClick={() => setShowNotificationsModal(true)}
        onProfileClick={() => setShowSidebar(true)}
        onMenuClick={() => setShowNav((aberto) => !aberto)}
        activeTab={currentTab}
      />

      <div className={styles.portalBody}>
        {/* Fundo da gaveta no celular: fecha ao tocar fora */}
        {showNav && (
          <button
            type="button"
            className={styles.sidebarBackdrop}
            onClick={() => setShowNav(false)}
            aria-label="Fechar menu de navegação"
            tabIndex={-1}
          />
        )}

        <aside
          id="portal-sidebar"
          className={`${styles.desktopSidebar} ${showNav ? styles.sidebarOpen : ''}`}
          data-tour="sidebar"
          aria-label="Navegação do portal"
        >
          <nav className={styles.desktopSidebarNav} aria-label="Menu principal">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.tab}
                type="button"
                onClick={() => goTo(item.tab)}
                aria-current={currentTab === item.tab ? 'page' : undefined}
                className={`${styles.desktopSidebarNavLink} ${currentTab === item.tab ? styles.active : ''}`}
              >
                <Icon name={item.icon} aria-hidden="true" /> {item.label}
              </button>
            ))}
          </nav>

          <LgpdConsentWidget
            accepted={lgpdAccepted}
            onSign={handleSignLgpd}
            onOpen={() => goTo(lgpdAccepted ? 'privacidade' : 'profile')}
          />
        </aside>

        <main className={`${styles.container} ${styles.portalMain}`} id="main-content">
          {emailNaoConfirmado ? (
            <ConfirmeSeuEmail email={authUser?.email} onTentarNovamente={() => void loadData()} />
          ) : (
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
                onNavigate={setCurrentTab}
                onSelectStudent={setActiveId}
                onRetry={() => void loadData()}
                onShowAllNotifications={() => setShowNotifications(true)}
                onMarkAsRead={(id) => void handleMarkAsRead(id)}
                onDeleteNotification={(id) => void handleDeleteNotification(id)}
                onStudentUpdate={(studentId, partial) => {
                  setStudents((prev) =>
                    prev.map((student) =>
                      student.id === studentId ? { ...student, ...partial } : student
                    )
                  );
                }}
              />
            </div>
          )}
        </main>
      </div>

      {/* Barra de navegação inferior (Mobile Bottom Navigation Bar) */}
      <nav className={styles.mobileBottomNav} aria-label="Navegação móvel">
        <button
          type="button"
          className={`${styles.bottomNavItem} ${currentTab === 'dashboard' ? styles.active : ''}`}
          onClick={() => setCurrentTab('dashboard')}
          aria-label="Ir para o Painel Geral"
        >
          <Icon name="home" aria-hidden="true" />
          <span>Início</span>
        </button>

        <button
          type="button"
          className={`${styles.bottomNavItem} ${currentTab === 'ficha' ? styles.active : ''}`}
          onClick={() => setCurrentTab('ficha')}
          aria-label="Ir para Ficha e Autorizações"
        >
          <Icon name="clipboard-list" aria-hidden="true" />
          <span>Ficha</span>
        </button>

        <button
          type="button"
          className={styles.bottomNavItem}
          onClick={() => setShowNotificationsModal(true)}
          aria-label="Ver avisos e comunicados"
        >
          <div className={styles.bottomNavIconWrapper}>
            <Icon name="bell-filled" aria-hidden="true" />
            {notifications.filter((n) => !n.lido).length > 0 && (
              <span className={styles.bottomNavBadge} aria-hidden="true">
                {notifications.filter((n) => !n.lido).length > 9
                  ? '9+'
                  : notifications.filter((n) => !n.lido).length}
              </span>
            )}
          </div>
          <span>Avisos</span>
        </button>

        <button
          type="button"
          className={`${styles.bottomNavItem} ${showSidebar ? styles.active : ''}`}
          onClick={() => setShowSidebar(true)}
          aria-label="Abrir menu de opções e perfil"
        >
          <Icon name="menu" aria-hidden="true" />
          <span>Mais</span>
        </button>
      </nav>

      <footer className={styles.footer}>
        <p>
          © {new Date().getFullYear()} Escola Jaguari — Portal do Responsável |{' '}
          <button
            type="button"
            className={styles.footerLinkBtn}
            onClick={() => setCurrentTab('privacidade')}
          >
            Política de Privacidade
          </button>
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
              <button
                type="button"
                className={styles.btnViewNow}
                onClick={() => {
                  setPriorityNotification(null);
                  setShowNotificationsModal(true);
                }}
              >
                Ver Detalhes
              </button>
              <button
                type="button"
                className={styles.btnDismiss}
                onClick={() => setPriorityNotification(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sem `alunoId`: o copiloto resolve o vínculo pela sessão no servidor. */}
      <ChatbotIA />
    </div>
  );
};

export default PortalResponsavel;
