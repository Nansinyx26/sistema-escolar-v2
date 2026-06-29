/**
 * services/apiService.ts
 * HTTP client that talks to the existing school backend (/api/*).
 * Authentication uses the same JWT cookie mechanism the backend already
 * handles — the browser sends credentials automatically via `credentials: 'include'`.
 *
 * All methods throw ApiError on failure so callers can show appropriate UI.
 */

import type { Student, Grade, Attendance, Notification, DocumentoArquivo, AuthUser, HeatmapEntry, BIInsights } from '../types';

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
  : '/api';

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

const REQUEST_TIMEOUT_MS = 45_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('O servidor demorou para responder. Tente novamente.', 408);
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
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

  const res = await fetchWithTimeout(`${BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });

  const body = await res.json() as { success: boolean; data?: T; user?: T; error?: string };

  if (!res.ok || !body.success) {
    if (res.status === 401 && !path.includes('/auth/')) {
        window.location.href = '/login.html?expired=true';
    }
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

// ─── Auth ─────────────────────────────────────────────────────────────────────

/** Login with email + password – sets JWT cookie on the browser. */
export async function login(payload: LoginPayload): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ ...payload, portal: 'responsavel' }),
  });
}

/** Login via Google OAuth access token – sets JWT cookie on the browser. */
export async function googleLogin(accessToken: string): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/google-login', {
    method: 'POST',
    body: JSON.stringify({ token: accessToken }),
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

/** Updates user's own profile (such as name and telephone). CPF is optional for parent accounts. */
export async function updateProfile(payload: { 
  nome?: string; 
  cpf?: string; 
  telefone?: string;
  foto?: string;
  consentimentoAceiteEm?: boolean;
  notificacoesPreferencias?: {
    portal: boolean;
    push: boolean;
    email: boolean;
  }
}): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** 
 * Envia uma foto de perfil em formato Base64 para o servidor.
 * Ela é convertida para WebP no backend e armazenada diretamente no documento do usuário.
 */
export async function uploadManualPhoto(fotoB64: string): Promise<AuthUser> {
  return apiFetch<AuthUser>('/usuarios/foto', {
    method: 'PUT',
    body: JSON.stringify({ foto: fotoB64 }),
  });
}

/** 
 * Remove a foto de perfil manual do usuário.
 * O sistema voltará a usar fotoGoogle ou iniciais.
 */
export async function removeManualPhoto(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/usuarios/foto', {
    method: 'DELETE',
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
    _id:             r.id,
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

/** Search for a student by their secret code (without linking yet). */
export async function buscarAlunoPorCodigoSecreto(codigo: string): Promise<any> {
  return apiFetch<any>(`/responsavel/buscar-aluno/${codigo}`);
}

/** Search for a student to link. */
export async function buscarAlunosParaVinculo(query: string): Promise<any[]> {
  return apiFetch<any[]>(`/responsavel/buscar-aluno?q=${encodeURIComponent(query)}`);
}

/** Link a student to the logged-in guardian. */
export async function vincularAluno(codigoSecreto: string): Promise<void> {
  await apiFetch<void>('/responsavel/vincular', {
    method: 'POST',
    body: JSON.stringify({ codigoSecreto }),
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

/** Get Student Bulletin PDF blob. */
export async function getBoletimPdf(alunoId: string): Promise<Blob> {
  const res = await fetchWithTimeout(`${BASE_URL}/relatorios/boletim/${alunoId}`, {
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? 'Erro ao gerar PDF', res.status);
  }
  return res.blob();
}

/** Ask the IA Chatbot. */
export async function postChatbotMessage(
  message: string,
  alunoId?: string
): Promise<{ response: string; alunoId?: string | null; options?: { label: string; alunoId: string }[] }> {
  return apiFetch<{ response: string; alunoId?: string | null; options?: { label: string; alunoId: string }[] }>('/ia/chatbot', {
    method: 'POST',
    body: JSON.stringify({ message, alunoId }),
  });
}

/** Get IA Pedagogical Analysis (Traffic Light). */
export async function getIAAnalysis(alunoId: string): Promise<any> {
  return apiFetch<any>(`/ia/analise/${alunoId}`);
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

/** Upload document files (PDF, JPG, PNG) to GridFS. */
export async function uploadDocumentos(files: File[]): Promise<DocumentoArquivo[]> {
  const formData = new FormData();
  files.forEach(f => formData.append('documentos', f));

  const headers: Record<string, string> = {};
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const BASE_URL = import.meta.env.DEV
    ? (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
    : '/api';

  const res = await fetch(`${BASE_URL}/upload/documento`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });

  const body = await res.json() as { success: boolean; data?: DocumentoArquivo[]; error?: string };
  if (!res.ok || !body.success || !body.data) {
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  }
  return body.data;
}

/** Update guardian data and authorizations for a student. */
export async function updateAlunoDados(alunoId: string, payload: Record<string, unknown>): Promise<Student> {
  const res = await apiFetch<{ data: Student }>(`/responsavel/aluno/${alunoId}/dados`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

/** Register uploaded documents on student record. */
export async function registrarDocumentos(alunoId: string, arquivos: DocumentoArquivo[]): Promise<void> {
  await apiFetch(`/responsavel/aluno/${alunoId}/documentos`, {
    method: 'POST',
    body: JSON.stringify({ arquivos }),
  });
}

/** Mark tutorial as completed or restart. */
export async function updateTutorial(payload: {
  tutorialProfessorConcluido?: boolean;
  tutorialResponsavelConcluido?: boolean;
  reiniciar?: boolean;
}): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/tutorial', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** @deprecated Use uploadDocumentos instead */
export async function uploadDocument(file: File): Promise<{ id: string; filename: string }> {
  const [result] = await uploadDocumentos([file]);
  return { id: result.gridfsId, filename: result.nome };
}

// ─── Comunicados & Comentários ──────────────────────────────────────────────

/** Fetch all announcements visible to the user. */
export async function getComunicados(): Promise<import('../types').Comunicado[]> {
  return apiFetch<import('../types').Comunicado[]>('/comunicados');
}

/** Mark an announcement as read. */
export async function marcarComunicadoLido(id: string): Promise<void> {
  await apiFetch<void>(`/comunicados/${id}/read`, { method: 'POST' });
}

/** Fetch comments for an announcement or notification. */
export async function getComentarios(comunicadoId?: string, notificacaoId?: string): Promise<import('../types').Comentario[]> {
  const path = comunicadoId 
    ? `/comentarios/comunicado/${comunicadoId}` 
    : `/comentarios/notificacao/${notificacaoId}`;
  return apiFetch<import('../types').Comentario[]>(path);
}

/** Add a comment or reply to an announcement or notification. */
export async function addComentario(
  comunicadoId?: string, 
  texto?: string, 
  parentId: string | null = null, 
  audioUrl?: string,
  notificacaoId?: string
): Promise<import('../types').Comentario> {
  return apiFetch<import('../types').Comentario>('/comentarios', {
    method: 'POST',
    body: JSON.stringify({ comunicadoId, notificacaoId, texto, parentId, audioUrl }),
  });
}

/** Upload a profile photo to GridFS and return the file ID. */
export async function uploadPhoto(file: File): Promise<{ id: string; filename: string }> {
  const formData = new FormData();
  formData.append('foto', file);

  const headers: Record<string, string> = {};
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetchWithTimeout(`${BASE_URL}/upload/photo`, {
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

/** Upload audio blob to backend. */
export async function uploadAudio(blob: Blob): Promise<{ id: string; url: string }> {
  const formData = new FormData();
  formData.append('audio', blob, 'recording.webm');

  const headers: Record<string, string> = {};
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(`${BASE_URL}/audio/upload`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });

  const body = await res.json() as { success: boolean; data?: { id: string; url: string }; error?: string };
  if (!res.ok || !body.success || !body.data) {
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  }
  return body.data;
}

/** Delete a comment. */
export async function deleteComentario(id: string): Promise<void> {
  await apiFetch<void>(`/comentarios/${id}`, { method: 'DELETE' });
}

/** Update a comment. */
export async function updateComentario(id: string, texto: string): Promise<import('../types').Comentario> {
  return apiFetch<import('../types').Comentario>(`/comentarios/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ texto }),
  });
}

/** Get TTS Audio blob for announcement narration. Gênero fixo em 'male' conforme padronização. */
export async function getTTSAudio(text: string, gender: 'male' | 'female' = 'male', provider: string = 'google-cloud'): Promise<Blob> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetchWithTimeout(`${BASE_URL}/tts`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ text, gender, provider }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const errorMsg = body.message || body.error || 'Erro ao gerar áudio';
    throw new ApiError(errorMsg, res.status);
  }
  return res.blob();
}

/** Get Global Pedagogical Heatmap Data. */
export async function getHeatmapData(): Promise<HeatmapEntry[]> {
  return apiFetch<HeatmapEntry[]>('/ia/mapa-calor');
}

/** Get Global IA Insights for the school. */
export async function getBIInsights(): Promise<BIInsights> {
  return apiFetch<BIInsights>('/ia/insights-global');
}

/** Get VAPID public key for push notifications. */
export async function getVapidPublicKey(): Promise<{ publicKey: string }> {
  return apiFetch<{ publicKey: string }>('/notifications/realtime/vapid-public-key');
}

/** Subscribe to push notifications. */
export async function subscribePush(subscription: any): Promise<void> {
  await apiFetch<void>('/notifications/realtime/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}
