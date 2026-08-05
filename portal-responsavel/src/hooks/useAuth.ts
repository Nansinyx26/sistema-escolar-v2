import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getMe, googleLogin, login, logout as apiLogout } from '../services/apiService';
import { useGmailAuth } from './useGmailAuth';
import type { AuthUser } from '../types';

type Toast = { message: string; type: 'success' | 'error' } | null;

interface RegisterForm {
  nome: string;
  email: string;
  senha: string;
  cpf: string;
  telefone: string;
}

interface UseAuthOptions {
  cleanApiUrl: string;
  onToast: (toast: Toast) => void;
}

export function useAuth({ cleanApiUrl, onToast }: UseAuthOptions) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerForm, setRegisterForm] = useState<RegisterForm>({
    nome: '',
    email: '',
    senha: '',
    cpf: '',
    telefone: '',
  });
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2 | 3>(1);
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [codeCountdown, setCodeCountdown] = useState(15 * 60);
  const [resendCountdown, setResendCountdown] = useState(60);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const codeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    user: gmailUser,
    loginWithGmail,
    logout: gmailLogout,
    error: gmailAuthError,
  } = useGmailAuth();

  const clearForgotTimers = useCallback(() => {
    if (codeTimerRef.current) {
      clearInterval(codeTimerRef.current);
      codeTimerRef.current = null;
    }
    if (resendTimerRef.current) {
      clearInterval(resendTimerRef.current);
      resendTimerRef.current = null;
    }
  }, []);

  const startTimers = useCallback(() => {
    clearForgotTimers();
    setCodeCountdown(15 * 60);
    setResendCountdown(60);

    codeTimerRef.current = setInterval(() => {
      setCodeCountdown((prev) => {
        if (prev <= 1) {
          if (codeTimerRef.current) clearInterval(codeTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    resendTimerRef.current = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          if (resendTimerRef.current) clearInterval(resendTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearForgotTimers]);

  const resetForgotModal = useCallback(() => {
    setForgotStep(1);
    setForgotEmail('');
    setForgotCode('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setForgotLoading(false);
    setShowNewPassword(false);
    clearForgotTimers();
  }, [clearForgotTimers]);

  useEffect(() => {
    getMe()
      .then((user) => setAuthUser(user))
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => () => clearForgotTimers(), [clearForgotTimers]);

  const handleForgotSendCode = useCallback(async () => {
    if (!forgotEmail) {
      onToast({ message: 'Informe seu e-mail', type: 'error' });
      return;
    }

    setForgotLoading(true);
    try {
      const response = await fetch(`${cleanApiUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await response.json();
      if (data.success) {
        onToast({ message: data.message || 'Código enviado! Verifique seu e-mail.', type: 'success' });
        setForgotStep(2);
        startTimers();
      } else {
        onToast({ message: data.error || 'Erro ao enviar código', type: 'error' });
      }
    } catch {
      onToast({ message: 'Erro de conexão', type: 'error' });
    } finally {
      setForgotLoading(false);
    }
  }, [cleanApiUrl, forgotEmail, onToast, startTimers]);

  const handleResendCode = useCallback(async () => {
    setForgotLoading(true);
    try {
      const response = await fetch(`${cleanApiUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await response.json();
      if (data.success) {
        onToast({ message: 'Novo código enviado!', type: 'success' });
        setForgotCode('');
        startTimers();
      } else {
        onToast({ message: data.error || 'Erro ao reenviar', type: 'error' });
      }
    } catch {
      onToast({ message: 'Erro de conexão', type: 'error' });
    } finally {
      setForgotLoading(false);
    }
  }, [cleanApiUrl, forgotEmail, onToast, startTimers]);

  const handleForgotVerifyCode = useCallback(async () => {
    if (!forgotCode || forgotCode.length !== 6) {
      onToast({ message: 'Insira o código de 6 dígitos', type: 'error' });
      return;
    }

    setForgotLoading(true);
    try {
      const response = await fetch(`${cleanApiUrl}/api/auth/verify-recovery-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail, codigo: forgotCode }),
      });
      const data = await response.json();
      if (data.success) {
        onToast({ message: 'Código verificado!', type: 'success' });
        clearForgotTimers();
        setForgotStep(3);
      } else {
        onToast({ message: data.error || 'Código inválido', type: 'error' });
      }
    } catch {
      onToast({ message: 'Erro de conexão', type: 'error' });
    } finally {
      setForgotLoading(false);
    }
  }, [cleanApiUrl, clearForgotTimers, forgotCode, forgotEmail, onToast]);

  const handleForgotResetPassword = useCallback(async () => {
    if (forgotNewPassword.length < 8) {
      onToast({ message: 'A senha deve ter no mínimo 8 caracteres', type: 'error' });
      return;
    }
    if (!/[A-Z]/.test(forgotNewPassword)) {
      onToast({ message: 'A senha deve conter pelo menos 1 letra maiúscula', type: 'error' });
      return;
    }
    if (!/[0-9]/.test(forgotNewPassword)) {
      onToast({ message: 'A senha deve conter pelo menos 1 número', type: 'error' });
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      onToast({ message: 'As senhas não coincidem', type: 'error' });
      return;
    }

    setForgotLoading(true);
    try {
      const response = await fetch(`${cleanApiUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail, codigo: forgotCode, password: forgotNewPassword }),
      });
      const data = await response.json();
      if (data.success) {
        onToast({ message: 'Senha alterada com sucesso! Faça login.', type: 'success' });
        setShowForgotModal(false);
        resetForgotModal();
      } else {
        onToast({ message: data.error || 'Erro ao alterar senha', type: 'error' });
      }
    } catch {
      onToast({ message: 'Erro de conexão', type: 'error' });
    } finally {
      setForgotLoading(false);
    }
  }, [cleanApiUrl, forgotCode, forgotConfirmPassword, forgotEmail, forgotNewPassword, onToast, resetForgotModal]);

  const handleGoogleLogin = useCallback(async () => {
    setLoginLoading(true);
    setAuthError(null);
    try {
      const googleProfile = await loginWithGmail();
      const user = await googleLogin(googleProfile.accessToken);
      setAuthUser(user);
      onToast({ message: 'Login Google realizado com sucesso!', type: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na autenticação Google';
      setAuthError(message);
      onToast({ message, type: 'error' });
    } finally {
      setLoginLoading(false);
    }
  }, [loginWithGmail, onToast]);

  const handleLogin = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !senha) return;

    setLoginLoading(true);
    setAuthError(null);
    try {
      const user = await login({ email, senha });
      setAuthUser(user);
      onToast({ message: 'Login realizado com sucesso!', type: 'success' });
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : 'Erro de conexão. Verifique se o servidor está ativo.';
      setAuthError(message);
      onToast({ message, type: 'error' });
    } finally {
      setLoginLoading(false);
    }
  }, [email, onToast, senha]);

  const handleRegister = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginLoading(true);
    setAuthError(null);
    try {
      const response = await fetch(`${cleanApiUrl}/api/auth/register-responsavel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(registerForm),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao criar conta');

      onToast({ message: 'Conta criada com sucesso! Entrando...', type: 'success' });
      const user = await login({ email: registerForm.email, senha: registerForm.senha });
      setAuthUser(user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao criar conta.';
      setAuthError(message);
      onToast({ message, type: 'error' });
    } finally {
      setLoginLoading(false);
    }
  }, [cleanApiUrl, onToast, registerForm]);

  const handleLogout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {}
    gmailLogout();
    setAuthUser(null);
    setEmail('');
    setSenha('');
    setAuthError(null);
  }, [gmailLogout]);

  const value = useMemo(() => ({
    authUser,
    setAuthUser,
    authLoading,
    authError,
    setAuthError,
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
    forgotEmail,
    setForgotEmail,
    forgotLoading,
    forgotStep,
    setForgotStep,
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
    gmailUser,
    gmailAuthError,
    resetForgotModal,
    handleForgotSendCode,
    handleResendCode,
    handleForgotVerifyCode,
    handleForgotResetPassword,
    handleGoogleLogin,
    handleLogin,
    handleRegister,
    handleLogout,
  }), [
    authError,
    authLoading,
    authUser,
    codeCountdown,
    email,
    forgotCode,
    forgotConfirmPassword,
    forgotEmail,
    forgotLoading,
    forgotNewPassword,
    forgotStep,
    gmailAuthError,
    gmailUser,
    handleForgotResetPassword,
    handleForgotSendCode,
    handleForgotVerifyCode,
    handleGoogleLogin,
    handleLogin,
    handleLogout,
    handleRegister,
    handleResendCode,
    isRegistering,
    loginLoading,
    registerForm,
    resendCountdown,
    resetForgotModal,
    senha,
    showForgotModal,
    showNewPassword,
    showPassword,
    showRegisterPassword,
  ]);

  return value;
}