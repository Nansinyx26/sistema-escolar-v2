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
    const html = (!Array.isArray(list) || list.length === 0)
      ? '<div class="po-empty">Nenhum professor cadastrado nesta escola.</div>'
      : list.map(itemHtml).join('');

    const online = Array.isArray(list) ? list.filter(p => p.online).length : 0;
    const onlineText = `${online} online`;

    // Renderiza no card embutido (se existir na página)
    const elCard = document.getElementById(LIST_ID);
    const countCard = document.getElementById(COUNT_ID);
    if (elCard) elCard.innerHTML = html;
    if (countCard) countCard.textContent = onlineText;

    // Renderiza no painel flutuante (se existir na página)
    const elPanel = document.getElementById('profsPanelList');
    const countPanel = document.getElementById('profsPanelCount');
    const fabBadge = document.getElementById('profsFabBadge');
    if (elPanel) elPanel.innerHTML = html;
    if (countPanel) countPanel.textContent = onlineText;
    if (fabBadge) fabBadge.textContent = String(online);

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
      const emptyMsg = '<div class="po-empty">Não foi possível carregar os professores.</div>';
      const elCard = document.getElementById(LIST_ID);
      const elPanel = document.getElementById('profsPanelList');
      if (elCard && !elCard.dataset.loaded) elCard.innerHTML = emptyMsg;
      if (elPanel && !elPanel.dataset.loaded) elPanel.innerHTML = emptyMsg;
    } finally {
      inFlight = false;
      const elCard = document.getElementById(LIST_ID);
      const elPanel = document.getElementById('profsPanelList');
      if (elCard) elCard.dataset.loaded = '1';
      if (elPanel) elPanel.dataset.loaded = '1';
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

  function initFloatingPanel() {
    const fab = document.getElementById('profsFab');
    const panel = document.getElementById('profsPanel');
    const overlay = document.getElementById('profsPanelOverlay');
    const closeBtn = document.getElementById('profsPanelClose');
    if (!fab || !panel) return;

    function openPanel() {
      panel.classList.add('open');
      overlay?.classList.add('active');
    }
    function closePanel() {
      panel.classList.remove('open');
      overlay?.classList.remove('active');
    }

    fab.addEventListener('click', () => {
      if (panel.classList.contains('open')) closePanel();
      else openPanel();
    });
    closeBtn?.addEventListener('click', closePanel);
    overlay?.addEventListener('click', closePanel);
  }

  function start() {
    if (!document.getElementById(LIST_ID) && !document.getElementById('profsPanelList')) return;
    initCollapse();
    initFloatingPanel();
    refresh();
    setInterval(() => { tryBindSocket(); refresh(); }, POLL_MS);
    tryBindSocket();
    setTimeout(tryBindSocket, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
