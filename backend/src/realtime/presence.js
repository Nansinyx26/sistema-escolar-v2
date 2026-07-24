/**
 * realtime/presence.js
 * Presença online em memória (por escola), alimentada pelo socket.io.
 *
 * Estrutura: escolaId -> Map<userId, refCount>. O refCount cobre múltiplas
 * abas/dispositivos do mesmo usuário: só fica offline quando o último socket
 * cai. É intencionalmente em memória (não persiste) — presença é efêmera e
 * some quando o processo reinicia, que é o comportamento correto.
 */

const byEscola = new Map(); // escolaId(String) -> Map<userId(String), count>

const k = (v) => String(v);

/**
 * Marca um usuário como conectado. Retorna true se ele passou de offline
 * para online agora (primeira conexão), para o chamador emitir o evento.
 */
function addUser(escolaId, userId) {
  if (!escolaId || !userId) return false;
  const e = k(escolaId);
  const u = k(userId);
  let m = byEscola.get(e);
  if (!m) { m = new Map(); byEscola.set(e, m); }
  const jaEstava = m.has(u);
  m.set(u, (m.get(u) || 0) + 1);
  return !jaEstava;
}

/**
 * Remove uma conexão do usuário. Retorna true se ele ficou offline agora
 * (última conexão encerrada).
 */
function removeUser(escolaId, userId) {
  if (!escolaId || !userId) return false;
  const e = k(escolaId);
  const u = k(userId);
  const m = byEscola.get(e);
  if (!m || !m.has(u)) return false;
  const n = m.get(u) - 1;
  if (n <= 0) {
    m.delete(u);
    if (m.size === 0) byEscola.delete(e);
    return true;
  }
  m.set(u, n);
  return false;
}

/** IDs de usuário online numa escola. */
function onlineUserIds(escolaId) {
  const m = byEscola.get(k(escolaId));
  return m ? [...m.keys()] : [];
}

/** true se o usuário está online na escola. */
function isOnline(escolaId, userId) {
  const m = byEscola.get(k(escolaId));
  return !!(m && m.has(k(userId)));
}

module.exports = { addUser, removeUser, onlineUserIds, isOnline };
