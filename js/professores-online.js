/**
 * professores-online.js
 * Card em tempo real do painel do diretor: lista os professores da escola
 * (foto + nome + sala) com um ponto de status — verde = online, branco = offline.
 *
 * Fonte de verdade: GET /api/professores/status-online (foto/sala/online do banco
 * + presença em memória do socket.io). Atualiza via:
 *   - polling a cada 15s (base confiável, independe de socket na página);
 *   - evento socket `presence:professor` (atualização instantânea, se houver socket).
 */
(function () {
  'use strict';

  const LIST_ID = 'profsOnlineList';
  const COUNT_ID = 'profsOnlineCount';
  const POLL_MS = 15000;

  function endpoint() {
    const base = window.API_BASE_URL || '/api';
    return base.replace(/\/$/, '') + '/professores/status-online';
  }

  function fotoUrl(prof) {
    if (window.getPhotoUrl) return window.getPhotoUrl(prof.foto, '');
    return prof.foto || '/img/default-avatar.png';
  }

  function initials(nome) {
    return (nome || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  }

  function itemHtml(p) {
    const url = fotoUrl(p);
    const avatar = url
      ? `<img src="${url}" alt="" class="po-avatar" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'po-avatar po-avatar-fallback',textContent:'${initials(p.nome)}'}))">`
      : `<div class="po-avatar po-avatar-fallback">${initials(p.nome)}</div>`;
    return (
      `<div class="po-item" data-user="${p.userId || ''}">` +
        `<div class="po-avatar-wrap">${avatar}` +
          `<span class="po-dot ${p.online ? 'po-on' : 'po-off'}" title="${p.online ? 'Online' : 'Offline'}"></span>` +
        `</div>` +
        `<div class="po-info">` +
          `<span class="po-nome">${p.nome || 'Professor'}</span>` +
          `<span class="po-sala">${p.sala || '—'}</span>` +
        `</div>` +
        `<span class="po-status ${p.online ? 'po-on' : 'po-off'}">${p.online ? 'online' : 'offline'}</span>` +
      `</div>`
    );
  }

  function render(list) {
    const el = document.getElementById(LIST_ID);
    const countEl = document.getElementById(COUNT_ID);
    if (!el) return;
    if (!Array.isArray(list) || list.length === 0) {
      el.innerHTML = '<div class="po-empty">Nenhum professor cadastrado nesta escola.</div>';
      if (countEl) countEl.textContent = '0 online';
      return;
    }
    el.innerHTML = list.map(itemHtml).join('');
    const online = list.filter(p => p.online).length;
    if (countEl) countEl.textContent = `${online} online`;
    if (window.lucide && window.lucide.createIcons) window.renderLucideIcons && window.renderLucideIcons();
  }

  let inFlight = false;
  async function refresh() {
    if (inFlight) return;
    inFlight = true;
    try {
      const res = await fetch(endpoint(), { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      render(json.data || []);
    } catch (e) {
      const el = document.getElementById(LIST_ID);
      if (el && !el.dataset.loaded) {
        el.innerHTML = '<div class="po-empty">Não foi possível carregar os professores.</div>';
      }
    } finally {
      inFlight = false;
      const el = document.getElementById(LIST_ID);
      if (el) el.dataset.loaded = '1';
    }
  }

  // Atualização instantânea via socket (quando disponível na página).
  let socketBound = false;
  let debounceTimer = null;
  function debouncedRefresh() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 400);
  }
  function tryBindSocket() {
    if (socketBound) return;
    const s = window.socket;
    if (s && typeof s.on === 'function') {
      s.on('presence:professor', debouncedRefresh);
      socketBound = true;
    }
  }

  function initCollapse() {
    const toggle = document.getElementById('profsOnlineToggle');
    const body = document.getElementById('profsOnlineBody');
    if (!toggle || !body) return;
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
      document.getElementById('profsOnlineCard')?.classList.toggle('collapsed', open);
    });
  }

  function start() {
    if (!document.getElementById(LIST_ID)) return; // só roda onde o card existe
    initCollapse();
    refresh();
    setInterval(() => { tryBindSocket(); refresh(); }, POLL_MS);
    // Tenta ligar o socket já e de novo em seguida (caso conecte depois).
    tryBindSocket();
    setTimeout(tryBindSocket, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
