import { useEffect, useRef } from 'react';
import { ttsService } from '../services/ttsService';

/**
 * useEsferaDeVoz — monta a `AssistantSphere` num canvas e a alimenta com o
 * espectro real da narração.
 *
 * ─── Por que a esfera vem de fora do portal ────────────────────────────────
 * O motor da esfera mora em `/js/ia/` na raiz do repositório e já é usado
 * pelos painéis em HTML puro (direção, professor, secretaria). Copiá-lo para
 * `src/` daria ao portal do responsável uma esfera que envelhece sozinha: um
 * ajuste na água ou uma correção de desempenho passaria a valer para três
 * perfis e não para o quarto. É o mesmo motivo pelo qual o portal já
 * reaproveita `css/motion.css` e `js/motion.js` da raiz (ver vite.config.ts).
 *
 * ─── Por que import() com o caminho numa variável ──────────────────────────
 * O especificador fica numa CONSTANTE, não num literal dentro do `import()`.
 * Isso é deliberado e resolve os dois lados de uma vez:
 *
 *   - Vite não tenta empacotar o módulo (o `@vite-ignore` diz o mesmo em voz
 *     alta); ele sai como um import do navegador em tempo de execução, e
 *     `/js` é servido pelo backend na raiz — o mesmo lugar de onde os painéis
 *     em HTML puro o carregam.
 *   - `tsc` não tenta resolver um caminho que sai da root do projeto, o que
 *     exigiria `allowJs` e um alias só para este arquivo.
 *
 * O preço é não ter tipo do outro lado; por isso o `any` fica confinado aqui,
 * e não vaza para os componentes.
 */
const MODULO_ESFERA = '/js/ia/AssistantSphere.js';
const MODULO_MEDIDOR = '/js/ia/NivelDeVoz.js';

/**
 * Enquadramento compacto: duas órbitas em vez de quatro, e a esfera usando a
 * folga que as outras duas deixaram. O orb do portal é de 200px (`large`) ou
 * 80px (`fab`) — nesse tamanho as quatro órbitas viram uma névoa em volta da
 * esfera em vez de órbitas.
 */
const ENQUADRAMENTO = { compacto: true, escalaRaio: 1.4 };

export type EstadoEsfera = 'ocioso' | 'ouvindo' | 'pensando' | 'falando' | 'erro';

interface Esfera {
  definirEstado(estado: EstadoEsfera): void;
  destruir(): void;
}

/**
 * `destruir()` existe no módulo mas está fora desta interface DE PROPÓSITO:
 * chamá-lo fecha o AudioContext e emudece a narração para sempre (veja
 * `medidorCompartilhado` abaixo). Fora do tipo, ninguém o chama por engano.
 */
interface Medidor {
  observar(elemento: HTMLAudioElement | null): void;
  soltar(): void;
  desbloquear(): void;
}

/**
 * O medidor é um SINGLETON de módulo, criado uma vez e nunca destruído —
 * enquanto a esfera nasce e morre a cada narração.
 *
 * Não é economia, é a única forma correta. `ttsService` reaproveita o mesmo
 * `<audio>` para sempre, e ligar um analisador nele significa chamar
 * `createMediaElementSource`, que rerroteia a saída do elemento para dentro
 * do AudioContext. A partir daí o som SÓ existe através desse contexto. Um
 * medidor por montagem traria dois desastres:
 *
 *   1. Fechar o contexto no unmount deixaria o `<audio>` roteado para um
 *      contexto morto — a narração emudeceria de vez, e nem recarregar o
 *      componente traria a voz de volta.
 *   2. `createMediaElementSource` no mesmo elemento a partir de um segundo
 *      contexto lança `InvalidStateError`.
 *
 * Um AudioContext por aba é também o que o Chrome espera: ele limita a ~6 por
 * documento.
 */
let medidorCompartilhado: Medidor | null = null;

function obterMedidor(criar: () => Medidor): Medidor {
  if (!medidorCompartilhado) medidorCompartilhado = criar();
  return medidorCompartilhado;
}

