/**
 * components/PortalTabs.tsx
 * Gerencia as seções e abas do Portal do Responsável.
 *
 * Painel Geral segue as referências visuais Dark e Light (Issue #436), com a
 * mesma marcação nos dois temas:
 * - Banner de boas-vindas com saudação ao responsável
 * - Card do aluno + indicadores de presença, ausência e frequência
 * - Abas Boletim / Frequência / Comunicados ao lado de Comunicados Recentes
 * - Coluna direita com Ações rápidas, contato com a secretaria e lema
 */

import type React from 'react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import bannerEscola from '../assets/banner-escola.jpg';
import { getBoletimPdf } from '../services/apiService';
import styles from '../styles/portal.module.scss';
import type { Attendance, AuthUser, Grade, Notification, Student } from '../types';
import { getPhotoUrl } from '../utils/photoUtils';
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

/** Ícone e cor de cada tipo de comunicado na lista de Comunicados Recentes. */
const ANNOUNCEMENT_ICON: Record<string, { icon: string; tone: string }> = {
  evento: { icon: 'confetti', tone: 'toneEvento' },
  aviso: { icon: 'alert-triangle', tone: 'toneAviso' },
  falta: { icon: 'calendar-check', tone: 'toneAviso' },
  saude: { icon: 'shield-check', tone: 'toneSaude' },
  financeiro: { icon: 'file-text', tone: 'toneInfo' },
  academico: { icon: 'book', tone: 'toneInfo' },
  info: { icon: 'file-text', tone: 'toneInfo' },
};

