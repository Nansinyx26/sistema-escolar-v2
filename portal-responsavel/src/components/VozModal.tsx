/**
 * VozModal.tsx — "Voz e Acessibilidade" do portal do responsável (Issue #564).
 *
 * Equivalente ao `js/modal-voz.js` dos painéis da equipe: as vozes do narrador
 * separadas em Femininas e Masculinas, escolha com prévia sonora. Quem grava e
 * toca a prévia é `definirVoz` — a mesma função do cabeçalho e do chatbot —,
 * então este componente só desenha a escolha.
 *
 * Trocar de aba ou de voz não anima: é escolha repetida, e o retorno é o som.
 * A entrada do modal vem do `Dialog` (Radix), que já respeita
 * `prefers-reduced-motion` pela regra global do portal.
 */
import type React from 'react';
import { useEffect, useState } from 'react';
import {
  definirVoz,
  GENEROS_VOZ,
  type GeneroVoz,
  normalizarVoz,
  VOZES,
  type VozNome,
  vozAtual,
  vozPorNome,
} from '../constants/vozes';
import Dialog from './ui/Dialog';
import styles from './VozModal.module.scss';

interface VozModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const VozModal: React.FC<VozModalProps> = ({ open, onOpenChange }) => {
  const [voz, setVoz] = useState<VozNome>(() => vozAtual());
  const [aba, setAba] = useState<GeneroVoz>(() => vozPorNome(vozAtual()).genero);

  // Reabre sempre na aba da voz em uso — que pode ter mudado em outra tela.
  useEffect(() => {
    if (!open) return;
    const atual = vozAtual();
    setVoz(atual);
    setAba(vozPorNome(atual).genero);
  }, [open]);

  useEffect(() => {
    const aoTrocar = (e: Event) => {
      const detalhe = (e as CustomEvent<{ voice?: string }>).detail;
      if (detalhe?.voice) setVoz(normalizarVoz(detalhe.voice));
    };
    window.addEventListener('voiceChanged', aoTrocar);
    return () => window.removeEventListener('voiceChanged', aoTrocar);
  }, []);

  const escolher = (nome: VozNome) => {
    setVoz(nome);
    void definirVoz(nome);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Voz e Acessibilidade"
      description="Escolha a voz que narra avisos e o assistente. Vale só para a sua conta."
      icon={<i className="ti ti-volume-2" aria-hidden="true" />}
    >
      <div className={styles.topo}>
        <h3 className={styles.secaoTitulo}>Narrador do sistema</h3>
        <fieldset className={styles.segmentos} aria-label="Gênero da voz do narrador">
          {GENEROS_VOZ.map((g) => (
            <button
              key={g.genero}
              type="button"
              className={styles.segmento}
              aria-pressed={aba === g.genero}
              onClick={() => setAba(g.genero)}
            >
              {g.rotulo}
            </button>
          ))}
        </fieldset>
      </div>
      <p className={styles.ajuda}>Toque numa voz para ouvir e usar.</p>
      <fieldset className={styles.vozes} aria-label="Vozes do narrador">
        {VOZES.filter((v) => v.genero === aba).map((v) => {
          const ativa = v.nome === voz;
          return (
            <button
              key={v.nome}
              type="button"
              className={styles.voz}
              aria-pressed={ativa}
              onClick={() => escolher(v.nome)}
            >
              <span className={styles.vozNome}>
                {v.rotulo}
                {ativa && <span className={styles.selo}>Em uso</span>}
              </span>
              <span className={styles.vozDesc}>{v.descricao}</span>
            </button>
          );
        })}
      </fieldset>
    </Dialog>
  );
};

export default VozModal;
