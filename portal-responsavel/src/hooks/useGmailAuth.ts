/**
 * hooks/useGmailAuth.ts
 * Gerencia autenticação Google OAuth 2.0 via Google Identity Services.
 * Requer GoogleOAuthProvider no componente pai (main.tsx).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useGoogleLogin, googleLogout } from '@react-oauth/google';
import type { GmailUser, UseGmailAuthReturn } from '../types';

const STORAGE_KEY = 'gmailUser';

const PLACEHOLDER_CLIENT_IDS = new Set([
  'seu_client_id.apps.googleusercontent.com',
  '',
]);

function resolveClientId(): string | undefined {
  const envVars = [
    import.meta.env.VITE_GMAIL_CLIENT_ID,
    import.meta.env.VITE_GMAIL_ID,
    import.meta.env.VITE_GOOGLE_CLIENT_ID,
  ];

  const validId = envVars.find(
    (id) => id && id.trim() !== '' && !PLACEHOLDER_CLIENT_IDS.has(id.trim())
  );

  if (validId) return validId.trim();

  // Fallback seguro
  return '372860477730-co8eq29vbsafmffmfm2v2ot5givurar1.apps.googleusercontent.com';
}

function isValidGoogleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.includes('@');
}

async function fetchGoogleProfile(accessToken: string): Promise<GmailUser> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Não foi possível obter os dados da sua conta Google.');
  }

  const profile = (await response.json()) as {
    email?: string;
    name?: string;
    given_name?: string;
    picture?: string;
  };

  if (!profile.email || !isValidGoogleEmail(profile.email)) {
    throw new Error('E-mail Google inválido. Verifique sua conta e tente novamente.');
  }

  return {
    email: profile.email,
    name: profile.name || profile.given_name || profile.email.split('@')[0],
    picture: profile.picture || '',
    accessToken,
  };
}

async function revokeGoogleToken(accessToken: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    // Revogação é best-effort; a sessão local já foi encerrada.
  }
}

export function useGmailAuth(): UseGmailAuthReturn {
  const [user, setUser] = useState<GmailUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loginResolveRef = useRef<((user: GmailUser) => void) | null>(null);
  const loginRejectRef = useRef<((err: Error) => void) | null>(null);

  // ── Restaurar sessão ao montar ────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as GmailUser;
        if (parsed.email && parsed.accessToken) {
          setUser(parsed);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOAuthSuccess = useCallback(async (tokenResponse: { access_token: string }) => {
    try {
      const authenticatedUser = await fetchGoogleProfile(tokenResponse.access_token);
      setUser(authenticatedUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authenticatedUser));
      setError(null);
      loginResolveRef.current?.(authenticatedUser);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao autenticar com o Google.';
      setError(message);
      loginRejectRef.current?.(err instanceof Error ? err : new Error(message));
    } finally {
      setLoading(false);
      loginResolveRef.current = null;
      loginRejectRef.current = null;
    }
  }, []);

  const handleOAuthError = useCallback(() => {
    const message = 'O login com Google foi cancelado ou falhou. Tente novamente.';
    setError(message);
    setLoading(false);
    loginRejectRef.current?.(new Error(message));
    loginResolveRef.current = null;
    loginRejectRef.current = null;
  }, []);

  const triggerGoogleLogin = useGoogleLogin({
    scope: 'openid profile email',
    onSuccess: handleOAuthSuccess,
    onError: handleOAuthError,
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  const loginWithGmail = useCallback((): Promise<GmailUser> => {
    const clientId = resolveClientId();
    if (!clientId) {
      const message =
        'Login com Google não configurado. Defina VITE_GMAIL_CLIENT_ID no arquivo .env.';
      setError(message);
      return Promise.reject(new Error(message));
    }

    return new Promise<GmailUser>((resolve, reject) => {
      setError(null);

      const timeoutId = window.setTimeout(() => {
        loginResolveRef.current = null;
        loginRejectRef.current = null;
        const message =
          'O login com Google demorou demais. Feche o popup, recarregue a página e tente novamente.';
        setError(message);
        setLoading(false);
        reject(new Error(message));
      }, 90_000);

      const finish = (fn: () => void) => {
        window.clearTimeout(timeoutId);
        fn();
      };

      loginResolveRef.current = (user) => finish(() => resolve(user));
      loginRejectRef.current = (err) => finish(() => reject(err));
      triggerGoogleLogin();
    });
  }, [triggerGoogleLogin]);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback((): void => {
    const token = user?.accessToken;

    setUser(null);
    setError(null);
    localStorage.removeItem(STORAGE_KEY);

    googleLogout();

    if (token) {
      void revokeGoogleToken(token);
    }
  }, [user]);

  return {
    user,
    isAuthenticated: user !== null,
    loading,
    error,
    loginWithGmail,
    logout,
  };
}
