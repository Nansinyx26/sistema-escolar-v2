/**
 * hooks/useGmailAuth.ts
 * Custom React hook that manages Gmail OAuth authentication state.
 * In development it uses a mock flow; swap loginWithGmail for the real
 * Google Identity Services SDK call before going to production.
 */

import { useState, useEffect, useCallback } from 'react';
import type { GmailUser, UseGmailAuthReturn } from '../types';

const STORAGE_KEY = 'gmailUser';

// ─── Mock user for local development ─────────────────────────────────────────
const mockUser: GmailUser = {
  email: 'maria.responsavel@gmail.com',
  name: 'Maria Silva',
  picture: '',
  accessToken: 'mock-token-dev',
};

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useGmailAuth(): UseGmailAuthReturn {
  const [user, setUser] = useState<GmailUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // ── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: GmailUser = JSON.parse(stored);
        setUser(parsed);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  const loginWithGmail = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      // ------------------------------------------------------------------ //
      // Production: replace this block with the real Google Identity flow.  //
      // Example:                                                             //
      //   const tokenClient = google.accounts.oauth2.initTokenClient({...}) //
      //   tokenClient.requestAccessToken();                                  //
      // ------------------------------------------------------------------ //
      await new Promise<void>((resolve) => setTimeout(resolve, 1200)); // simulate network

      const clientId = import.meta.env.VITE_GMAIL_CLIENT_ID as string | undefined;

      let authenticatedUser: GmailUser;

      if (!clientId || clientId === 'seu_client_id.apps.googleusercontent.com') {
        // Development mock
        const mockEmail = window.prompt(
          'Login com Google (Modo de Teste)\n\nDigite o e-mail do responsável que deseja testar:',
          'maria.responsavel@gmail.com'
        );

        if (!mockEmail) {
          throw new Error('Login cancelado pelo usuário.');
        }

        authenticatedUser = {
          ...mockUser,
          email: mockEmail,
          name: mockEmail.split('@')[0],
        };
      } else {
        // Real OAuth would populate this object after token exchange
        authenticatedUser = mockUser;
      }

      setUser(authenticatedUser);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authenticatedUser));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erro ao autenticar com o Gmail.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback((): void => {
    setUser(null);
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    user,
    isAuthenticated: user !== null,
    loading,
    error,
    loginWithGmail,
    logout,
  };
}
