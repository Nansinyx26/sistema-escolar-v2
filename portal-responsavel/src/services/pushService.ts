/**
 * services/pushService.ts
 * Inscrição do aparelho no Web Push — o que faz o aviso da escola chegar na
 * barra de notificações do celular mesmo com o portal fechado.
 *
 * Duas regras que os navegadores de celular impõem e que o portal violava:
 *
 *  1. O pedido de permissão precisa partir de um toque. Chamado sozinho no
 *     carregamento, o Safari recusa, o Firefox bloqueia e o Chrome do Android
 *     rebaixa para o aviso "silencioso" que ninguém vê. Por isso quem chama
 *     `ativarPush` é o botão de `PushAtivacaoAviso`.
 *  2. No iPhone/iPad o push só existe com o site instalado na Tela de Início
 *     (iOS 16.4+). Fora dele não adianta pedir — é preciso ensinar a instalar.
 *
 * E uma regra do servidor: se as chaves VAPID mudarem (ex.: deploy sem as
 * variáveis VAPID_* no ambiente), a inscrição antiga morre em silêncio. Ao
 * abrir o portal, `sincronizarPush` compara a chave da inscrição com a atual e
 * reinscreve o aparelho quando elas não batem.
 */

import { getVapidPublicKey, subscribePush } from './apiService';

export type EstadoPush =
  | 'indisponivel' // navegador sem suporte
  | 'instalar-ios' // iPhone/iPad fora do app instalado
  | 'bloqueado' // permissão negada nas configurações
  | 'pendente' // ainda não decidiu — oferecer o botão
  | 'ativo'; // permissão concedida

function pushSuportado(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function ehIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ se apresenta como Mac; o toque denuncia.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function ehStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function estadoPush(): EstadoPush {
  // Safari do iPhone fora da Tela de Início nem expõe PushManager: a checagem
  // do iOS vem antes da de suporte, senão cairia em "indisponível".
  if (ehIOS() && !ehStandalone()) return 'instalar-ios';
  if (!pushSuportado()) return 'indisponivel';
  if (Notification.permission === 'granted') return 'ativo';
  if (Notification.permission === 'denied') return 'bloqueado';
  return 'pendente';
}

function base64UrlParaBytes(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function mesmaChave(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== b[i]) return false;
  return true;
}

async function registroSW(): Promise<ServiceWorkerRegistration> {
  // O index.html registra no `load`; aqui garante mesmo que ainda não tenha.
  try {
    await navigator.serviceWorker.register('/service-worker.js');
  } catch {
    /* já registrado ou indisponível — segue para o ready */
  }
  return navigator.serviceWorker.ready;
}

/** Cria (ou renova) a inscrição do aparelho e envia ao servidor. */
async function inscreverAparelho(): Promise<boolean> {
  const { publicKey } = await getVapidPublicKey();
  if (!publicKey) return false;
  const chave = base64UrlParaBytes(publicKey);

  const registro = await registroSW();
  let inscricao = await registro.pushManager.getSubscription();

  // Inscrição feita com uma chave VAPID antiga não recebe mais nada.
  if (inscricao && !mesmaChave(inscricao.options.applicationServerKey, chave)) {
    await inscricao.unsubscribe().catch(() => undefined);
    inscricao = null;
  }

  if (!inscricao) {
    inscricao = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chave as BufferSource,
    });
  }

  await subscribePush(inscricao.toJSON());
  return true;
}

/**
 * Mantém a inscrição em dia sem perguntar nada — só age com a permissão já
 * concedida. Chamado ao entrar no portal.
 */
export async function sincronizarPush(): Promise<void> {
  if (!pushSuportado() || Notification.permission !== 'granted') return;
  try {
    await inscreverAparelho();
  } catch (err) {
    console.warn('[Push] Não foi possível sincronizar a inscrição:', (err as Error).message);
  }
}

/** Pede a permissão e inscreve o aparelho. Chamar só a partir de um toque. */
export async function ativarPush(): Promise<boolean> {
  if (!pushSuportado()) return false;
  let permissao = Notification.permission;
  if (permissao === 'default') permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return false;
  try {
    return await inscreverAparelho();
  } catch (err) {
    console.warn('[Push] Falha ao ativar notificações:', (err as Error).message);
    return false;
  }
}
