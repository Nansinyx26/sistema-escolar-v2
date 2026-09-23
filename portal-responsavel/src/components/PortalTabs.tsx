/**
 * components/PortalTabs.tsx
 * Gerencia as seções e abas do Portal do Responsável.
 * Reformulado para identidade visual dark/cyan premium (Issue #434):
 * - Banner escolar com imagem de fundo, overlay gradiente e saudação
 * - Resumo superior: Card do Aluno compacto + 3 indicadores de frequência coloridos inline
 * - Abas de navegação interna com glow cyan
 * - Layout em grid: notas + comunicados recentes lado a lado
 * - Coluna lateral com Ações Rápidas, suporte e lema institucional
 */

import { useState } from 'react';
import { toast } from 'react-hot-toast';
import bannerEscola from '../assets/banner-escola.jpg';
import { getBoletimPdf } from '../services/apiService';
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
  const [activeSubTab, setActiveSubTab] = useState<DashboardSubTab>('boletim');
  const [downloading, setDownloading] = useState(false);

  if (students.length === 0) {
    return (
      <div className={styles.emptyDashboardCard}>
        <Icon name="users" style={{ fontSize: '3.5rem', color: '#00d4ff', marginBottom: '16px' }} />
        <h3>Nenhum aluno vinculado</h3>
        <p style={{ margin: '8px 0 24px', color: '#8ba3b0' }}>
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

  const handleDownloadBoletim = async () => {
    if (downloading || !activeStudent) return;
    setDownloading(true);
    try {
      const studentId = activeStudent.id || activeStudent._id;
      const blob = await getBoletimPdf(studentId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Boletim_${activeStudent.nome}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Boletim baixado com sucesso!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao baixar boletim';
      toast.error(message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={styles.dashboardWrapper}>
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

      {/* Grid Principal: Conteúdo Central + Coluna Direita */}
      <div className={styles.dashboardLayout}>
        <div className={styles.dashboardMainContent}>
          {/* 2. BANNER ESCOLAR COM IMAGEM & SAUDAÇÃO */}
          <div className={styles.schoolBanner}>
            <div
              className={styles.schoolBannerBg}
              style={{ backgroundImage: `url(${bannerEscola})` }}
              aria-hidden="true"
            />
            <div className={styles.schoolBannerOverlay} aria-hidden="true" />
            <div className={styles.schoolBannerContent}>
              <div className={styles.schoolBannerAvatar} aria-hidden="true">
                <Icon name="school" />
              </div>
              <div className={styles.schoolBannerText}>
                <h1 className={styles.schoolBannerTitle}>
                  Olá, {firstName}! <span aria-hidden="true">👋</span>
                </h1>
                <p className={styles.schoolBannerSubtitle}>
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
                <div className={styles.schoolBannerLine} aria-hidden="true" />
              </div>
            </div>
          </div>

          {/* 3. ALERTA DE COMUNICADOS NÃO LIDOS */}
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
              {/* 5. RAIO-X DO ALUNO (Card do Aluno + Indicadores de Frequência Inline) */}
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

              {/* 6. ABAS INTERNAS DE CONTEÚDO */}
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

                {/* CONTEÚDO DA ABA 1: BOLETIM & NOTAS + COMUNICADOS RECENTES */}
                {activeSubTab === 'boletim' && (
                  <div
                    id="tabpanel-boletim"
                    role="tabpanel"
                    aria-labelledby="tab-boletim"
                    className={styles.tabFade}
                  >
                    {detailsLoading ? (
                      <div
                        className={`${styles.skeleton} ${styles.skeletonCardMd}`}
                        aria-busy="true"
                      />
                    ) : (
                      <div className={styles.dashboardContentGrid}>
                        <div className={styles.dashboardNotesCol}>
                          <NotesCard grades={grades} />
                        </div>

                        <div className={styles.dashboardAnnouncementsCol}>
                          <section
                            className={styles.recentAnnouncementsCard}
                            aria-labelledby="recent-announcements-title"
                          >
                            <div className={styles.recentAnnouncementsHeader}>
                              <div className={styles.recentAnnouncementsTitleGroup}>
                                <Icon name="speakerphone" aria-hidden="true" />
                                <h3
                                  id="recent-announcements-title"
                                  className={styles.recentAnnouncementsTitle}
                                >
                                  Comunicados Recentes
                                </h3>
                              </div>
                              <button
                                type="button"
                                className={styles.viewAllAnnouncementsBtn}
                                onClick={() => setActiveSubTab('comunicados')}
                              >
                                Ver todos
                              </button>
                            </div>

                            <div className={styles.recentAnnouncementsList}>
                              {notifications.length === 0 ? (
                                <div className={styles.emptyAnnouncementsBox}>
                                  <Icon name="bell" aria-hidden="true" />
                                  <p>Nenhum comunicado recente</p>
                                </div>
                              ) : (
                                notifications.slice(0, 4).map((item) => (
                                  <button
                                    type="button"
                                    key={item.id}
                                    className={`${styles.recentAnnouncementItem} ${!item.lido ? styles.unread : ''}`}
                                    onClick={() => {
                                      if (!item.lido) onMarkAsRead(item.id);
                                      setActiveSubTab('comunicados');
                                    }}
                                  >
                                    <div
                                      className={styles.recentAnnouncementIconCol}
                                      aria-hidden="true"
                                    >
                                      <span className={styles.announcementDot} />
                                    </div>
                                    <div className={styles.recentAnnouncementContent}>
                                      <h4 className={styles.recentAnnouncementItemTitle}>
                                        {item.titulo}
                                      </h4>
                                      <p className={styles.recentAnnouncementSnippet}>
                                        {item.mensagem}
                                      </p>
                                      {item.dataCriacao && (
                                        <span className={styles.recentAnnouncementDate}>
                                          {new Date(item.dataCriacao).toLocaleDateString('pt-BR', {
                                            day: '2-digit',
                                            month: '2-digit',
                                            year: 'numeric',
                                          })}
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          </section>
                        </div>
                      </div>
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
                            <span className={styles.freqMetricNumber}>
                              {attendance?.presenca ?? 0}
                            </span>
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
                            <p className={styles.freqMetricDesc}>
                              Entradas após o horário do sinal
                            </p>
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
                            <strong>
                              Critério de Aprovação por Assiduidade (LDB / Lei 9.394/96)
                            </strong>
                            <p>
                              O aluno precisa cumprir no mínimo 75% do total de horas letivas para
                              aprovação. Faltas justificadas com atestado médico devem ser
                              protocoladas diretamente na secretaria.
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
            </>
          )}
        </div>

        {/* 7. COLUNA LATERAL DIREITA: AÇÕES RÁPIDAS + SUPORTE + LEMA */}
        <aside className={styles.dashboardRightColumn} aria-label="Ações rápidas e suporte">
          {/* Card: Ações Rápidas */}
          <div className={styles.quickActionsCard}>
            <h3 className={styles.quickActionsTitle}>
              <Icon name="bolt" aria-hidden="true" />
              Ações Rápidas
            </h3>
            <div className={styles.quickActionsList}>
              {onNavigate && (
                <button
                  type="button"
                  className={styles.quickActionItem}
                  onClick={() => onNavigate('ficha')}
                  aria-label="Ver ficha completa do aluno"
                >
                  <div className={styles.quickActionIcon} aria-hidden="true">
                    <Icon name="clipboard-list" />
                  </div>
                  <div className={styles.quickActionText}>
                    <span className={styles.quickActionLabel}>Ver Ficha Completa</span>
                    <span className={styles.quickActionSub}>Dados cadastrais</span>
                  </div>
                  <Icon
                    name="chevron-right"
                    className={styles.quickActionArrow}
                    aria-hidden="true"
                  />
                </button>
              )}

              <button
                type="button"
                className={styles.quickActionItem}
                onClick={handleDownloadBoletim}
                disabled={downloading}
                aria-label="Baixar boletim escolar em PDF"
              >
                <div className={styles.quickActionIcon} aria-hidden="true">
                  <Icon name={downloading ? 'loader' : 'file-download'} spin={downloading} />
                </div>
                <div className={styles.quickActionText}>
                  <span className={styles.quickActionLabel}>
                    {downloading ? 'Gerando…' : 'Baixar Boletim (PDF)'}
                  </span>
                  <span className={styles.quickActionSub}>Documento oficial</span>
                </div>
                <Icon name="chevron-right" className={styles.quickActionArrow} aria-hidden="true" />
              </button>

              {onNavigate && (
                <button
                  type="button"
                  className={styles.quickActionItem}
                  onClick={() => onNavigate('linking')}
                  aria-label="Vincular outro filho à conta"
                >
                  <div className={styles.quickActionIcon} aria-hidden="true">
                    <Icon name="user-plus" />
                  </div>
                  <div className={styles.quickActionText}>
                    <span className={styles.quickActionLabel}>Vincular outro filho</span>
                    <span className={styles.quickActionSub}>Adicionar estudante</span>
                  </div>
                  <Icon
                    name="chevron-right"
                    className={styles.quickActionArrow}
                    aria-hidden="true"
                  />
                </button>
              )}
            </div>
          </div>

          {/* Card: Suporte / Falar com a escola */}
          <div className={styles.supportCard}>
            <div className={styles.supportHeader}>
              <div className={styles.supportIconWrapper} aria-hidden="true">
                <Icon name="message-circle" />
              </div>
              <div>
                <h4 className={styles.supportTitle}>Falar com a escola</h4>
                <p className={styles.supportSub}>Secretaria &amp; Coordenação</p>
              </div>
            </div>
            <p className={styles.supportDesc}>
              Dúvidas pedagógicas, justificativas de faltas ou solicitações gerais.
            </p>
            <a
              href="/html/conversas.html"
              className={styles.supportContactBtn}
              aria-label="Falar com a escola na central de mensagens"
            >
              <Icon name="message-dots" aria-hidden="true" />
              <span>Abrir Conversas</span>
            </a>
          </div>

          {/* Lema institucional */}
          <div className={styles.mottoWrapper}>
            <span className={styles.mottoText}>“Juntos por uma educação melhor”</span>
            <span className={styles.mottoUnderline} aria-hidden="true" />
          </div>
        </aside>
      </div>
    </div>
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
          style={{ fontSize: '3rem', color: '#00d4ff', marginBottom: '12px' }}
        />
        <h3>Nenhum aluno selecionado</h3>
        <p style={{ margin: '8px 0', color: '#8ba3b0' }}>
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
