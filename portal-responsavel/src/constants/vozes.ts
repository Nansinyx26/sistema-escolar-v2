/**
 * vozes.ts — catálogo de vozes do narrador, para o portal do responsável.
 *
 * Espelha `window.Vozes` de `js/sidebar-voice.js` (o mesmo catálogo usado pelos
 * painéis em HTML puro). São dois arquivos porque o portal é um bundle Vite
 * separado, sem acesso ao escopo global daqueles scripts — mas os NOMES têm de
 * bater, porque quem resolve nome → id do provedor é um só:
 * `backend/src/services/TTSService.js`. Acrescentar uma voz lá significa
 * acrescentá-la aqui e no `sidebar-voice.js`.
 *
 * Os ids do provedor não aparecem em lugar nenhum do front. O navegador manda
 * 'brian'; o backend sabe o resto.
 */

export interface Voz {
  nome: VozNome;
  rotulo: string;
  descricao: string;
}

export type VozNome = 'brian' | 'adam' | 'eric' | 'george';

/** A ordem é a de exibição, e a primeira é a padrão. */
export const VOZES: readonly Voz[] = [
  { nome: 'brian', rotulo: 'Brian', descricao: 'Grave e tranquila' },
  { nome: 'adam', rotulo: 'Adam', descricao: 'Firme e direta' },
  { nome: 'eric', rotulo: 'Eric', descricao: 'Suave e natural' },
  { nome: 'george', rotulo: 'George', descricao: 'Calorosa e pausada' },
] as const;

/**
 * Brian, e não Adam.
 *
 * O portal era o único lugar que caía em Adam quando ninguém tinha escolhido —
 * o modelo `Usuario`, a rota `/api/tts/speak` e a página do assistente todos
 * partem de Brian, e há teste no backend fixando isso nos três. O responsável
 * ouvia uma voz diferente da que a escola ouvia, sem que ninguém tivesse
 * escolhido nada.
 */
export const VOZ_PADRAO: VozNome = 'brian';

export const CHAVE_VOZ = 'user_elevenlabs_voice';

/**
 * Normaliza o que está gravado no navegador.
 *
 * Instalações antigas gravaram 'male'/'female' nesta chave, quando ela ainda
 * guardava gênero. Sem normalizar, o seletor não marca nenhuma opção e a
 * pessoa vê um painel em branco descrevendo uma escolha que ela fez.
 */
export function normalizarVoz(valor: string | null | undefined): VozNome {
  const v = String(valor || '').toLowerCase();
  const achada = VOZES.find((voz) => voz.nome === v);
  return achada ? achada.nome : VOZ_PADRAO;
}

/** A voz em uso agora, sempre um nome válido. */
export function vozAtual(): VozNome {
  try {
    return normalizarVoz(localStorage.getItem(CHAVE_VOZ));
  } catch {
    // Modo privado ou armazenamento bloqueado.
    return VOZ_PADRAO;
  }
}

export function rotuloDaVoz(nome: string | null | undefined): string {
  const alvo = normalizarVoz(nome);
  return VOZES.find((v) => v.nome === alvo)?.rotulo ?? VOZES[0].rotulo;
}

/**
 * A frase da prévia. É a mesma dos painéis em HTML puro
 * (`window.Vozes.definir(..., { previa: true })` em `js/sidebar-voice.js`),
 * para que trocar de voz soe igual nos quatro perfis.
 */
const FRASE_PREVIA = 'Voz alterada com sucesso!';

/**
 * Toca uma frase curta na voz recém-escolhida.
 *
 * Escolher entre Brian, Adam, Eric e George por nome próprio é escolher no
 * escuro: a descrição ao lado ajuda, mas nenhuma palavra descreve um timbre.
 * Os três perfis em HTML puro já devolviam som ao trocar de voz; o portal do
 * responsável era o único que trocava em silêncio.
 *
 * O `import()` é dinâmico porque `ttsService` importa `vozAtual` DESTE arquivo.
 * Um import estático de volta fecharia um ciclo entre os dois módulos — e o
 * lado do serviço instancia a classe no escopo do módulo, que é justamente o
 * caso em que um ciclo deixa de ser inofensivo. Adiado até o clique, não há
 * ciclo nenhum: quando isto roda, os dois módulos já terminaram de avaliar.
 *
 * Sem `await` no chamador: a prévia não segura a troca de voz, e uma falha de
 * síntese não pode desfazer uma escolha que já está gravada.
 */
async function tocarPrevia(): Promise<void> {
  try {
    const { ttsService } = await import('../services/ttsService');
    await ttsService.play(FRASE_PREVIA);
  } catch {
    // Sem áudio a escolha continua valendo; ela só não pôde ser ouvida agora.
  }
}

/**
 * Grava a voz escolhida no navegador e no servidor, e a toca.
 *
 * O localStorage vem primeiro e o servidor depois, sem esperar: a próxima
 * narração lê o navegador, e fazer a troca depender da rede daria a impressão
 * de que o clique não pegou. A ida ao servidor é o que faz a escolha
 * acompanhar a pessoa para outro aparelho.
 *
 * A prévia faz parte desta função, e não dos dois seletores que a chamam
 * (o do cabeçalho e o do chatbot), pelo mesmo motivo pelo qual
 * `window.Vozes.definir` a oferece: são as ÚNICAS chamadas que existem, todas
 * partem de alguém escolhendo uma voz, e deixá-la a cargo de quem chama é como
 * o portal ficou sem prévia enquanto os outros perfis tinham.
 *
 * Falha em silêncio de propósito — a voz já vale nesta sessão, e um alerta
 * aqui interromperia quem só queria trocar de voz.
 */
export async function definirVoz(nome: string): Promise<VozNome> {
  const escolhida = normalizarVoz(nome);
  try {
    localStorage.setItem(CHAVE_VOZ, escolhida);
    localStorage.setItem('user_tts_provider', 'elevenlabs');
    // O backend só tem vozes masculinas; esta chave legada guarda o
    // liga/desliga da narração e ficaria em 'off' ou 'female' num migrado.
    localStorage.setItem('user_voice_preference', 'male');
  } catch {
    // Sem armazenamento a escolha vale só nesta aba — ainda assim vale.
  }

  window.dispatchEvent(new CustomEvent('voiceChanged', { detail: { voice: escolhida } }));

  // Depois de gravar e antes da ida ao servidor: a prévia lê a voz do
  // localStorage, e não pode esperar a rede para começar a tocar.
  void tocarPrevia();

  try {
    const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
    const csrf = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
    const resposta = await fetch('/api/auth/settings/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({
        elevenlabsVoice: escolhida,
        // O controller copia `voicePreference` para o campo legado
        // `voiceGender`, cujo enum só aceita 'male'/'female'. Mandar o nome da
        // voz aqui reprovava o documento e o update inteiro voltava 500 — sem
        // gravar NENHUMA das preferências.
        voicePreference: 'male',
        ttsProvider: 'elevenlabs',
      }),
    });
    if (!resposta.ok) {
      console.warn(`[Voz] Preferência não gravada no servidor: HTTP ${resposta.status}`);
    }
  } catch (erro) {
    console.warn('[Voz] Preferência não gravada no servidor:', erro);
  }

  return escolhida;
}
