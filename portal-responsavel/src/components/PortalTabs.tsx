/**
 * components/PortalTabs.tsx
 * Gerencia as seções e abas do Portal do Responsável.
 * O Painel Geral (DashboardTabSection) foi reformulado com abordagem mobile-first:
 * - Seletor ágil de múltiplos filhos no topo (pills com foto e turma)
 * - Eliminação de ruídos (banner de lousa decorativo removido, links duplicados removidos)
 * - Raio-X do aluno imediato (Frequência em 360px + Card do Aluno)
 * - Abas acessíveis WAI-ARIA (Boletim, Frequência Detalhada e Comunicados Oficiais)
 * - Suporte de atendimento discreto no rodapé ("Falar com a escola")
 */

import { useState } from 'react';
import styles from '../styles/portal.module.scss';
import type { Attendance, AuthUser, Grade, Notification, Student } from '../types';
import AnnouncementFeed from './AnnouncementFeed';
import DashboardSkeleton from './DashboardSkeleton';
import EditarPerfil from './EditarPerfil';
import FichaAluno from './FichaAluno';
import FrequencyCard from './FrequencyCard';
import NotesCard from './NotesCard';
import NotificationSettings from './NotificationSettings';
import NotificationsPanel from './NotificationsPanel';
import PoliticaPrivacidade from './PoliticaPrivacidade';
import StudentCard from './StudentCard';
import Icon from './ui/Icon';
import VincularFilho from './VincularFilho';

type PortalTab = 'dashboard' | 'ficha' | 'linking' | 'profile' | 'privacidade';
type DashboardSubTab = 'boletim' | 'frequencia' | 'comunicados';

interface ProfileTabProps {
  authUser: AuthUser;
  activeStudent: Student | null;
  onUserUpdate: (user: AuthUser) => void;
}

