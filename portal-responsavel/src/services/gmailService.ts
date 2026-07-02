/**
 * services/gmailService.ts
 * Singleton service that handles communication with the Gmail API.
 * Currently uses mock data for development; replace the mock methods
 * with real fetch() calls once a backend endpoint is available.
 */

import type { Notification } from '../types';

// ─── Mock Notifications ───────────────────────────────────────────────────────
const now = Date.now();
const day = 86_400_000;

const mockNotifications: Notification[] = [
  {
    id: 'n1',
    tipo: 'evento',
    titulo: 'Reunião de Pais e Mestres',
    mensagem:
      'Prezado responsável, informamos que a Reunião de Pais e Mestres será realizada no dia 25/05/2026 às 19h no auditório da escola. Sua presença é fundamental para acompanhar o desenvolvimento do seu filho(a). Confirme presença pelo sistema.',
    dataCriacao: new Date(now - 1 * day).toISOString(),
    lido: false,
    destinatarios: 'todos',
    icon: '📅',
  },
  {
    id: 'n2',
    tipo: 'academico',
    titulo: 'Boletim do 2º Bimestre Disponível',
    mensagem:
      'O boletim escolar do 2º bimestre já está disponível para consulta no portal. Acesse a aba "Notas" para visualizar o desempenho detalhado por disciplina. Em caso de dúvidas, entre em contato com a coordenação pedagógica.',
    dataCriacao: new Date(now - 3 * day).toISOString(),
    lido: false,
    destinatarios: 'todos',
    icon: '📊',
  },
  {
    id: 'n3',
    tipo: 'aviso',
    titulo: 'Feriado Escolar – 20/05',
    mensagem:
      'Informamos que no dia 20 de maio de 2026 não haverá aulas em razão do feriado municipal. As atividades serão retomadas normalmente na quarta-feira, dia 21/05. Bom descanso a todos!',
    dataCriacao: new Date(now - 5 * day).toISOString(),
    lido: true,
    destinatarios: 'todos',
    icon: '🔔',
  },
  {
    id: 'n4',
    tipo: 'financeiro',
    titulo: 'Lembrete: Mensalidade Maio',
    mensagem:
      'Lembramos que o vencimento da mensalidade de maio é dia 10/05/2026. Utilize o boleto disponível no portal ou faça o pagamento via PIX. Em caso de dificuldades, entre em contato com a secretaria.',
    dataCriacao: new Date(now - 7 * day).toISOString(),
    lido: true,
    destinatarios: 'todos',
    icon: '💰',
  },
  {
    id: 'n5',
    tipo: 'saude',
    titulo: 'Campanha de Vacinação na Escola',
    mensagem:
      'A Secretaria Municipal de Saúde realizará uma campanha de vacinação nas dependências da escola no dia 28/05/2026. Traga a carteira de vacinação do seu filho(a). A participação é voluntária.',
    dataCriacao: new Date(now - 9 * day).toISOString(),
    lido: false,
    destinatarios: 'todos',
    icon: '💉',
  },
  {
    id: 'n6',
    tipo: 'falta',
    titulo: 'Registro de Falta – 12/05/2026',
    mensagem:
      'Seu filho(a) registrou falta no dia 12/05/2026. Caso a ausência tenha sido justificada, encaminhe o atestado ou declaração à secretaria em até 5 dias úteis. Faltas não justificadas impactam o percentual de frequência.',
    dataCriacao: new Date(now - 6 * day).toISOString(),
    lido: false,
    destinatarios: 'todos',
    icon: '⚠️',
  },
];

// ─── Service Class ────────────────────────────────────────────────────────────
class GmailService {
  private static instance: GmailService;
  private accessToken: string | null = null;
  private notifications: Notification[] = [...mockNotifications];

  private constructor() {}

  static getInstance(): GmailService {
    if (!GmailService.instance) {
      GmailService.instance = new GmailService();
    }
    return GmailService.instance;
  }

  /** Store the OAuth access token for authenticated requests. */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /** Return school notifications for the given email (mock). */
  async getSchoolNotifications(_email: string): Promise<Notification[]> {
    // Simulate network latency
    await new Promise<void>((r) => setTimeout(r, 600));
    return [...this.notifications];
  }

  /** Mark a single notification as read. */
  async markAsRead(messageId: string): Promise<void> {
    this.notifications = this.notifications.map((n) =>
      n.id === messageId ? { ...n, lido: true } : n,
    );
  }

  /** Remove a notification from the list. */
  async deleteNotification(messageId: string): Promise<void> {
    this.notifications = this.notifications.filter((n) => n.id !== messageId);
  }

  /**
   * Simulate sending a read-confirmation email to the school director.
   * In production, make a POST to your backend which calls the Gmail API.
   */
  async sendReadConfirmation(
    directorEmail: string,
    studentName: string,
    title: string,
  ): Promise<void> {
    if (!this.accessToken) return;
    // eslint-disable-next-line no-console
    console.info(
      `[GmailService] Confirmation sent to ${directorEmail} → ${studentName} read "${title}"`,
    );
    // TODO: replace with real Gmail API call via backend proxy
  }
}

export const gmailService = GmailService.getInstance();
