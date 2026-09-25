/**
 * LoginResponsavel.tsx — Login próprio do Portal do Responsável (Issue #365)
 *
 * Mesma base visual dos logins de professor, direção e secretaria (#366):
 * `css/ui-base.css` e `css/ui-login.css`, ligados pela classe `ui3` no body
 * enquanto esta tela está montada. O que é só do responsável fica em
 * `styles/login-responsavel.scss`.
 *
 * A tela não tem abas de perfil nem seletor de escola: o responsável já está
 * vinculado à escola pelo cadastro. Também não tem cadastro livre — "Primeiro
 * acesso?" leva à ativação com o código secreto do aluno, que só a secretaria
 * entrega, e é o backend que valida o código e o vínculo.
 */
import { GoogleLogin } from '@react-oauth/google';
import type React from 'react';
import { useEffect, useState } from 'react';
import '../../../css/ui-base.css';
import '../../../css/ui-login.css';
import '../styles/login-responsavel.scss';
import type { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { mascaraTelefone } from '../utils/cadastroResponsavel';
import Toast from './Toast';

type Auth = ReturnType<typeof useAuth>;

interface LoginResponsavelProps {
  auth: Auth;
  toast: { message: string; type: 'success' | 'error' } | null;
  onCloseToast: () => void;
}

/**
 * "Lembrar-me" guarda só o e-mail, e só neste navegador — nunca a senha.
 * Chave própria: a dos logins da equipe (`loginLembrar`) é do mesmo domínio, e
 * um aparelho compartilhado não deve preencher aqui o e-mail de um professor.
 */
const CHAVE_LEMBRAR = 'portalResponsavelLembrar';

function lerEmailLembrado(): string {
  try {
    return localStorage.getItem(CHAVE_LEMBRAR) || '';
  } catch {
    return '';
  }
}

function gravarEmailLembrado(email: string | null) {
  try {
    if (email) localStorage.setItem(CHAVE_LEMBRAR, email);
    else localStorage.removeItem(CHAVE_LEMBRAR);
  } catch {
    // localStorage bloqueado (aba anônima, cookies off): só não lembra.
  }
}

/** Liga a base `ui3` no body só enquanto o login está na tela. */
function useBaseUi3() {
  useEffect(() => {
    document.body.classList.add('ui3', 'ui-login');
    return () => document.body.classList.remove('ui3', 'ui-login');
  }, []);
}

const getPasswordStrength = (pwd: string) => {
  if (!pwd) return { width: '0%', color: 'var(--ui-red)', text: '' };
  if (pwd.length < 6) return { width: '15%', color: 'var(--ui-red)', text: 'Muito curta' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (score <= 1) return { width: '25%', color: 'var(--ui-red)', text: 'Fraca' };
  if (score === 2) return { width: '50%', color: 'var(--ui-amber)', text: 'Média' };
  if (score === 3) return { width: '75%', color: 'var(--ui-blue)', text: 'Boa' };
  return { width: '100%', color: 'var(--ui-accent)', text: 'Forte' };
};

/**
 * Foca o campo assim que ele entra em tela — o primeiro de cada etapa da
 * recuperação de senha. Callback ref no lugar de `autoFocus`: no mount do
 * elemento o foco acompanha a troca de etapa, que é o que a pessoa espera.
 */
const focarAoMontar = (el: HTMLInputElement | null) => el?.focus();

/* ─────────────────────────────── Ícones ─────────────────────────────────── */

const Svg: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    {children}
  </svg>
);

const IcoFamilia = () => (
  <Svg>
    <circle cx="9" cy="7.5" r="3.2" />
    <path d="M3 20c.7-3.4 3-5.2 6-5.2s5.3 1.8 6 5.2" />
    <circle cx="17" cy="9.5" r="2.4" />
    <path d="M15.6 14.6c2.6-.2 4.6 1.4 5.4 4.4" />
  </Svg>
);
const IcoLogo = () => (
  <Svg>
    <path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4l8-4.6Z" />
    <path d="M8 9.6 12 7.4l4 2.2v4.8l-4 2.2-4-2.2V9.6Z" />
    <path d="M12 12v4.6M8 9.6l4 2.4 4-2.4" />
  </Svg>
);
const IcoDesempenho = () => (
  <Svg>
    <circle cx="12" cy="7.5" r="3.5" />
    <path d="M5 20.5c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" />
  </Svg>
);
const IcoComunicado = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </Svg>
);
const IcoCalendario = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h3" />
  </Svg>
);
const IcoEscudo = () => (
  <Svg>
    <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
const IcoEmail = () => (
  <Svg className="ui-control-ico">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </Svg>
);
const IcoCadeado = () => (
  <Svg className="ui-control-ico">
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <path d="M12 14.5v2" />
  </Svg>
);
const IcoUsuario = () => (
  <Svg className="ui-control-ico">
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" />
  </Svg>
);
const IcoTelefone = () => (
  <Svg className="ui-control-ico">
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </Svg>
);
const IcoChave = () => (
  <Svg className="ui-control-ico">
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8.5-8.5M16.5 6.5l2 2M14.5 8.5l1.5 1.5" />
  </Svg>
);
const IcoChaveTitulo = () => (
  <Svg>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8.5-8.5M16.5 6.5l2 2M14.5 8.5l1.5 1.5" />
  </Svg>
);

const IcoOlho = ({ aberto }: { aberto: boolean }) =>
  aberto ? (
    <Svg>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.4 3.4M6.6 6.6C4.5 8 3.1 10 2.5 12c1 2.5 4.5 7 9.5 7 1.6 0 3-.4 4.3-1.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Svg>
  ) : (
    <Svg>
      <path d="M2.5 12C3.5 9.5 7 5 12 5s8.5 4.5 9.5 7c-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
const IcoEntrar = () => (
  <Svg>
    <path d="M10 17l5-5-5-5M15 12H3" />
    <path d="M14 3h4a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-4" />
  </Svg>
);
const IcoSeta = ({ className }: { className?: string }) => (
  <Svg className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
const IcoChevron = () => (
  <Svg className="lg-atalho-seta">
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
const IcoAlerta = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16.5h.01" />
  </Svg>
);
const IcoLua = () => (
  <Svg>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Svg>
);
const IcoSol = () => (
  <Svg>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

/* ───────────────────────────── Ilustração ───────────────────────────────── */

/** Responsável e criança de mochila a caminho da escola, em traço de giz neon. */
const IlustracaoFamilia = () => (
  <div className="lg-ilustra lr-ilustra">
    <svg
      viewBox="0 0 360 300"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* escola ao fundo */}
      <g opacity=".55">
        <path className="lg-ilustra-fundo" d="M196 182V84h148v98" />
        <path d="M184 88 270 42l86 46" />
        <path d="M270 42V14" />
        <path d="M270 14h24l-6 7 6 7h-24" />
        <circle cx="270" cy="66" r="9" />
        <path d="M270 61v5l3 3" />
        <rect x="212" y="102" width="28" height="22" rx="2" />
        <rect x="300" y="102" width="28" height="22" rx="2" />
        <path d="M226 102v22M314 102v22" opacity=".6" />
        <path d="M254 182v-40a16 16 0 0 1 32 0v40" />
        <path d="M270 126v56" opacity=".5" />
      </g>
      <path d="M150 262c40-20 72-44 104-80" opacity=".35" strokeDasharray="2 9" />
      <path d="M22 262h320" opacity=".6" />
      {/* responsável */}
      <circle className="lg-ilustra-fundo" cx="96" cy="112" r="16" />
      <path d="M81 108c2-12 12-18 22-14 6 3 9 9 8 16" opacity=".8" />
      <path
        className="lg-ilustra-fundo"
        d="M72 214c-2-30 0-58 6-74 5-10 12-14 18-14s13 4 18 14c6 16 8 44 6 74Z"
      />
      <path d="M84 214l-3 48M108 214l3 48" />
      <path d="M116 150c6 14 10 28 12 44" />
      {/* criança de mochila */}
      <circle className="lg-ilustra-fundo" cx="150" cy="160" r="12" />
      <path
        className="lg-ilustra-fundo"
        d="M134 222c-1-18 0-34 4-42 3-6 7-8 12-8s9 2 12 8c4 8 5 24 4 42Z"
      />
      <rect className="lg-ilustra-fundo" x="138" y="180" width="25" height="30" rx="7" />
      <path d="M141 191h19M150 191v6" opacity=".7" />
      <path d="M143 222l-2 40M158 222l2 40" />
      <path d="M136 186c-4 4-6 7-8 10" />
      <circle cx="128" cy="196" r="2.5" />
    </svg>
  </div>
);

/* ───────────────────────── Recuperação de senha ─────────────────────────── */

const RecuperarSenha: React.FC<{ auth: Auth }> = ({ auth }) => {
  const {
    setShowForgotModal,
    resetForgotModal,
    forgotStep,
    setForgotStep,
    forgotEmail,
    setForgotEmail,
    forgotLoading,
    forgotCode,
    setForgotCode,
    forgotNewPassword,
    setForgotNewPassword,
    forgotConfirmPassword,
    setForgotConfirmPassword,
    codeCountdown,
    resendCountdown,
    showNewPassword,
    setShowNewPassword,
    handleForgotSendCode,
    handleResendCode,
    handleForgotVerifyCode,
    handleForgotResetPassword,
  } = auth;

  const fechar = () => {
    setShowForgotModal(false);
    resetForgotModal();
  };

  const forca = getPasswordStrength(forgotNewPassword);
  const requisitos = [
    { ok: forgotNewPassword.length >= 8, texto: 'Mínimo 8 caracteres' },
    { ok: /[A-Z]/.test(forgotNewPassword), texto: 'Pelo menos 1 letra maiúscula' },
    { ok: /[0-9]/.test(forgotNewPassword), texto: 'Pelo menos 1 número' },
  ];

  return (
    <div className="modal">
      {/* Fundo do modal, fechável por clique e por Escape (efeito no LoginResponsavel). */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: fundo de modal, fechável por Escape */}
      <div className="backdrop" role="presentation" onClick={fechar} />
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-recuperar-senha"
      >
        <div className="modal-header">
          <h2 className="modal-title" id="titulo-recuperar-senha">
            <span className="lr-modal-ico">
              <IcoChaveTitulo />
            </span>
            Recuperar senha
          </h2>
          <button type="button" className="modal-close" onClick={fechar} aria-label="Fechar">
            &times;
          </button>
        </div>
        <form
          className="modal-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (forgotStep === 1) void handleForgotSendCode();
            else if (forgotStep === 2) void handleForgotVerifyCode();
            else if (forgotStep === 3) void handleForgotResetPassword();
          }}
          noValidate
        >
          <ol className="lr-passos" aria-label={`Etapa ${forgotStep} de 3`}>
            {[1, 2, 3].map((passo) => (
              <li key={passo} className={forgotStep >= passo ? 'lr-passo-feito' : undefined} />
            ))}
          </ol>

          {forgotStep === 1 && (
            <div className="lg-form">
              <p className="lr-texto">
                Informe seu e-mail cadastrado. Enviaremos um código de 6 dígitos para redefinir sua
                senha.
              </p>
              <div className="ui-field">
                <label className="ui-label" htmlFor="campo-e-mail-recuperar">
                  E-mail
                </label>
                <div className="ui-control">
                  <IcoEmail />
                  <input
                    id="campo-e-mail-recuperar"
                    type="email"
                    className="ui-input"
                    placeholder="seu.email@exemplo.com"
                    autoComplete="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    ref={focarAoMontar}
                  />
                </div>
              </div>
              <div className="lr-acoes">
                <button type="button" className="ui-btn" onClick={fechar}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="ui-btn ui-btn--primary ui-on-color"
                  disabled={forgotLoading}
                >
                  {forgotLoading ? 'Enviando…' : 'Enviar código'}
                </button>
              </div>
            </div>
          )}

          {forgotStep === 2 && (
            <div className="lg-form">
              <p className="lr-texto">
                Enviamos um código de recuperação para <strong>{forgotEmail}</strong>. Insira-o
                abaixo.
              </p>
              <div className="ui-field">
                <label className="ui-label" htmlFor="campo-codigo-6-digitos">
                  Código de 6 dígitos
                </label>
                <input
                  id="campo-codigo-6-digitos"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="ui-input lr-codigo"
                  placeholder="000000"
                  value={forgotCode}
                  onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  ref={focarAoMontar}
                />
              </div>
              <p className="lr-texto lr-centro">
                Código válido por{' '}
                <strong className="lr-destaque">
                  {Math.floor(codeCountdown / 60)}:{String(codeCountdown % 60).padStart(2, '0')}
                </strong>
                <br />
                Não recebeu?{' '}
                <button
                  type="button"
                  className="lr-link"
                  onClick={() => void handleResendCode()}
                  disabled={resendCountdown > 0 || forgotLoading}
                >
                  {resendCountdown > 0 ? `Reenviar em ${resendCountdown}s` : 'Reenviar código'}
                </button>
              </p>
              <div className="lr-acoes">
                <button type="button" className="ui-btn" onClick={() => setForgotStep(1)}>
                  Voltar
                </button>
                <button
                  type="submit"
                  className="ui-btn ui-btn--primary ui-on-color"
                  disabled={forgotLoading}
                >
                  {forgotLoading ? 'Verificando…' : 'Verificar código'}
                </button>
              </div>
            </div>
          )}

          {forgotStep === 3 && (
            <div className="lg-form">
              <p className="lr-texto lr-centro">
                <strong className="lr-destaque">Código validado.</strong> Agora escolha a nova
                senha.
              </p>
              <div className="ui-field">
                <label className="ui-label" htmlFor="campo-nova-senha">
                  Nova senha
                </label>
                <div className="ui-control">
                  <IcoCadeado />
                  <input
                    id="campo-nova-senha"
                    type={showNewPassword ? 'text' : 'password'}
                    className="ui-input ui-input--trail"
                    placeholder="Mínimo 8 caracteres"
                    autoComplete="new-password"
                    value={forgotNewPassword}
                    onChange={(e) => setForgotNewPassword(e.target.value)}
                    ref={focarAoMontar}
                  />
                  <button
                    type="button"
                    className="ui-trail-btn"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    aria-label={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    <IcoOlho aberto={showNewPassword} />
                  </button>
                </div>
              </div>
              {forgotNewPassword && (
                <div className="lr-forca">
                  <div className="lr-forca-trilho">
                    <div style={{ width: forca.width, background: forca.color }} />
                  </div>
                  <span>Força: {forca.text}</span>
                </div>
              )}
              <ul className="lr-requisitos">
                {requisitos.map((r) => (
                  <li key={r.texto} className={r.ok ? 'lr-ok' : undefined}>
                    {r.texto}
                  </li>
                ))}
              </ul>
              <div className="ui-field">
                <label className="ui-label" htmlFor="campo-confirmar-senha">
                  Confirmar senha
                </label>
                <div className="ui-control">
                  <IcoCadeado />
                  <input
                    id="campo-confirmar-senha"
                    type={showNewPassword ? 'text' : 'password'}
                    className="ui-input"
                    placeholder="Repita a nova senha"
                    autoComplete="new-password"
                    value={forgotConfirmPassword}
                    onChange={(e) => setForgotConfirmPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="lr-acoes">
                <button type="button" className="ui-btn" onClick={() => setForgotStep(2)}>
                  Voltar
                </button>
                <button
                  type="submit"
                  className="ui-btn ui-btn--primary ui-on-color"
                  disabled={forgotLoading}
                >
                  {forgotLoading ? 'Alterando…' : 'Alterar senha'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

/* ─────────────────────────────── Tela ───────────────────────────────────── */

const LoginResponsavel: React.FC<LoginResponsavelProps> = ({ auth, toast, onCloseToast }) => {
  const {
    authError,
    setAuthError,
    gmailAuthError,
    email,
    setEmail,
    senha,
    setSenha,
    loginLoading,
    showPassword,
    setShowPassword,
    showRegisterPassword,
    setShowRegisterPassword,
    isRegistering,
    setIsRegistering,
    registerForm,
    setRegisterForm,
    showForgotModal,
    setShowForgotModal,
    resetForgotModal,
    handleGoogleLogin,
    handleLogin,
    handleRegister,
  } = auth;

  useBaseUi3();
  const { tema, alternar } = useTheme();
  const [lembrar, setLembrar] = useState(false);

  // "Lembrar-me": o e-mail guardado volta preenchido, com a caixa marcada.
  useEffect(() => {
    const lembrado = lerEmailLembrado();
    if (!lembrado) return;
    setEmail(lembrado);
    setLembrar(true);
  }, [setEmail]);

  // Escape fecha a recuperação de senha; o clique no fundo também fecha.
  useEffect(() => {
    if (!showForgotModal) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowForgotModal(false);
      resetForgotModal();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [showForgotModal, setShowForgotModal, resetForgotModal]);

  const entrar = (e: React.FormEvent) => {
    gravarEmailLembrado(lembrar ? email.trim() : null);
    void handleLogin(e);
  };

  const trocarTela = (ativar: boolean) => {
    setAuthError(null);
    setIsRegistering(ativar);
  };

  const erro = authError || gmailAuthError;

  return (
    <div className="lg-page lr-page">
      <Toast toast={toast} onClose={onCloseToast} />

      <div className="lg-topo">
        <button
          type="button"
          className="ui-icon-btn ui-theme-toggle"
          onClick={alternar}
          aria-pressed={tema === 'light'}
          aria-label={tema === 'light' ? 'Usar tema escuro' : 'Usar tema claro'}
        >
          <span className="ui-ico-lua">
            <IcoLua />
          </span>
          <span className="ui-ico-sol">
            <IcoSol />
          </span>
        </button>
      </div>

      {/* Painel do portal */}
      <aside className="lg-hero lr-hero" aria-label="Sobre o Portal do Responsável">
        <a href="/" className="lg-marca">
          <span className="lg-marca-ico">
            <IcoLogo />
          </span>
          <span>
            <span className="lg-marca-nome">
              Sistema <span className="lr-acento">Escolar</span>
            </span>
            <span className="lg-marca-sub">Conectando escola, família e futuro.</span>
          </span>
        </a>

        <div className="lg-hero-corpo">
          <p className="lg-titulo ui-display">
            Bem-vindo, <em>Responsável!</em>
          </p>
          <p className="lg-lead">
            Acompanhe o desenvolvimento do seu filho, receba informações importantes e mantenha o
            contato com a escola de forma simples e segura.
          </p>
          <ul className="lg-beneficios lr-beneficios">
            <li>
              <span className="lg-beneficio-ico">
                <IcoDesempenho />
              </span>
              <span>
                <strong>Acompanhe o desempenho</strong>
                <small>Consulte notas, avaliações e evolução escolar.</small>
              </span>
            </li>
            <li>
              <span className="lg-beneficio-ico">
                <IcoComunicado />
              </span>
              <span>
                <strong>Receba comunicados</strong>
                <small>Fique informado sobre avisos e acontecimentos da escola.</small>
              </span>
            </li>
            <li>
              <span className="lg-beneficio-ico">
                <IcoCalendario />
              </span>
              <span>
                <strong>Consulte a rotina escolar</strong>
                <small>Acesse calendário, atividades e eventos.</small>
              </span>
            </li>
          </ul>
        </div>

        <p className="lg-lgpd">
          <IcoEscudo />
          <span>
            <strong>Seus dados estão protegidos</strong>
            <br />
            Segurança e privacidade em conformidade com a LGPD.
          </span>
        </p>

        <IlustracaoFamilia />

        <div className="lg-traco" aria-hidden="true">
          <svg viewBox="0 0 800 400" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="lrTracoCor" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="var(--ui-accent)" stopOpacity="0" />
                <stop offset=".35" stopColor="var(--ui-accent)" />
                <stop offset=".8" stopColor="var(--ui-cyan)" />
                <stop offset="1" stopColor="var(--ui-violet)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              className="lg-traco-brilho"
              stroke="url(#lrTracoCor)"
              d="M330 440C470 330 590 250 830 170"
            />
            <path
              className="lg-traco-linha"
              stroke="url(#lrTracoCor)"
              d="M330 440C470 330 590 250 830 170"
            />
          </svg>
        </div>
      </aside>

      {/* Acesso */}
      <main className="lg-lado">
        <div className="lg-card">
          <div className="lg-card-cabeca">
            <span className="lg-card-ico">
              <IcoFamilia />
            </span>
            <h1 className="lg-card-titulo ui-display lr-card-titulo">
              {isRegistering ? (
                <>
                  Ativar <span>acesso</span>
                </>
              ) : (
                <>
                  Portal do <span>Responsável</span>
                </>
              )}
            </h1>
            <p className="lg-card-sub">
              {isRegistering
                ? 'Use o código secreto do aluno, entregue pela secretaria da escola.'
                : 'Acesse sua conta para acompanhar a vida escolar do seu filho.'}
            </p>
          </div>

          {!isRegistering && (
            <p className="lr-perfil">
              <IcoFamilia />
              Responsável
            </p>
          )}

          {erro && (
            <div className="lr-erro" role="alert">
              <IcoAlerta />
              {erro}
            </div>
          )}

          {isRegistering ? (
            <form onSubmit={handleRegister} className="lg-form" noValidate>
              <div className="ui-field">
                <label className="ui-label" htmlFor="campo-nome-completo">
                  Nome completo
                </label>
                <div className="ui-control">
                  <IcoUsuario />
                  <input
                    id="campo-nome-completo"
                    type="text"
                    className="ui-input"
                    placeholder="Seu nome"
                    autoComplete="name"
                    value={registerForm.nome}
                    onChange={(e) => setRegisterForm({ ...registerForm, nome: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="ui-field">
                <label className="ui-label" htmlFor="campo-e-mail">
                  E-mail
                </label>
                <div className="ui-control">
                  <IcoEmail />
                  <input
                    id="campo-e-mail"
                    type="email"
                    className="ui-input"
                    placeholder="seu.email@exemplo.com"
                    autoComplete="email"
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="ui-field">
                <label className="ui-label" htmlFor="campo-telefone">
                  Telefone celular
                </label>
                <div className="ui-control">
                  <IcoTelefone />
                  <input
                    id="campo-telefone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    className="ui-input"
                    placeholder="(00) 00000-0000"
                    value={registerForm.telefone}
                    onChange={(e) =>
                      setRegisterForm({
                        ...registerForm,
                        telefone: mascaraTelefone(e.target.value),
                      })
                    }
                    required
                  />
                </div>
              </div>
              <div className="ui-field">
                <label className="ui-label" htmlFor="campo-senha">
                  Senha
                </label>
                <div className="ui-control">
                  <IcoCadeado />
                  <input
                    id="campo-senha"
                    type={showRegisterPassword ? 'text' : 'password'}
                    className="ui-input ui-input--trail"
                    placeholder="Crie uma senha forte"
                    autoComplete="new-password"
                    value={registerForm.senha}
                    onChange={(e) => setRegisterForm({ ...registerForm, senha: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    className="ui-trail-btn"
                    onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                    aria-label={showRegisterPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    <IcoOlho aberto={showRegisterPassword} />
                  </button>
                </div>
              </div>
              <div className="ui-field">
                <label className="ui-label" htmlFor="campo-codigo-aluno">
                  Código secreto do aluno
                </label>
                <div className="ui-control">
                  <IcoChave />
                  <input
                    id="campo-codigo-aluno"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    className="ui-input"
                    placeholder="Ex: A1B2C3"
                    value={registerForm.codigoSecreto}
                    onChange={(e) =>
                      setRegisterForm({
                        ...registerForm,
                        codigoSecreto: e.target.value.toUpperCase(),
                      })
                    }
                    aria-describedby="ajuda-codigo-aluno"
                    required
                  />
                </div>
                <small id="ajuda-codigo-aluno" className="lr-ajuda">
                  Fornecido pela secretaria da escola. É ele que vincula seu filho à sua conta.
                </small>
              </div>
              {/* Ciência da Política de Privacidade (Issue #414): obrigatória, não afirma autorização */}
              <label htmlFor="campo-aceite-politica" className="ui-check lr-aceite">
                <input
                  id="campo-aceite-politica"
                  type="checkbox"
                  checked={registerForm.aceitePolitica}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, aceitePolitica: e.target.checked })
                  }
                  required
                />
                <span>
                  Li e tomei ciência da{' '}
                  <a
                    href="/html/politica-privacidade.html"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Política de Privacidade
                  </a>
                  .{' '}
                  <span style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.75rem' }}>
                    (obrigatório)
                  </span>
                </span>
              </label>
              {/* Consentimento específico educacional (Issue #414): opcional — recusar não impede o cadastro */}
              <label
                htmlFor="campo-consent-educacional"
                className="ui-check lr-aceite"
                style={{ marginTop: '0.5rem' }}
              >
                <input
                  id="campo-consent-educacional"
                  type="checkbox"
                  checked={Boolean(registerForm.consentimentoEducacional)}
                  onChange={(e) =>
                    setRegisterForm({
                      ...registerForm,
                      consentimentoEducacional: e.target.checked,
                    })
                  }
                />
                <span>
                  Autorizo o tratamento dos meus dados para fins educacionais.{' '}
                  <span style={{ color: 'var(--color-text-muted, #94a3b8)', fontSize: '0.75rem' }}>
                    (opcional)
                  </span>
                </span>
              </label>
              <button
                type="submit"
                className="ui-btn ui-btn--primary ui-btn--block ui-on-color"
                disabled={loginLoading}
                aria-busy={loginLoading}
              >
                {loginLoading ? 'Ativando…' : 'Ativar acesso'}
              </button>
              <p className="lg-links">
                Já tem acesso?
                <button type="button" className="lr-link" onClick={() => trocarTela(false)}>
                  Entrar
                </button>
              </p>
            </form>
          ) : (
            <>
              <form onSubmit={entrar} className="lg-form" noValidate>
                <div className="ui-field">
                  <label htmlFor="email" className="ui-label">
                    E-mail
                  </label>
                  <div className="ui-control">
                    <IcoEmail />
                    <input
                      id="email"
                      type="email"
                      className="ui-input"
                      placeholder="seu.email@exemplo.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>
                <div className="ui-field">
                  <label htmlFor="senha" className="ui-label">
                    Senha
                  </label>
                  <div className="ui-control">
                    <IcoCadeado />
                    <input
                      id="senha"
                      type={showPassword ? 'text' : 'password'}
                      className="ui-input ui-input--trail"
                      placeholder="Digite sua senha"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="ui-trail-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      <IcoOlho aberto={showPassword} />
                    </button>
                  </div>
                </div>
                <div className="lg-opcoes">
                  <label className="ui-check" htmlFor="lembrar-me">
                    <input
                      id="lembrar-me"
                      type="checkbox"
                      checked={lembrar}
                      onChange={(e) => {
                        setLembrar(e.target.checked);
                        // Desmarcar apaga na hora o que estava guardado.
                        if (!e.target.checked) gravarEmailLembrado(null);
                      }}
                    />
                    Lembrar-me
                  </label>
                  <button
                    type="button"
                    className="lr-link"
                    onClick={() => setShowForgotModal(true)}
                  >
                    Esqueci minha senha?
                  </button>
                </div>
                <button
                  type="submit"
                  className="ui-btn ui-btn--primary ui-btn--block ui-on-color"
                  disabled={loginLoading}
                  aria-busy={loginLoading}
                >
                  {loginLoading ? (
                    'Entrando…'
                  ) : (
                    <>
                      <IcoEntrar />
                      Entrar
                      <IcoSeta className="lr-seta" />
                    </>
                  )}
                </button>
              </form>

              <p className="lg-divisor">ou</p>

              <div className="lg-secundarios">
                {/* Botão oficial do Google: devolve o ID token (`credential`), que o
                    servidor valida contra o client ID do portal (Issue #387). */}
                <div className="lr-google" aria-busy={loginLoading}>
                  <GoogleLogin
                    onSuccess={(resposta) => {
                      if (resposta.credential) void handleGoogleLogin(resposta.credential);
                      else setAuthError('O Google não devolveu a credencial. Tente novamente.');
                    }}
                    onError={() =>
                      setAuthError('O login com Google foi cancelado ou falhou. Tente novamente.')
                    }
                    text="continue_with"
                    shape="rectangular"
                    size="large"
                    width="380"
                    theme={tema === 'light' ? 'outline' : 'filled_black'}
                  />
                </div>

                <button
                  type="button"
                  className="lg-atalho lr-primeiro-acesso"
                  onClick={() => trocarTela(true)}
                >
                  <span className="lg-atalho-ico">
                    <IcoEscudo />
                  </span>
                  <span className="lg-atalho-texto">
                    <strong>Primeiro acesso?</strong>
                    <small>
                      Entre em contato com a secretaria da escola para obter ou ativar seus dados de
                      acesso.
                    </small>
                  </span>
                  <IcoChevron />
                </button>
              </div>
            </>
          )}
        </div>

        <p className="lg-lgpd-mobile">
          <IcoEscudo />
          Seus dados estão protegidos pela Lei Geral de Proteção de Dados (LGPD).
        </p>
      </main>

      {showForgotModal && <RecuperarSenha auth={auth} />}
    </div>
  );
};

export default LoginResponsavel;
