/**
 * hooks/useGmailAuth.ts
 * Perfil de exibição da conta Google do responsável.
 * Requer GoogleOAuthProvider no componente pai (main.tsx).
 *
 * O LOGIN usa o botão oficial do Google (`<GoogleLogin>`), que entrega um
 * ID token (`credential`). É ESSE token que vai ao backend: ele é assinado pelo
 * Google e diz para qual client ID foi emitido, e o servidor confere as duas
 * coisas (Issue #387). O fluxo antigo trocava um access token, que não diz a
 * que aplicativo pertence — não é usado mais.
 *
 * Aqui só se guarda o perfil de EXIBIÇÃO (nome, e-mail, foto), lido do próprio
 * ID token. Nada neste hook autoriza coisa alguma: a sessão real é o cookie
 * HttpOnly emitido pelo backend.
 */

import { googleLogout } from '@react-oauth/google';
import { useCallback, useEffect, useState } from 'react';
import type { GmailUser, UseGmailAuthReturn } from '../types';

const STORAGE_KEY = 'gmailUser';

function persistirPerfil(user: GmailUser): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ email: user.email, name: user.name, picture: user.picture })
  );
}

/** Lê o payload do ID token só para exibição (a validação é do servidor). */
function perfilDoCredential(credential: string): GmailUser | null {
  try {
    const payload = credential.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('')
    );
    const dados = JSON.parse(json) as { email?: string; name?: string; picture?: string };
    if (!dados.email) return null;
    return {
      email: dados.email,
      name: dados.name || dados.email.split('@')[0],
      picture: dados.picture || '',
    };
  } catch {
    return null;
  }
}

export function useGmailAuth(): UseGmailAuthReturn {
  const [user, setUser] = useState<GmailUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // ── Restaurar perfil de exibição ao montar ────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<GmailUser> & { accessToken?: string };
        if (parsed.email) {
          const restaurado: GmailUser = {
            email: parsed.email,
            name: parsed.name || parsed.email.split('@')[0],
            picture: parsed.picture || '',
          };
          setUser(restaurado);
          // Migração: versões antigas gravavam um access token aqui.
          if (parsed.accessToken) persistirPerfil(restaurado);
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

  const registrarCredencial = useCallback((credential: string): GmailUser | null => {
    const perfil = perfilDoCredential(credential);
    if (!perfil) {
      setError('Não foi possível ler a resposta do Google. Tente novamente.');
      return null;
    }
    setUser(perfil);
    persistirPerfil(perfil);
    setError(null);
    return perfil;
  }, []);

  const logout = useCallback((): void => {
    setUser(null);
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
    googleLogout();
  }, []);

  return {
    user,
    isAuthenticated: user !== null,
    loading,
    error,
    registrarCredencial,
    logout,
  };
}
