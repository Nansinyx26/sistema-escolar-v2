/**
 * types/index.ts — Guardian & authorization types
 */

export type TipoResponsavel = 'Mãe' | 'Pai' | 'Responsável Legal' | 'Avó' | 'Avô' | 'Tutor(a)' | 'Outro';

export interface ResponsavelDados {
  nome: string;
  tipo?: TipoResponsavel;
  parentesco?: string;
  cpf?: string;
  telefone?: string;
  whatsapp?: string;
  email?: string;
  responsabilidadeFinanceira?: 'Sim' | 'Não' | 'Parcial';
  autorizadoBusca?: boolean;
}

export interface PessoaAutorizada {
  nome: string;
  parentesco?: string;
  telefone?: string;
  documento?: string;
}

export interface AutorizacoesEscolares {
  tratamentoOdontologico?: boolean | null;
  tratamentoMedicoEmergencial?: boolean | null;
  testagemAcuidade?: boolean | null;
  atividadesFisicas?: boolean | null;
  atividadesExtraclasse?: boolean | null;
  conducaoEscolar?: boolean | null;
  motoristaNome?: string;
  motoristaTelefone?: string;
  antitermico?: boolean | null;
  medicamentoNome?: string;
  medicamentoDose?: string;
}

export type FichaDocumentoStatus = 'pendente' | 'enviado' | 'conferido';

export interface DocumentoArquivo {
  id: string;
  nome: string;
  tipo: string;
  gridfsId: string;
  enviadoEm: string;
}

export interface DocumentosAluno {
  arquivos?: DocumentoArquivo[];
  ultimoEnvio?: string;
  conferidoEm?: string;
  conferidoPor?: string;
}

export interface Student {
  id: string;
  _id: string;
  nome: string;
  sobrenome: string;
  matricula: string;
  turma: string;
  dataNascimento: string;
  foto?: string;
  escolaNome?: string;
  responsavelId: string;
  cpfAluno?: string;
  telefone?: string;
  endereco?: Record<string, string>;
  nacionalidade?: string;
  etnia?: string;
  religiao?: string;
  responsavelDados?: ResponsavelDados;
  responsaveis?: ResponsavelDados[];
  guardaLegal?: string;
  pessoasAutorizadasRetirada?: PessoaAutorizada[];
  autorizacoesEscolares?: AutorizacoesEscolares;
  fichaDocumentoStatus?: FichaDocumentoStatus;
  alergiasAlimentos?: string;
  alergiasRemedio?: string;
  planoSaude?: string;
  deficiencia?: string;
  pcd?: boolean;
  nivel?: string;
  condicao?: string;
  observacoes?: string;
  documentos?: DocumentosAluno | DocumentoArquivo[];
  lgpdConsentimento?: Record<string, unknown>;
}

export interface Grade {
  id: string;
  disciplina: string;
  // null = bimestre sem nota lançada (exibido como "—", ignorado na média)
  bimestres: [number | null, number | null, number | null, number | null];
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
  dataCriacao: string;
  lido: boolean;
  destinatarios: 'todos' | string;
  icon: string;
  prioridade?: 'normal' | 'media' | 'alta' | 'importante' | 'urgente' | string;
  criadoPor?: string;
  comunicadoId?: string;
  notificacaoId?: string;
  corpoHtml?: string;
  comentariosCount?: number;
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
  loginWithGmail: () => Promise<GmailUser>;
  logout: () => void;
}

export interface AuthUser {
  id: string;
  nome: string;
  email: string;
  telefone?: string;
  perfil: string;
  foto?: string;
  fotoGoogle?: string;
  loginGoogle?: boolean;
  consentimentoAceiteEm?: string;
  profileCompleted?: boolean;
  tutorialResponsavelConcluido?: boolean;
  tutorialProfessorConcluido?: boolean;
  notificacoesPreferencias?: {
    portal: boolean;
    push: boolean;
    email: boolean;
  };
  criadoEm?: string;
}

export interface Comunicado {
  _id: string;
  titulo: string;
  conteudo: string;
  imagens: string[];
  videos?: string[];
  audios?: string[];
  documentos?: { nome: string; url: string; tipo: string }[];
  diretorId: string;
  diretorNome: string;
  diretorFoto?: string;
  destinatarios: string[];
  visualizacoes: string[];
  reacoesCount: number;
  comentariosCount: number;
  dataCriacao: string;
  dataAtualizacao: string;
  ativo: boolean;
}

export interface Comentario {
  _id: string;
  comunicadoId?: string;
  notificacaoId?: string;
  usuarioId: string;
  usuarioNome: string;
  usuarioFoto?: string;
  usuarioPerfil: string;
  texto?: string;
  audioUrl?: string;
  parentId: string | null;
  dataCriacao: string;
  dataAtualizacao: string;
  ativo: boolean;
}

// ─── BI Types ─────────────────────────────────────────────────────────────────

export interface HeatmapEntry {
  materia: string;
  turma: string;
  media: string;
  totalNotas: number;
}

export interface BIInsights {
  sumario: string;
  mediaEscola?: string;
  alunosRisco?: number;
  totalAlunos?: number;
  materiaCritica?: string;
}
