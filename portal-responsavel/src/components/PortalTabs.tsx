import NotificationSettings from './NotificationSettings';
import EditarPerfil from './EditarPerfil';
import VincularFilho from './VincularFilho';
import type { Attendance, AuthUser, Grade, Notification, Student } from '../types';
import StudentCard from './StudentCard';
import NotificationsPanel from './NotificationsPanel';
import AnnouncementFeed from './AnnouncementFeed';
import FrequencyCard from './FrequencyCard';
import NotesCard from './NotesCard';
import FichaAluno from './FichaAluno';
import DashboardSkeleton from './DashboardSkeleton';
import styles from '../styles/portal.module.scss';

type PortalTab = 'dashboard' | 'ficha' | 'linking' | 'profile';

interface ProfileTabProps {
  authUser: AuthUser;
  activeStudent: Student | null;
  onUserUpdate: (user: AuthUser) => void;
}

export function ProfileTabSection({ authUser, activeStudent, onUserUpdate }: ProfileTabProps) {
  return (
    <>
      <EditarPerfil
        user={authUser}
        activeStudent={activeStudent}
        onSuccess={onUserUpdate}
      />
      <NotificationSettings
        initialPrefs={authUser.notificacoesPreferencias || { portal: true, push: true, email: true }}
        onUpdate={(updatedPrefs) => {
          onUserUpdate({ ...authUser, notificacoesPreferencias: updatedPrefs });
        }}
      />
    </>
  );
}

interface LinkingTabProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function LinkingTabSection({ onSuccess, onCancel }: LinkingTabProps) {
  return <VincularFilho onSuccess={onSuccess} onCancel={onCancel} canCancel={true} />;
}

interface DashboardTabProps {
  authUser: AuthUser;
  students: Student[];
  activeId: string | null;
  activeStudent: Student | null;
  lgpdAccepted: boolean;
  notifications: Notification[];
  showNotifications: boolean;
  dataLoading: boolean;
  detailsLoading: boolean;
  dataError: string | null;
  grades: Grade[];
  attendance: Attendance | null;
  onSelectStudent: (id: string) => void;
  onRetry: () => void;
  onShowAllNotifications: () => void;
  onMarkAsRead: (id: string) => void;
  onDeleteNotification: (id: string) => void;
  onStudentUpdate: (studentId: string, partial: Partial<Student>) => void;
}

