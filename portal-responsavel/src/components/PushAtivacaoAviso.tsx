/**
 * components/PushAtivacaoAviso.tsx
 * Aviso discreto no rodapé que leva o responsável a receber os avisos da
 * escola na barra de notificações do celular — mesmo usando só pelo navegador.
 *
 * - Permissão ainda não decidida → botão "Ativar" (o pedido parte do toque,
 *   como os navegadores de celular exigem).
 * - iPhone/iPad fora da Tela de Início → ensina a instalar, porque ali o push
 *   só existe no app instalado.
 * - Depois de ativar, confirma e some sozinho.
 *
 * "Agora não" esconde por 7 dias, não para sempre: quem dispensou sem querer
 * não fica sem aviso da escola até limpar os dados do navegador.
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { ativarPush, type EstadoPush, estadoPush } from '../services/pushService';
import styles from '../styles/portal.module.scss';
import Icon from './ui/Icon';

const CHAVE_ADIADO = 'portal_push_adiado_ate';
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

function adiado(): boolean {
  try {
    return Number(localStorage.getItem(CHAVE_ADIADO) || 0) > Date.now();
  } catch {
    return false;
  }
}

function adiar(): void {
  try {
    localStorage.setItem(CHAVE_ADIADO, String(Date.now() + SETE_DIAS_MS));
  } catch {
    /* navegação privada: só some nesta visita */
  }
}

const PushAtivacaoAviso: React.FC = () => {
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [visivel, setVisivel] = useState(false);
  const [ativando, setAtivando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [ativado, setAtivado] = useState(false);

  useEffect(() => {
    const atual = estadoPush();
    setEstado(atual);
    // Espera o portal assentar antes de aparecer — não disputa a primeira tela.
    const t = setTimeout(() => {
      if ((atual === 'pendente' || atual === 'instalar-ios') && !adiado()) setVisivel(true);
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!ativado) return;
    const t = setTimeout(() => setVisivel(false), 4000);
    return () => clearTimeout(t);
  }, [ativado]);

  if (!visivel || !estado) return null;

  const fechar = () => {
    if (!ativado) adiar();
    setVisivel(false);
  };

  const ativar = async () => {
    setAtivando(true);
    setFalhou(false);
    const ok = await ativarPush();
    setAtivando(false);
    if (ok) setAtivado(true);
    else {
      const novo = estadoPush();
      setEstado(novo);
      setFalhou(novo !== 'bloqueado');
    }
  };

  let titulo = 'Avisos da escola no celular';
  let texto: React.ReactNode = 'Receba comunicados e faltas na hora, mesmo com o portal fechado.';
  if (ativado) {
    titulo = 'Notificações ativadas';
    texto = 'Pronto! Os avisos da escola vão aparecer neste aparelho.';
  } else if (estado === 'instalar-ios') {
    titulo = 'Receba os avisos no iPhone';
    texto = (
      <>
        Toque em <strong>Compartilhar</strong> e depois em{' '}
        <strong>Adicionar à Tela de Início</strong>. Abra o portal pelo ícone criado e ative as
        notificações.
      </>
    );
  } else if (estado === 'bloqueado') {
    titulo = 'Notificações bloqueadas';
    texto =
      'Libere as notificações deste site nas configurações do navegador para receber os avisos.';
  } else if (falhou) {
    texto = 'Não foi possível ativar agora. Verifique a conexão e tente de novo.';
  }

  return (
    <aside
      className={`${styles.pushAviso} ${ativado ? styles.pushAvisoOk : ''}`}
      aria-live="polite"
      aria-label="Notificações no celular"
    >
      <span className={styles.pushAvisoIcone} aria-hidden="true">
        <Icon name={ativado ? 'check' : 'bell'} />
      </span>
      <div className={styles.pushAvisoTexto}>
        <strong>{titulo}</strong>
        <p>{texto}</p>
      </div>
      {estado === 'pendente' && !ativado && (
        <button
          type="button"
          className={styles.pushAvisoAtivar}
          onClick={ativar}
          disabled={ativando}
        >
          {ativando ? 'Ativando…' : 'Ativar'}
        </button>
      )}
      <button
        type="button"
        className={styles.pushAvisoFechar}
        onClick={fechar}
        aria-label={ativado ? 'Fechar' : 'Agora não'}
        title={ativado ? 'Fechar' : 'Agora não'}
      >
        <Icon name="x" aria-hidden="true" />
      </button>
    </aside>
  );
};

export default PushAtivacaoAviso;
