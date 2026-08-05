/**
 * realtime/presence.js
 * Presença online em memória (por escola), alimentada pelo socket.io.
 *
 * Estrutura: escolaId -> Map<userId, registro>. O `conexoes` cobre múltiplas
 * abas/dispositivos do mesmo usuário: só fica offline quando o último socket
 * cai. É intencionalmente em memória (não persiste) — presença é efêmera e
 * some quando o processo reinicia, que é o comportamento correto.
 *
 * Cada registro guarda:
 *   conexoes  — refCount de sockets abertos;
 *   desde     — quando a primeira conexão entrou (base do "tempo online");
 *   ausente   — Set de socketIds ociosos; o usuário só é "ausente" quando
 *               TODAS as suas abas estão ociosas (aba ativa em outro monitor
 *               continua valendo como online).
 *
 * `lastSeen` fica num mapa separado (userId -> Date), preservado após o
 * disconnect para alimentar o "visto por último" do cabeçalho da conversa.
 */

const byEscola = new Map();  // escolaId(String) -> Map<userId(String), registro>
const lastSeen = new Map();  // userId(String) -> Date

const k = (v) => String(v);

function registro(escolaId, userId) {
  const m = byEscola.get(k(escolaId));
  return m ? m.get(k(userId)) : undefined;
}

/**
 * Marca um usuário como conectado. Retorna true se ele passou de offline
 * para online agora (primeira conexão), para o chamador emitir o evento.
 */
function addUser(escolaId, userId, socketId) {
  if (!escolaId || !userId) return false;
  const e = k(escolaId);
  const u = k(userId);
  let m = byEscola.get(e);
  if (!m) { m = new Map(); byEscola.set(e, m); }

  const atual = m.get(u);
  if (atual) {
    atual.conexoes += 1;
    // Aba nova nasce ativa: um usuário marcado como ausente volta a online.
    if (socketId) atual.ausente.delete(k(socketId));
    return false;
  }

  m.set(u, { conexoes: 1, desde: new Date(), ausente: new Set() });
  lastSeen.set(u, new Date());
  return true;
}

/**
 * Remove uma conexão do usuário. Retorna true se ele ficou offline agora
 * (última conexão encerrada).
 */
function removeUser(escolaId, userId, socketId) {
  if (!escolaId || !userId) return false;
  const e = k(escolaId);
  const u = k(userId);
  const m = byEscola.get(e);
  if (!m || !m.has(u)) return false;

  const reg = m.get(u);
  if (socketId) reg.ausente.delete(k(socketId));
  reg.conexoes -= 1;

  if (reg.conexoes <= 0) {
    m.delete(u);
    if (m.size === 0) byEscola.delete(e);
    lastSeen.set(u, new Date());
    return true;
  }
  return false;
}

/**
 * Marca/desmarca uma aba como ociosa. Retorna true se o status agregado do
 * usuário mudou (online <-> ausente), para o chamador emitir o evento.
 */
function setAusente(escolaId, userId, socketId, ausente) {
  const reg = registro(escolaId, userId);
  if (!reg || !socketId) return false;

  const antes = reg.ausente.size >= reg.conexoes;
  if (ausente) reg.ausente.add(k(socketId));
  else reg.ausente.delete(k(socketId));
  const depois = reg.ausente.size >= reg.conexoes;

  if (!ausente) lastSeen.set(k(userId), new Date());
  return antes !== depois;
}

/** IDs de usuário online numa escola. */
function onlineUserIds(escolaId) {
  const m = byEscola.get(k(escolaId));
  return m ? [...m.keys()] : [];
}

/** true se o usuário tem ao menos uma conexão aberta na escola. */
function isOnline(escolaId, userId) {
  return !!registro(escolaId, userId);
}

/**
 * Status agregado: 'online' | 'ausente' | 'offline'.
 * Fonte única para o card de usuários e para o cabeçalho da conversa.
 */
function statusDe(escolaId, userId) {
  const reg = registro(escolaId, userId);
  if (!reg) return 'offline';
  return reg.ausente.size >= reg.conexoes ? 'ausente' : 'online';
}

/** Momento em que o usuário ficou online (Date) ou null se offline. */
function onlineDesde(escolaId, userId) {
  const reg = registro(escolaId, userId);
  return reg ? reg.desde : null;
}

/** Última atividade conhecida (Date) ou null — sobrevive ao disconnect. */
function ultimoAcesso(userId) {
  return lastSeen.get(k(userId)) || null;
}

/** Resumo completo, usado pelas rotas que montam a lista da equipe. */
function infoDe(escolaId, userId) {
  const status = statusDe(escolaId, userId);
  return {
    status,
    online: status !== 'offline',
    onlineDesde: onlineDesde(escolaId, userId),
    ultimoAcesso: ultimoAcesso(userId)
  };
}

module.exports = {
  addUser,
  removeUser,
  setAusente,
  onlineUserIds,
  isOnline,
  statusDe,
  onlineDesde,
  ultimoAcesso,
  infoDe
};
