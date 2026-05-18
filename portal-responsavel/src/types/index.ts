/**
 * types/index.ts
 * Centralized TypeScript interfaces for the Portal do Responsável Escolar.
 * All domain models are strictly typed – no `any` allowed.
 */

export interface Student {
  id: string;
  nome: string;
  sobrenome: string;
  matricula: string;
  turma: string;
  dataNascimento: string; // ISO 8601
  foto?: string;
  responsavelId: string;
}

export interface Grade {
  id: string;
  disciplina: string;
  bimestres: [number, number, number, number]; // exactly 4 values
  professor?: string;
}

export interface Attendance {
  presenca: number;
  ausencia: number;
  atraso: number;
  percentual: number;
}

export type NotificationType =
  | 'info'
  | 'aviso'
  | 'evento'
  | 'financeiro'
  | 'academico'
  | 'saude'
  | 'falta';

export interface Notification {
  id: string;
  tipo: NotificationType;
  titulo: string;
  mensagem: string;
  dataCriacao: string; // ISO 8601
  lido: boolean;
  destinatarios: 'todos' | string;
  icon: string; // emoji
}

export interface GmailUser {
  email: string;
  name: string;
  picture: string;
  accessToken: string;
}

export interface UseGmailAuthReturn {
  user: GmailUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  loginWithGmail: () => Promise<void>;
  logout: () => void;
}