function formatDate(value?: string): string {
  if (!value) return '';
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Rola até um trecho da página depois que a aba de destino renderiza. */
function scrollToWhenReady(id: string, tentativas = 10) {
  const alvo = document.getElementById(id);
  if (alvo) {
    alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (tentativas > 0) window.setTimeout(() => scrollToWhenReady(id, tentativas - 1), 60);
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
        <Icon
          name="users"
          style={{ fontSize: '3.5rem', color: 'var(--accent)', marginBottom: '16px' }}
        />
        <h3>Nenhum aluno vinculado</h3>
        <p style={{ margin: '8px 0 24px', color: 'var(--text-secondary)' }}>
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
  const nomeResponsavel = authUser.nome?.trim() || 'Responsável';
  const fotoResponsavel = getPhotoUrl(authUser.foto || authUser.fotoGoogle || '');
  const temFotoResponsavel = fotoResponsavel !== '/img/default-avatar.png';

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

  const subTabs: { id: DashboardSubTab; label: string; icon: string }[] = [
    { id: 'boletim', label: 'Boletim', icon: 'file-text' },
    { id: 'frequencia', label: 'Frequência', icon: 'calendar-stats' },
    { id: 'comunicados', label: 'Comunicados', icon: 'speakerphone' },
  ];

  // Setas esquerda/direita percorrem as abas (padrão WAI-ARIA de tablist)
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const next = subTabs[(index + delta + subTabs.length) % subTabs.length];
    setActiveSubTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <div className={styles.dashboardWrapper}>
      {/* Seletor de aluno: só aparece quando há mais de um filho vinculado */}
      {students.length > 1 && (
        <section className={styles.studentSelectorSection} aria-label="Selecionar aluno">
          <div className={styles.studentTabsList}>
            {students.map((student) => {
              const isSelected = student.id === activeId;
              return (
                <button
                  type="button"
                  key={student.id}
                  aria-pressed={isSelected}
                  className={`${styles.studentPill} ${isSelected ? styles.active : ''}`}
                  onClick={() => onSelectStudent(student.id)}
                >
                  <div className={styles.studentPillAvatar} aria-hidden="true">
                    {student.foto && student.foto !== 'null' && lgpdAccepted ? (
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
                      {student.escolaNome ? ` · ${student.escolaNome}` : ''}
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
          </div>
        </section>
      )}

      <div className={styles.dashboardLayout}>
        <div className={styles.dashboardMainContent}>
          {/* BANNER DE BOAS-VINDAS */}
          <section className={styles.schoolBanner} aria-labelledby="banner-saudacao">
            <div
              className={styles.schoolBannerBg}
              style={{ backgroundImage: `url(${bannerEscola})` }}
              aria-hidden="true"
            />
            <div className={styles.schoolBannerOverlay} aria-hidden="true" />
            <div className={styles.schoolBannerContent}>
              <div className={styles.schoolBannerAvatar} aria-hidden="true">
                {temFotoResponsavel ? (
                  <img
                    src={fotoResponsavel}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Icon name="user-round" />
                )}
              </div>
              <div className={styles.schoolBannerText}>
                <h1 id="banner-saudacao" className={styles.schoolBannerTitle}>
                  Olá, {nomeResponsavel}! <span aria-hidden="true">👋</span>
                </h1>
                <p className={styles.schoolBannerSubtitle}>
                  Acompanhe o desempenho de seu filho(a) na escola.
                </p>
                <div className={styles.schoolBannerLine} aria-hidden="true" />
              </div>
            </div>
          </section>

          {/* ALERTA DE COMUNICADOS NÃO LIDOS */}
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

          {/* ERRO DE CONEXÃO COM NOVA TENTATIVA */}
          {dataError && (
            <div className={styles.errorAlert} role="alert">
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
              {/* CARD DO ALUNO + INDICADORES DE FREQUÊNCIA */}
              <div className={styles.topSummaryGrid} data-tour="summary-cards">
                {activeStudent && (
                  <StudentCard
                    student={activeStudent}
                    lgpdAccepted={lgpdAccepted}
                    onViewFicha={() => onNavigate?.('ficha')}
                  />
                )}

                {detailsLoading && !attendance ? (
                  <div
                    className={`${styles.skeleton} ${styles.skeletonFrequency}`}
                    aria-busy="true"
                    aria-label="Carregando frequência"
                  />
                ) : attendance ? (
                  <FrequencyCard attendance={attendance} />
                ) : (
                  <section className={styles.frequencyInlineSection} aria-label="Frequência">
                    <div className={styles.emptyState} role="status">
                      <Icon name="calendar-check" aria-hidden="true" />
                      <p>Nenhum registro de frequência ainda.</p>
                    </div>
                  </section>
                )}
              </div>

              {showNotifications && (
                <div data-tour="notifications">
                  <NotificationsPanel
                    notifications={notifications}
                    onMarkAsRead={onMarkAsRead}
                    onDelete={onDeleteNotification}
                  />
                </div>
              )}

              {/* ÁREA ACADÊMICA (ABAS) + COMUNICADOS RECENTES */}
              <div className={styles.dashboardContentGrid}>
                <div className={styles.innerTabsContainer}>
                  <div
                    className={styles.innerTabsList}
                    role="tablist"
                    aria-label="Informações acadêmicas do aluno"
                  >
                    {subTabs.map((tab, index) => {
                      const selected = activeSubTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          id={`tab-${tab.id}`}
                          aria-selected={selected}
                          aria-controls={`tabpanel-${tab.id}`}
                          tabIndex={selected ? 0 : -1}
                          className={`${styles.innerTabButton} ${selected ? styles.active : ''}`}
                          onClick={() => setActiveSubTab(tab.id)}
                          onKeyDown={(e) => handleTabKeyDown(e, index)}
                        >
                          <Icon name={tab.icon} aria-hidden="true" />
                          <span>{tab.label}</span>
                          {tab.id === 'comunicados' && unreadCount > 0 && (
                            <span
                              className={styles.innerTabBadge}
                              aria-label={`${unreadCount} não lidos`}
                            >
                              {unreadCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

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
                          aria-label="Carregando notas"
                        />
                      ) : (
                        <NotesCard
                          grades={grades}
                          onDownload={activeStudent ? handleDownloadBoletim : undefined}
                          downloading={downloading}
                        />
                      )}
                    </div>
                  )}

                  {activeSubTab === 'frequencia' && (
                    <div
                      id="tabpanel-frequencia"
                      role="tabpanel"
                      aria-labelledby="tab-frequencia"
                      className={styles.tabFade}
                    >
                      <section className={styles.card} aria-labelledby="freq-detail-heading">
                        <div className={styles.cardHeader}>
                          <div className={styles.cardHeaderIcon} aria-hidden="true">
                            <Icon name="calendar-check" />
                          </div>
                          <div className={styles.cardHeaderText}>
                            <h3 id="freq-detail-heading" className={styles.cardTitle}>
                              Frequência Detalhada
                            </h3>
                            <span className={styles.cardSubtitle}>
                              Ano letivo {new Date().getFullYear()}
                            </span>
                          </div>
                        </div>

                        {detailsLoading ? (
                          <div
                            className={`${styles.skeleton} ${styles.skeletonCardMd}`}
                            aria-busy="true"
                            aria-label="Carregando frequência"
                          />
                        ) : (
                          <div className={styles.freqDetailContent}>
                            <div className={styles.freqDetailCardsGrid}>
                              <div className={styles.freqMetricBox}>
                                <span className={styles.freqMetricNumber}>
                                  {attendance?.presenca ?? 0}
                                </span>
                                <span className={styles.freqMetricTitle}>Aulas presente</span>
                                <p className={styles.freqMetricDesc}>
                                  Presenças registradas pelos professores
                                </p>
                              </div>
                              <div className={styles.freqMetricBox}>
                                <span className={`${styles.freqMetricNumber} ${styles.freqDanger}`}>
                                  {attendance?.ausencia ?? 0}
                                </span>
                                <span className={styles.freqMetricTitle}>Faltas registradas</span>
                                <p className={styles.freqMetricDesc}>
                                  Ausências durante as aulas regulares
                                </p>
                              </div>
                              <div className={styles.freqMetricBox}>
                                <span
                                  className={`${styles.freqMetricNumber} ${styles.freqWarning}`}
                                >
                                  {attendance?.atraso ?? 0}
                                </span>
                                <span className={styles.freqMetricTitle}>Atrasos na entrada</span>
                                <p className={styles.freqMetricDesc}>
                                  Entradas após o horário do sinal
                                </p>
                              </div>
                              <div className={styles.freqMetricBox}>
                                <span className={`${styles.freqMetricNumber} ${styles.freqAccent}`}>
                                  {Math.round(attendance?.percentual ?? 0)}%
                                </span>
                                <span className={styles.freqMetricTitle}>Aproveitamento total</span>
                                <p className={styles.freqMetricDesc}>
                                  Mínimo obrigatório por lei: 75%
                                </p>
                              </div>
                            </div>

                            <div className={styles.freqLdbNote}>
                              <Icon name="info-circle" aria-hidden="true" />
                              <div>
                                <strong>
                                  Critério de aprovação por assiduidade (LDB, Lei 9.394/96)
                                </strong>
                                <p>
                                  O aluno precisa cumprir no mínimo 75% do total de horas letivas
                                  para aprovação. Faltas justificadas com atestado médico devem ser
                                  protocoladas diretamente na secretaria.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </section>
                    </div>
                  )}

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

                {/* COMUNICADOS RECENTES */}
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
                      Ver todos <Icon name="arrow-right" aria-hidden="true" />
                    </button>
                  </div>

                  <div className={styles.recentAnnouncementsList}>
                    {notifications.length === 0 ? (
                      <div className={styles.emptyAnnouncementsBox} role="status">
                        <Icon name="bell" aria-hidden="true" />
                        <p>Nenhum comunicado recente</p>
                      </div>
                    ) : (
                      notifications.slice(0, 4).map((item) => {
                        const visual = ANNOUNCEMENT_ICON[item.tipo] ?? ANNOUNCEMENT_ICON.info;
                        return (
                          <button
                            type="button"
                            key={item.id}
                            className={`${styles.recentAnnouncementItem} ${!item.lido ? styles.unread : ''}`}
                            onClick={() => {
                              if (!item.lido) onMarkAsRead(item.id);
                              setActiveSubTab('comunicados');
                            }}
                          >
                            <span
                              className={`${styles.recentAnnouncementIcon} ${styles[visual.tone]}`}
                              aria-hidden="true"
                            >
                              <Icon name={visual.icon} />
                            </span>
                            <span className={styles.recentAnnouncementContent}>
                              <span className={styles.recentAnnouncementTop}>
                                <span className={styles.recentAnnouncementItemTitle}>
                                  {item.titulo}
                                </span>
                                <span className={styles.recentAnnouncementDate}>
                                  {formatDate(item.dataCriacao)}
                                </span>
                              </span>
                              <span className={styles.recentAnnouncementSnippet}>
                                {item.mensagem}
                              </span>
                            </span>
                            {!item.lido && <span className="sr-only">(não lido)</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>

        {/* COLUNA DIREITA: AÇÕES RÁPIDAS, CONTATO E LEMA */}
        <aside className={styles.dashboardRightColumn} aria-label="Ações rápidas e contato">
          <section className={styles.quickActionsCard} aria-labelledby="quick-actions-title">
            <h3 id="quick-actions-title" className={styles.quickActionsTitle}>
              <Icon name="bolt" aria-hidden="true" />
              Ações rápidas
            </h3>
            <div className={styles.quickActionsList}>
              <button
                type="button"
                className={styles.quickActionItem}
                onClick={() => onNavigate?.('ficha')}
              >
                <span className={styles.quickActionIcon} aria-hidden="true">
                  <Icon name="file-text" />
                </span>
                <span className={styles.quickActionText}>
                  <span className={styles.quickActionLabel}>Ver Ficha do Aluno</span>
                  <span className={styles.quickActionSub}>Dados, histórico e informações</span>
                </span>
                <Icon name="chevron-right" className={styles.quickActionArrow} aria-hidden="true" />
              </button>

              <button
                type="button"
                className={styles.quickActionItem}
                onClick={() => {
                  onNavigate?.('ficha');
                  scrollToWhenReady('ficha-autorizacoes');
                }}
              >
                <span className={styles.quickActionIcon} aria-hidden="true">
                  <Icon name="shield-check" />
                </span>
                <span className={styles.quickActionText}>
                  <span className={styles.quickActionLabel}>Autorizações</span>
                  <span className={styles.quickActionSub}>
                    Veja as autorizações e documentos
                  </span>
                </span>
                <Icon name="chevron-right" className={styles.quickActionArrow} aria-hidden="true" />
              </button>

              <button
                type="button"
                className={styles.quickActionItem}
                onClick={() => onNavigate?.('linking')}
              >
                <span className={styles.quickActionIcon} aria-hidden="true">
                  <Icon name="link" />
                </span>
                <span className={styles.quickActionText}>
                  <span className={styles.quickActionLabel}>Vincular outro filho</span>
                  <span className={styles.quickActionSub}>Adicione mais alunos à sua conta</span>
                </span>
                <Icon name="chevron-right" className={styles.quickActionArrow} aria-hidden="true" />
              </button>
            </div>
          </section>

          <section className={styles.supportCard} aria-label="Contato com a escola">
            <div className={styles.supportHeader}>
              <span className={styles.supportIconWrapper} aria-hidden="true">
                <Icon name="shield-question" />
              </span>
              <p className={styles.supportDesc}>
                Em caso de dúvidas, entre em contato com a secretaria da escola.
              </p>
            </div>
            <a href="/html/conversas.html" className={styles.supportContactBtn}>
              <Icon name="message-square" aria-hidden="true" />
              <span>Falar com a escola</span>
            </a>
          </section>

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
          style={{ fontSize: '3rem', color: 'var(--accent)', marginBottom: '12px' }}
        />
        <h3>Nenhum aluno selecionado</h3>
        <p style={{ margin: '8px 0', color: 'var(--text-secondary)' }}>
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
