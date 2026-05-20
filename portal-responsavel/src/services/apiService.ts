/**
 * services/apiService.ts
 * HTTP client that talks to the existing school backend (/api/*).
 * Authentication uses the same JWT cookie mechanism the backend already
 * handles — the browser sends credentials automatically via `credentials: 'include'`.
 *
 * All methods throw ApiError on failure so callers can show appropriate UI.
 */

import type { Student, Grade, Attendance, Notification } from '../types';

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL = import.meta.env.VITE_API_URL || 
  (typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:3001/api');

// ─── Error class ──────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Base fetch wrapper ───────────────────────────────────────────────────────
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // Prepare headers, including CSRF token if present for mutating requests
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method?.toUpperCase() ?? '')) {
    const csrf = getCsrfToken();
    if (csrf) {
      headers['X-CSRF-Token'] = csrf;
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });

  const body = await res.json() as { success: boolean; data?: T; user?: T; error?: string };

  if (!res.ok || !body.success) {
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  }

  return (body.data !== undefined ? body.data : body.user) as T;
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginPayload {
  email: string;
  senha: string;
}

export interface AuthUser {
  _id: string;
  email: string;
  nome: string;
  perfil: string;
  cpf?: string;
  telefone?: string;
  consentimentoAceiteEm?: string;
}

/** Login with email + password – sets JWT cookie on the browser. */
export async function login(payload: LoginPayload): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ ...payload, portal: 'responsavel' }),
  });
}

/** Mock login for testing Google Auth – sets JWT cookie on the browser. */
export async function mockGoogleLogin(email: string): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/mock-google-login', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** Logout – clears the JWT cookie. */
export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
}

/** Returns the logged-in user from the cookie, or throws 401. */
export async function getMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/me');
}

/** Updates user's own profile (such as name, cpf, and telephone). */
export async function updateProfile(payload: { nome: string; cpf: string; telefone: string; consentimentoAceiteEm?: boolean }): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

// ─── Responsável-specific endpoints ──────────────────────────────────────────

/** Raw shape returned by the backend for a student. */
interface RawAluno {
  id: string;
  nome: string;
  sobrenome: string;
  matricula: string;
  turma: string;
  dataNascimento: string;
  foto: string | null;
  ativo: boolean;
  cpfAluno?: string;
  telefone?: string;
  endereco?: any;
  nacionalidade?: string;
  etnia?: string;
  religiao?: string;
  responsavelDados?: any;
  alergiasAlimentos?: string;
  alergiasRemedio?: string;
  planoSaude?: string;
  deficiencia?: string;
  pcd?: boolean;
  nivel?: string;
  condicao?: string;
  observacoes?: string;
  documentos?: any[];
  lgpdConsentimento?: any;
}

/** Fetch the students linked to the authenticated guardian's email. */
export async function getAlunosDoResponsavel(): Promise<Student[]> {
  const raw = await apiFetch<RawAluno[]>('/responsavel/alunos');
  return raw.map(r => ({
    ...r,
    id:              r.id,
    nome:            r.nome,
    sobrenome:       r.sobrenome ?? '',
    matricula:       r.matricula,
    turma:           r.turma,
    dataNascimento:  r.dataNascimento,
    foto:            r.foto ?? undefined,
    responsavelId:   '',   // not needed on the client
    cpfAluno:        r.cpfAluno,
    telefone:        r.telefone,
    endereco:        r.endereco,
    nacionalidade:   r.nacionalidade,
    etnia:           r.etnia,
    religiao:        r.religiao,
    responsavelDados: r.responsavelDados,
    alergiasAlimentos: r.alergiasAlimentos,
    alergiasRemedio: r.alergiasRemedio,
    planoSaude:      r.planoSaude,
    deficiencia:     r.deficiencia,
    pcd:             r.pcd,
    nivel:           r.nivel,
    condicao:        r.condicao,
    observacoes:     r.observacoes,
    documentos:      r.documentos ?? [],
    lgpdConsentimento: r.lgpdConsentimento ?? null
  }));
}

/** Search for a student to link. */
export async function buscarAlunosParaVinculo(query: string): Promise<any[]> {
  return apiFetch<any[]>(`/responsavel/buscar-aluno?q=${encodeURIComponent(query)}`);
}

/** Link a student to the logged-in guardian. */
export async function vincularAluno(alunoId: string): Promise<void> {
  await apiFetch<void>('/responsavel/vincular', {
    method: 'POST',
    body: JSON.stringify({ alunoId }),
  });
}

/** Raw grade shape from backend. */
interface RawGrade {
  id: string;
  disciplina: string;
  professor: string | null;
  bimestres: [number, number, number, number];
}

/** Fetch all subject grades for a given student. */
export async function getNotasDoAluno(alunoId: string): Promise<Grade[]> {
  const raw = await apiFetch<RawGrade[]>(`/responsavel/notas/${alunoId}`);
  return raw.map((g) => ({
    id:         g.id,
    disciplina: g.disciplina,
    professor:  g.professor ?? undefined,
    bimestres:  g.bimestres,
  }));
}

/** Fetch attendance summary for a given student. */
export async function getFrequenciaDoAluno(alunoId: string): Promise<Attendance> {
  return apiFetch<Attendance>(`/responsavel/frequencia/${alunoId}`);
}

/** Fetch notifications for a given student/guardian. */
export async function getNotificacoesDoAluno(alunoId: string): Promise<Notification[]> {
  return apiFetch<Notification[]>(`/responsavel/notificacoes/${alunoId}`);
}

/** Mark a notification as read. */
export async function marcarNotificacaoLida(notifId: string, alunoId: string): Promise<void> {
  await apiFetch<void>(`/responsavel/notificacoes/${notifId}/ler`, {
    method: 'PUT',
    body: JSON.stringify({ alunoId })
  });
}

/** Hide/delete a notification for a specific student. */
export async function ocultarNotificacao(notifId: string, alunoId: string): Promise<void> {
  await apiFetch<void>(`/responsavel/notificacoes/${notifId}/ocultar`, {
    method: 'PUT',
    body: JSON.stringify({ alunoId })
  });
}

/** Fetch full details of a student by ID. */
export async function getStudentDetails(alunoId: string): Promise<any> {
  return apiFetch<any>(`/alunos/${alunoId}`);
}

/** Update a student's profile details. */
export async function updateStudent(alunoId: string, payload: any): Promise<any> {
  return apiFetch<any>(`/alunos/${alunoId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** Upload a document file to GridFS. */
export async function uploadDocument(file: File): Promise<{ id: string; filename: string }> {
  const formData = new FormData();
  formData.append('foto', file); // The backend expects 'foto' field name

  // CSRF Token if present
  const headers: Record<string, string> = {};
  const csrf = getCsrfToken();
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }

  const BASE_URL = import.meta.env.VITE_API_URL || 
    (typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:3001/api');

  const res = await fetch(`${BASE_URL}/upload/photo`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });

  const body = await res.json() as { success: boolean; data?: { id: string; filename: string }; error?: string };
  if (!res.ok || !body.success || !body.data) {
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  }
  return body.data;
}