export function DashboardTabSection({
  authUser,
  students,
  activeId,
  activeStudent,
  lgpdAccepted,
  notifications,
  showNotifications,
  dataLoading,
  detailsLoading,
  dataError,
  grades,
  attendance,
  onSelectStudent,
  onRetry,
  onShowAllNotifications,
  onMarkAsRead,
  onDeleteNotification,
}: DashboardTabProps) {
  if (students.length === 0) {
    return (
      <div className={styles.emptyDashboardCard}>
        <i className="ti ti-users" style={{ fontSize: '3.5rem', color: '#60a5fa', marginBottom: '16px' }} />
        <h3>Nenhum aluno vinculado</h3>
        <p style={{ margin: '8px 0 24px', color: '#94a3b8' }}>
          Sua conta de responsável não possui nenhum aluno vinculado. Entre em contato com a secretaria/direção da escola para verificar seu cadastro.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className={styles.topBarSelectors}>
        <div className={styles.studentTabs}>
          {students.map((student) => (
            <button
              key={student.id}
              className={student.id === activeId ? styles.active : ''}
              onClick={() => onSelectStudent(student.id)}
            >
              {student.nome} {student.sobrenome}
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

      {/* Atalhos diretos às informações-chave (rolagem suave até a seção) */}
      <nav className={styles.quickNav} aria-label="Ir direto para">
        {[
          { id: 'sec-notas', icon: 'ti-notebook', label: 'Notas' },
          { id: 'sec-frequencia', icon: 'ti-calendar-check', label: 'Frequência' },
          { id: 'sec-comunicados', icon: 'ti-speakerphone', label: 'Comunicados' },
        ].map((atalho) => (
          <button
            key={atalho.id}
            type="button"
            onClick={() => document.getElementById(atalho.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <i className={`ti ${atalho.icon}`} aria-hidden="true" /> {atalho.label}
          </button>
        ))}
      </nav>

      {dataError && (
        <div className={styles.errorAlert} role="alert" style={{ marginBottom: '24px' }}>
          <i className="ti ti-alert-circle" aria-hidden="true" />
          {dataError}
          <button className={styles.retryBtn} onClick={onRetry} aria-label="Tentar novamente">
            Tentar novamente
          </button>
        </div>
      )}

      {dataLoading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className={styles.topGrid} data-tour="summary-cards">
            {activeStudent && <StudentCard student={activeStudent} lgpdAccepted={lgpdAccepted} />}

            <div data-tour="notifications">
              {showNotifications || notifications.some((notification) => !notification.lido) ? (
                <NotificationsPanel
                  notifications={notifications}
                  onMarkAsRead={onMarkAsRead}
                  onDelete={onDeleteNotification}
                />
              ) : (
                <div className={styles.noNotifCard}>
                  <i className="ti ti-bell-off" aria-hidden="true" />
                  <p>Sem novas notificações</p>
                  <button
                    className={styles.showAllBtn}
                    onClick={onShowAllNotifications}
                    aria-label="Ver todas as notificações"
                  >
                    Ver todas
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className={styles.comunicadosMainCol}>
            <section id="sec-comunicados" aria-label="Comunicados">
              <AnnouncementFeed />
            </section>

            <div className={styles.cardsGrid}>
              {detailsLoading ? (
                <>
                  <div className={`${styles.skeleton} ${styles.skeletonCardMd}`} aria-busy="true" />
                  <div className={`${styles.skeleton} ${styles.skeletonCardMd}`} aria-busy="true" />
                </>
              ) : (
                <>
                  <section id="sec-frequencia" aria-label="Frequência">
                    <FrequencyCard attendance={attendance ?? { presenca: 0, ausencia: 0, atraso: 0, percentual: 0 }} />
                  </section>
                  <section id="sec-notas" aria-label="Notas">
                    <NotesCard grades={grades} />
                  </section>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

interface FichaTabProps {
  activeStudent: Student | null;
  students: Student[];
  activeId: string | null;
  onSelectStudent: (id: string) => void;
  onStudentUpdate: (studentId: string, partial: Partial<Student>) => void;
}

/** Aba dedicada: Ficha & Autorizações do aluno (movida da coluna lateral). */
export function FichaTabSection({ activeStudent, students, activeId, onSelectStudent, onStudentUpdate }: FichaTabProps) {
  if (!activeStudent) {
    return (
      <div className={styles.emptyDashboardCard}>
        <i className="ti ti-clipboard-list" style={{ fontSize: '3rem', color: '#10b981', marginBottom: '12px' }} />
        <h3>Nenhum aluno selecionado</h3>
        <p style={{ margin: '8px 0', color: '#94a3b8' }}>
          Vincule um aluno à sua conta para preencher a ficha e as autorizações escolares.
        </p>
      </div>
    );
  }

  return (
    <>
      {students.length > 1 && (
        <div className={styles.topBarSelectors}>
          <div className={styles.studentTabs}>
            {students.map((student) => (
              <button
                key={student.id}
                className={student.id === activeId ? styles.active : ''}
                onClick={() => onSelectStudent(student.id)}
              >
                {student.nome} {student.sobrenome}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Ficha &amp; Autorizações</h1>
        <p className={styles.pageSubtitle}>
          Dados, autorizações escolares e documento assinado de <strong>{activeStudent.nome} {activeStudent.sobrenome}</strong>
        </p>
      </div>

      <div className={styles.fichaWrapper}>
        <FichaAluno
          student={activeStudent}
          onUpdate={(partial) => onStudentUpdate(activeStudent.id, partial)}
        />
      </div>
    </>
  );
}

interface PortalTabContentProps {
  currentTab: PortalTab;
  authUser: AuthUser;
  activeStudent: Student | null;
  students: Student[];
  activeId: string | null;
  lgpdAccepted: boolean;
  notifications: Notification[];
  showNotifications: boolean;
  dataLoading: boolean;
  detailsLoading: boolean;
  dataError: string | null;
  grades: Grade[];
  attendance: Attendance | null;
  onUserUpdate: (user: AuthUser) => void;
  onLinkingSuccess: () => void;
  onLinkingCancel: () => void;
  onSelectStudent: (id: string) => void;
  onRetry: () => void;
  onShowAllNotifications: () => void;
  onMarkAsRead: (id: string) => void;
  onDeleteNotification: (id: string) => void;
  onStudentUpdate: (studentId: string, partial: Partial<Student>) => void;
}

export function PortalTabContent(props: PortalTabContentProps) {
  const {
    currentTab,
    authUser,
    activeStudent,
    onUserUpdate,
    onLinkingSuccess,
    onLinkingCancel,
  } = props;

  if (currentTab === 'profile') {
    return <ProfileTabSection authUser={authUser} activeStudent={activeStudent} onUserUpdate={onUserUpdate} />;
  }

  if (currentTab === 'linking') {
    return <LinkingTabSection onSuccess={onLinkingSuccess} onCancel={onLinkingCancel} />;
  }

  if (currentTab === 'ficha') {
    return (
      <FichaTabSection
        activeStudent={activeStudent}
        students={props.students}
        activeId={props.activeId}
        onSelectStudent={props.onSelectStudent}
        onStudentUpdate={props.onStudentUpdate}
      />
    );
  }

  return <DashboardTabSection {...props} />;
}