/**
 * hooks/useTheme.ts
 * Tema Dark/Light do Portal do Responsável (Issue #436).
 *
 * Um portal só, com a mesma marcação nos dois temas: trocar o tema muda apenas
 * o atributo `data-theme` do <html>, e os tokens de `styles/global.scss` fazem
 * o resto.
 *
 * A preferência fica em `localStorage['theme']`, a mesma chave do login do
 * portal e do restante do sistema escolar (js/app.js, js/settings-drawer.js),
 * para o responsável não precisar escolher o tema duas vezes.
 *
 * O primeiro `data-theme` é aplicado por um script inline no <head> do
 * index.html, antes do React e antes da primeira pintura, o que evita o flash
 * do tema errado. Este hook só assume a partir daí.
 */

import { useCallback, useEffect, useState } from 'react';

export type Tema = 'dark' | 'light';

const CHAVE = 'theme';
const EVENTO = 'themechange';

/** Cor da barra do navegador no celular, igual ao fundo do cabeçalho. */
const THEME_COLOR: Record<Tema, string> = { dark: '#030a0e', light: '#ffffff' };

export function lerTemaSalvo(): Tema {
  try {
    return localStorage.getItem(CHAVE) === 'light' ? 'light' : 'dark';
  } catch {
    // localStorage bloqueado (aba anônima, cookies desligados)
    return 'dark';
  }
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.setAttribute('data-theme', tema);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[tema]);
}

export function useTheme() {
  const [tema, setTemaState] = useState<Tema>(() => {
    const atual = document.documentElement.getAttribute('data-theme');
    return atual === 'light' || atual === 'dark' ? atual : lerTemaSalvo();
  });

  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);

  // Mantém em sincronia todos os alternadores da página (cabeçalho, menu do
  // perfil, login) e outras abas abertas do portal.
  useEffect(() => {
    const aoTrocar = (e: Event) => {
      const proximo = (e as CustomEvent<{ theme?: Tema }>).detail?.theme;
      if (proximo === 'dark' || proximo === 'light') setTemaState(proximo);
    };
    const aoMudarStorage = (e: StorageEvent) => {
      if (e.key === CHAVE) setTemaState(e.newValue === 'light' ? 'light' : 'dark');
    };
    window.addEventListener(EVENTO, aoTrocar);
    window.addEventListener('storage', aoMudarStorage);
    return () => {
      window.removeEventListener(EVENTO, aoTrocar);
      window.removeEventListener('storage', aoMudarStorage);
    };
  }, []);

  const setTema = useCallback((proximo: Tema) => {
    setTemaState(proximo);
    aplicarTema(proximo);
    try {
      localStorage.setItem(CHAVE, proximo);
    } catch {
      // sem persistência: o tema vale só nesta visita
    }
    window.dispatchEvent(new CustomEvent(EVENTO, { detail: { theme: proximo } }));
  }, []);

  const alternar = useCallback(() => {
    setTema(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  }, [setTema]);

  return { tema, setTema, alternar };
}
