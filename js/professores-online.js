/**
 * professores-online.js
 * Card em tempo real dos painéis de diretor e professor: lista os professores
 * da escola (foto + nome + escola + sala) com um ponto de status —
 * verde = online, branco = offline.
 *
 * Fonte de verdade: GET /api/professores/status-online (foto/escola/sala/online
 * do banco + presença em memória do socket.io). Atualiza via:
 *   - polling a cada 15s (base confiável, independe de socket na página);
 *   - evento socket `presence:professor` (atualização instantânea, se houver socket).
 */
(function () {
  'use strict';

  const LIST_ID = 'profsOnlineList';
  const COUNT_ID = 'profsOnlineCount';
  const POLL_MS = 15000;
  // Só a equipe enxerga o card — responsável/aluno tomariam 403 na rota.
  const PERFIS_COM_ACESSO = ['admin', 'diretor', 'secretaria', 'professor'];

  /** Perfil do usuário logado (auth.js em memória, com fallback no sessionStorage). */
  function perfilAtual() {
    try {
      const doAuth = window.auth && window.auth.getCurrentUser && window.auth.getCurrentUser();
      if (doAuth && doAuth.perfil) return doAuth.perfil;
      const cache = sessionStorage.getItem('currentUser');
      if (cache) return (JSON.parse(cache) || {}).perfil || null;
    } catch (e) { /* storage indisponível */ }
    return null;
  }

  function endpoint() {
    const base = window.API_BASE_URL || '/api';
    return base.replace(/\/$/, '') + '/professores/status-online';
  }

  function fotoUrl(prof) {
    if (window.getPhotoUrl) return window.getPhotoUrl(prof.foto, '');
    return prof.foto || '/img/default-avatar.png';
  }

  function initials(nome) {
    const letras = (nome || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
    // As iniciais entram num atributo onerror — fora de [A-Z0-9] nada passa.
    return letras.replace(/[^A-Z0-9]/g, '') || '?';
  }

  /** Escapa texto vindo do banco antes de entrar no innerHTML. */
  function esc(txt) {
    return String(txt == null ? '' : txt).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function itemHtml(p) {
    const url = fotoUrl(p);
    const nome = esc(p.nome || 'Professor');
    const escola = esc(p.escola || '—');
    const sala = esc(p.sala || '');
    const avatar = url
      ? `<img src="${esc(url)}" alt="" class="po-avatar" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'po-avatar po-avatar-fallback',textContent:'${initials(p.nome)}'}))">`
      : `<div class="po-avatar po-avatar-fallback">${initials(p.nome)}</div>`;
    return (
      `<div class="po-item" data-user="${esc(p.userId || '')}">` +
        `<div class="po-avatar-wrap">${avatar}` +
          `<span class="po-dot ${p.online ? 'po-on' : 'po-off'}" title="${p.online ? 'Online' : 'Offline'}"></span>` +
        `</div>` +
        `<div class="po-info">` +
          `<span class="po-nome">${nome}</span>` +
          `<span class="po-escola" title="${escola}"><i class="bi bi-building"></i>${escola}</span>` +
          (sala && sala !== '—' ? `<span class="po-sala">Sala ${sala}</span>` : '') +
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

  /** Remove card, FAB e painel da página (perfil sem acesso). */
  function esconderTudo() {
    ['profsOnlineCard', 'profsFab', 'profsPanel', 'profsPanelOverlay'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  let inFlight = false;
  let parado = false;
  async function refresh() {
    if (inFlight || parado) return;
    inFlight = true;
    try {
      const res = await fetch(endpoint(), { credentials: 'include' });
      // 401/403: perfil sem acesso (responsável/aluno) — some com o card.
      if (res.status === 401 || res.status === 403) {
        parado = true;
        esconderTudo();
        return;
      }
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

    // Perfil conhecido e sem acesso: nem monta o card. Se ainda não carregou
    // (auth.js é defer), segue — o 403 do refresh resolve.
    const perfil = perfilAtual();
    if (perfil && PERFIS_COM_ACESSO.indexOf(perfil) === -1) {
      esconderTudo();
      return;
    }

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
