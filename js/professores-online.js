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

  /** Apresentação do status agregado vindo do backend (realtime/presence.js). */
  const STATUS_UI = {
    online:  { texto: '🟢 Online',  classe: 'po-on',   titulo: 'Online' },
    ausente: { texto: '🟡 Ausente', classe: 'po-away', titulo: 'Ausente' },
    offline: { texto: '🔴 Offline', classe: 'po-off',  titulo: 'Offline' }
  };

  function statusDe(p) {
    const bruto = String(p.status || (p.online ? 'online' : 'offline')).toLowerCase();
    return STATUS_UI[bruto] || STATUS_UI.offline;
  }

  /** "há 12 min" / "há 2 h" a partir do instante em que o usuário ficou online. */
  function tempoOnline(desde) {
    if (!desde) return '';
    const inicio = new Date(desde);
    if (isNaN(inicio.getTime())) return '';
    const min = Math.floor((Date.now() - inicio.getTime()) / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    return `há ${Math.floor(h / 24)} d`;
  }

  function itemHtml(p) {
    const url = fotoUrl(p);
    const nome = esc(p.nome || 'Usuário');
    const cargo = esc(p.cargo || 'Professor');
    const cargoClass = cargo === 'Diretor' ? 'diretor' : 'professor';
    const escola = esc(p.escola || '—');
    const sala = esc(p.sala || '');
    const userId = esc(p.userId || p.id || '');
    const st = statusDe(p);
    const unreadCount = Number(p.unreadsCount || 0);

    const avatar = url
      ? `<img src="${esc(url)}" alt="" class="po-avatar" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'po-avatar po-avatar-fallback',textContent:'${initials(p.nome)}'}))">`
      : `<div class="po-avatar po-avatar-fallback">${initials(p.nome)}</div>`;

    const unreadBadge = unreadCount > 0
      ? `<span class="po-unread-badge" title="${unreadCount} mensagem(ns) não lida(s)">💬 ${unreadCount}</span>`
      : '';

    // Tempo online: só faz sentido enquanto a pessoa está conectada.
    const tempo = p.status !== 'offline' && p.online ? tempoOnline(p.onlineDesde) : '';
    const tempoHtml = tempo ? `<span class="po-tempo-online" title="Conectado ${tempo}"><i class="bi bi-clock"></i> ${esc(tempo)}</span>` : '';

    // Dados do contato viajam em data-* e são lidos por delegação de evento.
    // Antes iam interpolados dentro de um `onclick` inline: um nome com
    // apóstrofo (D'Ávila) fechava a string JS e quebrava o botão.
    return (
      `<div class="po-item" data-user="${userId}">` +
        `<div class="po-item-main">` +
          `<div class="po-avatar-wrap">${avatar}` +
            `<span class="po-dot ${st.classe}" title="${st.titulo}"></span>` +
          `</div>` +
          `<div class="po-info">` +
            `<div class="po-nome-row">` +
              `<span class="po-nome">${nome}</span>` +
              `<span class="po-cargo-tag ${cargoClass}">${cargo}</span>` +
            `</div>` +
            `<span class="po-escola" title="${escola}"><i class="bi bi-building"></i>${escola}</span>` +
            (sala && sala !== '—' ? `<span class="po-sala">Sala ${sala}</span>` : '') +
            `<div class="po-status-row">` +
              `<span class="po-status-badge ${st.classe}">${st.texto}</span>` +
              tempoHtml +
              unreadBadge +
            `</div>` +
          `</div>` +
        `</div>` +
        `<div class="po-actions">` +
          `<button type="button" class="btn-po-conversar" ` +
            `data-chat-user="${userId}" data-chat-nome="${nome}" ` +
            `data-chat-foto="${esc(url || '')}" data-chat-cargo="${cargo}" ` +
            `data-chat-status="${esc(p.status || (p.online ? 'online' : 'offline'))}" ` +
            `aria-label="Conversar com ${nome}">` +
            `<i class="bi bi-chat-text-fill"></i> 💬 Conversar` +
          `</button>` +
        `</div>` +
      `</div>`
    );
  }

  /**
   * Um único listener delegado no documento cobre o card embutido e o painel
   * flutuante, e sobrevive a cada re-render da lista.
   */
  let cliqueBound = false;
  function bindConversarDelegado() {
    if (cliqueBound) return;
    cliqueBound = true;
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest && ev.target.closest('.btn-po-conversar');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();

      const dados = {
        nome: btn.dataset.chatNome || 'Conversa',
        foto: btn.dataset.chatFoto || '',
        cargo: btn.dataset.chatCargo || '',
        status: btn.dataset.chatStatus || 'offline'
      };

      if (window.chatManager) {
        window.chatManager.openChat(btn.dataset.chatUser, dados);
        // No celular o chat abre em tela cheia; fechar o painel evita a lista
        // rolando atrás da conversa.
        document.getElementById('profsPanel')?.classList.remove('open');
        document.getElementById('profsPanelOverlay')?.classList.remove('active');
      } else {
        alert('Carregando sistema de chat...');
      }
    });
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
      // Nova mensagem recebida: o contador de não lidas do card vem da mesma
      // rota, então basta recarregar a lista.
      s.on('chat:mensagem', debouncedRefresh);
      s.on('chat:lidas', debouncedRefresh);
      socketBound = true;
      iniciarDeteccaoAusencia(s);
    }
  }

  /**
   * Status 🟡 Ausente: sem interação nem foco por AUSENTE_MS, a aba avisa o
   * servidor; qualquer atividade (ou voltar para a aba) traz de volta a online.
   * O servidor só considera o usuário ausente quando TODAS as abas dele estão
   * ociosas — ver backend/src/realtime/presence.js.
   */
  const AUSENTE_MS = 5 * 60 * 1000;
  let idleBound = false;
  function iniciarDeteccaoAusencia(socket) {
    if (idleBound) return;
    idleBound = true;

    let ausente = false;
    let timer = null;

    const avisar = (novoEstado) => {
      if (novoEstado === ausente) return;
      ausente = novoEstado;
      try { socket.emit('presence:idle', { ausente }); } catch (e) { /* socket caiu */ }
    };

    const reiniciar = () => {
      avisar(false);
      clearTimeout(timer);
      timer = setTimeout(() => avisar(true), AUSENTE_MS);
    };

    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'focus']
      .forEach((ev) => window.addEventListener(ev, reiniciar, { passive: true }));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearTimeout(timer); avisar(true); }
      else reiniciar();
    });

    // Reconexão zera o estado do servidor: reafirma o que a aba sabe.
    socket.on('connect', () => { ausente = false; reiniciar(); });

    reiniciar();
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
    bindConversarDelegado();
    refresh();
    setInterval(() => { tryBindSocket(); refresh(); }, POLL_MS);
    tryBindSocket();
    setTimeout(tryBindSocket, 3000);
  }

  // Exposto para o chat flutuante atualizar o badge de não lidas assim que
  // uma mensagem chega (chat-direto-manager.js já chamava este nome).
  window.refreshProfsOnline = debouncedRefresh;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
