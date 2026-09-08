/**
 * components/CanalDenuncia.tsx — o canal de denúncia do ECA Digital no portal
 * do responsável.
 *
 * POR QUE FICA NO CABEÇALHO, E NÃO DENTRO DE UMA ABA
 * -------------------------------------------------
 * A lei pede um canal ACESSÍVEL a partir da tela do responsável. Quem precisa
 * denunciar bullying costuma estar com pressa, com raiva ou com medo — cada
 * navegação a mais é uma chance de desistir. No cabeçalho, o botão está em
 * todas as abas do portal.
 *
 * SOBRE RADIX DIALOG
 * ------------------
 * Foco preso, Esc, devolução do foco e `aria-modal` vêm do Radix, que é o que o
 * `Modal.tsx` já usa. Reimplementar isso à mão neste componente daria uma
 * segunda versão para manter — e acessibilidade feita duas vezes é
 * acessibilidade que diverge.
 *
 * O QUE A PESSOA VÊ DEPOIS DE ENVIAR
 * ----------------------------------
 * O protocolo. Sem ele, denunciar é falar com o vazio: não há como cobrar
 * retorno da escola depois, e o canal perde a serventia na segunda vez.
 */

import * as RadixDialog from '@radix-ui/react-dialog';
import type React from 'react';
import { useState } from 'react';
import { type CategoriaDenuncia, enviarDenuncia } from '../services/apiService';
import styles from '../styles/portal.module.scss';
import Icon from './ui/Icon';

const CATEGORIAS: { valor: CategoriaDenuncia; rotulo: string }[] = [
  { valor: 'bullying', rotulo: 'Bullying' },
  { valor: 'ciberbullying', rotulo: 'Cyberbullying (pela internet)' },
  { valor: 'assedio', rotulo: 'Assédio' },
  { valor: 'discriminacao', rotulo: 'Discriminação ou preconceito' },
  { valor: 'violencia', rotulo: 'Violência ou ameaça' },
  { valor: 'automutilacao', rotulo: 'Automutilação ou risco à vida' },
  { valor: 'outro', rotulo: 'Outro' },
];

const CanalDenuncia: React.FC = () => {
  const [aberto, setAberto] = useState(false);
  const [categoria, setCategoria] = useState<CategoriaDenuncia>('bullying');
  const [relato, setRelato] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [protocolo, setProtocolo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function reiniciar() {
    setRelato('');
    setCategoria('bullying');
    setProtocolo(null);
    setErro(null);
    setEnviando(false);
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await enviarDenuncia({ categoria, relato: relato.trim() });
      setProtocolo(resposta.protocolo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar agora.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <RadixDialog.Root
      open={aberto}
      onOpenChange={(estado) => {
        setAberto(estado);
        if (!estado) reiniciar();
      }}
    >
      <RadixDialog.Trigger asChild>
        <button
          type="button"
          className={styles.notificationBell}
          title="Denunciar bullying, assédio ou discriminação"
          aria-label="Denunciar bullying, assédio ou discriminação"
        >
          <Icon name="shield-alert" aria-hidden="true" style={{ fontSize: '1.4rem' }} />
        </button>
      </RadixDialog.Trigger>

      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.modalOverlay} />
        <RadixDialog.Content className={styles.modalContent}>
          <RadixDialog.Title>Denunciar bullying, assédio ou discriminação</RadixDialog.Title>
          <RadixDialog.Description>
            Conte o que aconteceu. Sua denúncia vai para a equipe da escola, que é quem vai apurar.
            A pessoa denunciada não é avisada por aqui.
          </RadixDialog.Description>

          {protocolo ? (
            // `role="status"` para que o leitor de tela anuncie o protocolo sem
            // que a pessoa precise sair procurando o que mudou na tela.
            <div role="status" aria-live="polite" style={{ marginTop: 16 }}>
              <p>Denúncia registrada. A equipe da escola vai apurar.</p>
              <p>
                <strong>Protocolo:</strong> {protocolo}
              </p>
              <p>Guarde este número para acompanhar o caso com a escola.</p>
            </div>
          ) : (
            <form onSubmit={enviar} style={{ marginTop: 16 }}>
              <label htmlFor="denuncia-categoria">Tipo da denúncia</label>
              <select
                id="denuncia-categoria"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as CategoriaDenuncia)}
                style={{ width: '100%', minHeight: 44, marginBottom: 12 }}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.rotulo}
                  </option>
                ))}
              </select>

              <label htmlFor="denuncia-relato">O que aconteceu?</label>
              <textarea
                id="denuncia-relato"
                value={relato}
                onChange={(e) => setRelato(e.target.value)}
                rows={6}
                maxLength={2000}
                required
                placeholder="Descreva com suas palavras. Se puder, diga quando e onde aconteceu."
                style={{ width: '100%', marginBottom: 8 }}
              />

              {erro && (
                <p role="alert" style={{ color: '#ef4444' }}>
                  {erro}
                </p>
              )}

              <button type="submit" disabled={enviando || relato.trim().length < 10}>
                {enviando ? 'Enviando...' : 'Enviar denúncia'}
              </button>
            </form>
          )}

          <RadixDialog.Close asChild>
            <button type="button" style={{ marginTop: 12 }}>
              Fechar
            </button>
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};

export default CanalDenuncia;