/**
 * @param canvasRef canvas onde a esfera desenha
 * @param estado    estado atual, já traduzido pelo componente
 * @param ativo     se a esfera deve existir agora. `false` desmonta o motor
 *                  inteiro — não é só esconder. Um orb ocioso na tela não
 *                  justifica 2200 partículas e um requestAnimationFrame
 *                  perpétuo consumindo bateria de celular; e um laço de
 *                  partículas que nunca para num botão de 80px é decoração
 *                  pedindo atenção, não informação.
 * @param aoFalhar  chamado se a esfera não subir ou desistir; o componente usa
 *                  para revelar o orb em CSS de volta
 */
export function useEsferaDeVoz(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  estado: EstadoEsfera,
  ativo: boolean,
  aoFalhar: () => void
) {
  const esferaRef = useRef<Esfera | null>(null);
  const medidorRef = useRef<Medidor | null>(null);

  // `aoFalhar` numa ref: se ele entrasse nas dependências do efeito de
  // montagem, um callback recriado a cada render remontaria a esfera a cada
  // render — e a esfera recomeçaria a materializar sem parar.
  const aoFalharRef = useRef(aoFalhar);
  aoFalharRef.current = aoFalhar;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ativo || !canvas || typeof canvas.getContext !== 'function') return;

    let vivo = true;

    (async () => {
      let AssistantSphere: any;
      let criarMedidorDeVoz: any;
      try {
        const [modEsfera, modMedidor] = await Promise.all([
          import(/* @vite-ignore */ MODULO_ESFERA),
          import(/* @vite-ignore */ MODULO_MEDIDOR),
        ]);
        AssistantSphere = modEsfera.AssistantSphere;
        criarMedidorDeVoz = modMedidor.criarMedidorDeVoz;
      } catch (e) {
        console.warn('[VoiceOrb] Esfera indisponível; seguindo com o orb em CSS.', e);
        aoFalharRef.current();
        return;
      }

      // O await abriu uma janela: o componente pode ter desmontado. Sem esta
      // guarda, sobraria um requestAnimationFrame girando para um canvas que
      // não está mais no documento.
      if (!vivo) return;

      try {
        medidorRef.current = obterMedidor(criarMedidorDeVoz);
        esferaRef.current = new AssistantSphere(canvas, {
          ...ENQUADRAMENTO,
          medidor: medidorRef.current,
          aoFalhar: () => aoFalharRef.current(),
        });
      } catch (e) {
        console.warn('[VoiceOrb] Esfera não subiu; seguindo com o orb em CSS.', e);
        aoFalharRef.current();
        return;
      }

      // A esfera nasce em repouso, mas o componente pode já estar tocando —
      // o orb só aparece DEPOIS que a narração começa, então este é o caso
      // normal, não a exceção.
      esferaRef.current.definirEstado(estado);

      const audio = ttsService.getAudioElement();
      if (audio) medidorRef.current?.observar(audio);
    })();

    return () => {
      vivo = false;
      esferaRef.current?.destruir();
      esferaRef.current = null;
      // `soltar` e NUNCA `destruir`: ver o comentário de `medidorCompartilhado`.
      // Só paramos de ler o áudio; o roteamento continua de pé para a próxima.
      medidorRef.current?.soltar();
      medidorRef.current = null;
    };
    // `estado` de propósito fora das dependências: ele é aplicado pelo efeito
    // abaixo. Aqui dentro, remontaria a esfera a cada troca de estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, ativo]);

  useEffect(() => {
    esferaRef.current?.definirEstado(estado);
  }, [estado]);

  // O AudioContext nasce suspenso e só um gesto do usuário o libera. Sem isto
  // a primeira narração da sessão desenha o envelope sintético em vez do
  // espectro real — parecido, mas fora de sincronia com a voz.
  useEffect(() => {
    // Alcança o singleton, não a ref: o gesto que destrava o AudioContext
    // costuma ser o MESMO clique que pede a narração, e nesse instante a
    // esfera ainda não montou — a ref estaria nula e o destravamento se
    // perderia justo na primeira vez, que é quando ele importa.
    const destravar = () => medidorCompartilhado?.desbloquear();
    document.addEventListener('pointerdown', destravar, { passive: true });
    document.addEventListener('keydown', destravar);
    return () => {
      document.removeEventListener('pointerdown', destravar);
      document.removeEventListener('keydown', destravar);
    };
  }, []);
}