export function ProfileTabSection({ authUser, activeStudent, onUserUpdate }: ProfileTabProps) {
  return (
    <>
      <EditarPerfil user={authUser} activeStudent={activeStudent} onSuccess={onUserUpdate} />
      <NotificationSettings
        initialPrefs={
          authUser.notificacoesPreferencias || { portal: true, push: true, email: true }
        }
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
  onNavigate?: (tab: PortalTab) => void;
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
  onShowAllNotifications: _onShowAllNotifications,
  onMarkAsRead,
  onDeleteNotification,
  onNavigate,
}: DashboardTabProps) {
  // Aba interna do Dashboard (Boletim, Frequência ou Comunicados)
  const [activeSubTab, setActiveSubTab] = useState<DashboardSubTab>('boletim');

  if (students.length === 0) {
    return (
      <div className={styles.emptyDashboardCard}>
        <Icon name="users" style={{ fontSize: '3.5rem', color: '#60a5fa', marginBottom: '16px' }} />
        <h3>Nenhum aluno vinculado</h3>
        <p style={{ margin: '8px 0 24px', color: '#94a3b8' }}>
          Sua conta de responsável não possui nenhum aluno vinculado. Entre em contato com a
          secretaria/direção da escola para verificar seu cadastro.
        </p>
        {onNavigate && (
          <button
            type="button"
            className={styles.submitBtn}
            style={{ maxWidth: '280px', margin: '0 auto' }}
            onClick={() => onNavigate('linking')}
          >
            <Icon name="user-plus" /> Vincular meu Filho
          </button>
        )}
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.lido).length;
  const firstName = authUser.nome ? authUser.nome.trim().split(' ')[0] : 'Responsável';

  return (
    <>
      {/* 1. SELETOR DE ALUNOS (Múltiplos Filhos) */}
      <section className={styles.studentSelectorSection} aria-label="Seletor de aluno">
        <div className={styles.studentTabsList}>
          {students.map((student) => {
            const isSelected = student.id === activeId;
            return (
              <button
                type="button"
                key={student.id}
                role="tab"
                aria-selected={isSelected}
                className={`${styles.studentPill} ${isSelected ? styles.active : ''}`}
                onClick={() => onSelectStudent(student.id)}
              >
                <div className={styles.studentPillAvatar} aria-hidden="true">
                  {student.foto && student.foto !== 'null' ? (
                    <img src={student.foto} alt="" />
                  ) : (
                    <span>{(student.nome?.[0] || 'A').toUpperCase()}</span>
                  )}
                </div>
                <div className={styles.studentPillText}>
                  <span className={styles.studentPillName}>
                    {student.nome} {student.sobrenome}
                  </span>
                  <span className={styles.studentPillTurma}>
                    {student.turma || 'Turma em definição'}
                  </span>
                </div>
                {isSelected && (
                  <span className={styles.studentPillIndicator} aria-hidden="true">
                    <Icon name="circle-check-filled" />
                  </span>
                )}
              </button>
            );
          })}

          {onNavigate && (
            <button
              type="button"
              className={styles.studentAddPill}
              onClick={() => onNavigate('linking')}
              aria-label="Vincular outro filho à conta"
            >
              <Icon name="user-plus" aria-hidden="true" />
              <span>+ Vincular outro filho</span>
            </button>
          )}
        </div>
      </section>

      {/* 2. SAUDAÇÃO COMPACTA & RESUMO (Substitui o banner gigante) */}
      <div className={styles.compactGreetingBar}>
        <div className={styles.greetingTextCol}>
          <h1 className={styles.compactGreetingTitle}>
            Olá, {firstName}! <span aria-hidden="true">👋</span>
          </h1>
          <p className={styles.compactGreetingSubtitle}>
            {activeStudent ? (
              <>
                Acompanhando o desempenho de{' '}
                <strong>
                  {activeStudent.nome} {activeStudent.sobrenome}
                </strong>
                {activeStudent.turma ? ` (${activeStudent.turma})` : ''}
              </>
            ) : (
              'Carregando informações do aluno…'
            )}
          </p>
        </div>
      </div>

      {/* 3. ALERTA DISCRETO DE COMUNICADOS NÃO LIDOS */}
      {unreadCount > 0 && (
        <div className={styles.unreadNoticeBanner} role="status">
          <div className={styles.unreadNoticeLeft}>
            <Icon name="bell-filled" className={styles.unreadNoticeIcon} aria-hidden="true" />
            <span>
              Você possui{' '}
              <strong>
                {unreadCount} comunicado{unreadCount > 1 ? 's' : ''} novo
                {unreadCount > 1 ? 's' : ''}
              </strong>{' '}
              da escola.
            </span>
          </div>
          <button
            type="button"
            className={styles.unreadNoticeActionBtn}
            onClick={() => setActiveSubTab('comunicados')}
          >
            Ver comunicados <Icon name="arrow-right" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 4. ALERTA DE ERRO DE CONEXÃO COM RETRY */}
      {dataError && (
        <div className={styles.errorAlert} role="alert" style={{ marginBottom: '20px' }}>
          <Icon name="alert-circle" aria-hidden="true" />
          <span>{dataError}</span>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={onRetry}
            aria-label="Tentar novamente carregar dados"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {dataLoading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* 5. RAIO-X DO ALUNO (Card do Aluno + Indicadores de Frequência em 360px) */}
          <div className={styles.topSummaryGrid} data-tour="summary-cards">
            {activeStudent && (
              <StudentCard
                student={activeStudent}
                lgpdAccepted={lgpdAccepted}
                onViewFicha={() => onNavigate?.('ficha')}
              />
            )}

            <FrequencyCard
              attendance={attendance ?? { presenca: 0, ausencia: 0, atraso: 0, percentual: 0 }}
            />
          </div>

          {/* Notificações em painel expansível quando ativado */}
          {showNotifications && (
            <div data-tour="notifications" style={{ marginBottom: '24px' }}>
              <NotificationsPanel
                notifications={notifications}
                onMarkAsRead={onMarkAsRead}
                onDelete={onDeleteNotification}
              />
            </div>
          )}

          {/* 6. ABAS INTERNAS DE CONTEÚDO (Boletim, Frequência Detalhada e Comunicados) */}
          <div className={styles.innerTabsContainer}>
            <div
              className={styles.innerTabsList}
              role="tablist"
              aria-label="Navegação detalhada do aluno"
            >
              <button
                type="button"
                role="tab"
                id="tab-boletim"
                aria-selected={activeSubTab === 'boletim'}
                aria-controls="tabpanel-boletim"
                className={`${styles.innerTabButton} ${activeSubTab === 'boletim' ? styles.active : ''}`}
                onClick={() => setActiveSubTab('boletim')}
              >
                <Icon name="book" aria-hidden="true" />
                <span>Boletim &amp; Notas</span>
              </button>

              <button
                type="button"
                role="tab"
                id="tab-frequencia"
                aria-selected={activeSubTab === 'frequencia'}
                aria-controls="tabpanel-frequencia"
                className={`${styles.innerTabButton} ${activeSubTab === 'frequencia' ? styles.active : ''}`}
                onClick={() => setActiveSubTab('frequencia')}
              >
                <Icon name="calendar-stats" aria-hidden="true" />
                <span>Frequência Detalhada</span>
              </button>

              <button
                type="button"
                role="tab"
                id="tab-comunicados"
                aria-selected={activeSubTab === 'comunicados'}
                aria-controls="tabpanel-comunicados"
                className={`${styles.innerTabButton} ${activeSubTab === 'comunicados' ? styles.active : ''}`}
                onClick={() => setActiveSubTab('comunicados')}
              >
                <Icon name="speakerphone" aria-hidden="true" />
                <span>Comunicados</span>
                {unreadCount > 0 && (
                  <span
                    className={styles.innerTabBadge}
                    role="status"
                    aria-label={`${unreadCount} não lidos`}
                  >
                    {unreadCount}
                  </span>
                )}
              </button>
            </div>

            {/* CONTEÚDO DA ABA 1: BOLETIM & NOTAS */}
            {activeSubTab === 'boletim' && (
              <div
                id="tabpanel-boletim"
                role="tabpanel"
                aria-labelledby="tab-boletim"
                className={styles.tabFade}
              >
                {detailsLoading ? (
                  <div className={`${styles.skeleton} ${styles.skeletonCardMd}`} aria-busy="true" />
                ) : (
                  <NotesCard grades={grades} />
                )}
              </div>
            )}

            {/* CONTEÚDO DA ABA 2: FREQUÊNCIA DETALHADA */}
            {activeSubTab === 'frequencia' && (
              <div
                id="tabpanel-frequencia"
                role="tabpanel"
                aria-labelledby="tab-frequencia"
                className={styles.tabFade}
              >
                <section className={styles.card} aria-labelledby="freq-detail-heading">
                  <div className={styles.cardHeader}>
                    <h3 id="freq-detail-heading" className={styles.cardTitle}>
                      <Icon name="calendar-check" aria-hidden="true" />
                      Detalhamento de Frequência e Presença
                    </h3>
                    <span className={styles.cardSubtitle}>Ano letivo 2026</span>
                  </div>

                  <div className={styles.freqDetailContent}>
                    <div className={styles.freqDetailCardsGrid}>
                      <div className={styles.freqMetricBox}>
                        <span className={styles.freqMetricNumber}>{attendance?.presenca ?? 0}</span>
                        <span className={styles.freqMetricTitle}>Aulas Presente</span>
                        <p className={styles.freqMetricDesc}>
                          Presenças registradas pelos professores
                        </p>
                      </div>

                      <div className={styles.freqMetricBox}>
                        <span className={`${styles.freqMetricNumber} ${styles.dangerText}`}>
                          {attendance?.ausencia ?? 0}
                        </span>
                        <span className={styles.freqMetricTitle}>Faltas Registradas</span>
                        <p className={styles.freqMetricDesc}>
                          Ausências durante as aulas regulares
                        </p>
                      </div>

                      <div className={styles.freqMetricBox}>
                        <span className={`${styles.freqMetricNumber} ${styles.warningText}`}>
                          {attendance?.atraso ?? 0}
                        </span>
                        <span className={styles.freqMetricTitle}>Atrasos na Entrada</span>
                        <p className={styles.freqMetricDesc}>Entradas após o horário do sinal</p>
                      </div>

                      <div className={styles.freqMetricBox}>
                        <span className={`${styles.freqMetricNumber} ${styles.cyanText}`}>
                          {Math.round(attendance?.percentual ?? 0)}%
                        </span>
                        <span className={styles.freqMetricTitle}>Aproveitamento Total</span>
                        <p className={styles.freqMetricDesc}>Mínimo obrigatório por lei: 75%</p>
                      </div>
                    </div>

                    <div className={styles.freqLdbNote}>
                      <Icon name="info-circle" aria-hidden="true" />
                      <div>
                        <strong>Critério de Aprovação por Assiduidade (LDB / Lei 9.394/96)</strong>
                        <p>
                          O aluno precisa cumprir no mínimo 75% do total de horas letivas para
                          aprovação. Faltas justificadas com atestado médico devem ser protocoladas
                          diretamente na secretaria.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* CONTEÚDO DA ABA 3: COMUNICADOS EM TEMPO REAL */}
            {activeSubTab === 'comunicados' && (
              <div
                id="tabpanel-comunicados"
                role="tabpanel"
                aria-labelledby="tab-comunicados"
                className={styles.tabFade}
              >
                <AnnouncementFeed />
              </div>
            )}
          </div>

          {/* 7. CARD DE SUPORTE ("Falar com a escola") & MOTTO NO RODAPÉ */}
          <section className={styles.dashboardHelpSection} aria-label="Suporte da escola">
            <div className={styles.helpCard}>
              <div className={styles.helpIconWrapper}>
                <Icon name="shield-check" aria-hidden="true" />
              </div>
              <div className={styles.helpTextCol}>
                <h4 className={styles.helpTitle}>Em caso de dúvidas, fale com a secretaria</h4>
                <p className={styles.helpSubtitle}>
                  Precisa justificar faltas, solicitar documentos ou falar com a coordenação
                  pedagógica?
                </p>
              </div>
              <div className={styles.helpActionCol}>
                <a
                  href="/html/conversas.html"
                  className={styles.helpContactButton}
                  aria-label="Falar com a escola pela central de mensagens"
                >
                  <Icon name="message-circle" aria-hidden="true" />
                  <span>Falar com a escola</span>
                </a>
              </div>
            </div>

            {/* Frase motivacional movida para o fechamento com elegância visual */}
            <div className={styles.mottoWrapper}>
              <span className={styles.mottoText}>“Juntos por uma educação melhor”</span>
              <span className={styles.mottoUnderline} aria-hidden="true" />
            </div>
          </section>
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

/** Aba dedicada: Ficha & Autorizações do aluno */
export function FichaTabSection({
  activeStudent,
  students,
  activeId,
  onSelectStudent,
  onStudentUpdate,
}: FichaTabProps) {
  if (!activeStudent) {
    return (
      <div className={styles.emptyDashboardCard}>
        <Icon
          name="clipboard-list"
          style={{ fontSize: '3rem', color: '#10b981', marginBottom: '12px' }}
        />
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
        <div className={styles.studentSelectorSection}>
          <div className={styles.studentTabsList}>
            {students.map((student) => (
              <button
                type="button"
                key={student.id}
                className={`${styles.studentPill} ${student.id === activeId ? styles.active : ''}`}
                onClick={() => onSelectStudent(student.id)}
              >
                <div className={styles.studentPillAvatar} aria-hidden="true">
                  <span>{(student.nome?.[0] || 'A').toUpperCase()}</span>
                </div>
                <span className={styles.studentPillName}>
                  {student.nome} {student.sobrenome}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.pageHeader}>
        <span className={styles.pageEyebrow}>
          <Icon name="clipboard-list" aria-hidden="true" /> Ficha do Aluno
        </span>
        <h1 className={styles.pageTitle}>Ficha &amp; Autorizações</h1>
        <p className={styles.pageSubtitle}>
          Dados, autorizações escolares e documento assinado de{' '}
          <strong>
            {activeStudent.nome} {activeStudent.sobrenome}
          </strong>
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
  onNavigate: (tab: PortalTab) => void;
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
    onNavigate,
  } = props;

  if (currentTab === 'privacidade') {
    return (
      <PoliticaPrivacidade
        onBack={() => onNavigate('dashboard')}
        onOpenConsents={() => onNavigate('profile')}
      />
    );
  }

  if (currentTab === 'profile') {
    return (
      <ProfileTabSection
        authUser={authUser}
        activeStudent={activeStudent}
        onUserUpdate={onUserUpdate}
      />
    );
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
