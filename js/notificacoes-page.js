/**
 * notificacoes-page.js
 * Lógica da Central Dedicada de Notificações para todas as contas.
 */

(function () {
    'use strict';

    let _notificacoes = [];
    let _filtroAtual = 'todas';
    let _buscaTermo = '';
    let _abaAtual = 'notificacoes'; // 'notificacoes' | 'configuracoes'
    let _usuarioAtual = null;

    const ICONES_TIPO = {
        aviso: { icon: 'bi-megaphone-fill', bg: 'rgba(14,165,233,0.15)', color: '#38bdf8', label: 'Aviso' },
        alerta: { icon: 'bi-exclamation-triangle-fill', bg: 'rgba(239,68,68,0.12)', color: '#f87171', label: 'Alerta' },
        comunicado: { icon: 'bi-megaphone-fill', bg: 'rgba(14,165,233,0.15)', color: '#38bdf8', label: 'Comunicado' },
        frequencia: { icon: 'bi-calendar-check-fill', bg: 'rgba(16,185,129,0.12)', color: '#34d399', label: 'Frequência' },
        nota: { icon: 'bi-bar-chart-line-fill', bg: 'rgba(59,130,246,0.12)', color: '#60a5fa', label: 'Nota' },
        sistema: { icon: 'bi-gear-fill', bg: 'rgba(245,158,11,0.12)', color: '#fbbf24', label: 'Sistema' },
        seguranca: { icon: 'bi-shield-lock-fill', bg: 'rgba(239,68,68,0.12)', color: '#f87171', label: 'Segurança' },
        mural: { icon: 'bi-clipboard2-fill', bg: 'rgba(168,85,247,0.12)', color: '#c084fc', label: 'Mural' },
        default: { icon: 'bi-bell-fill', bg: 'rgba(255,255,255,0.06)', color: '#94a3b8', label: 'Notificação' }
    };

    function getApiBaseUrl() {
        return window.API_BASE_URL || (window.location.origin + '/api');
    }

    function formatarDataRelativa(isoStr) {
        if (!isoStr) return '';
        try {
            const d = new Date(isoStr);
            const now = new Date();
            const diffMs = now - d;
            const diffMin = Math.floor(diffMs / 60000);
            if (diffMin < 1) return 'Agora mesmo';
            if (diffMin < 60) return `Há ${diffMin} min`;
            const diffHoras = Math.floor(diffMin / 60);
            if (diffHoras < 24) return `Há ${diffHoras}h`;
            const diffDias = Math.floor(diffHoras / 24);
            if (diffDias === 1) return 'Ontem às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            if (diffDias < 7) return `Há ${diffDias} dias`;
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch {
            return '';
        }
    }

    async function carregarUsuario() {
        try {
            const res = await fetch(`${getApiBaseUrl()}/auth/me`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                _usuarioAtual = data.user || data.data || data;
                atualizarHeaderUsuario();
            }
        } catch (err) {
            console.warn('[Notif] Não foi possível carregar perfil:', err);
        }
    }

    function atualizarHeaderUsuario() {
        const elNome = document.getElementById('userName');
        const elCargo = document.getElementById('userCargo');
        const elAvatar = document.getElementById('userAvatar');
        if (_usuarioAtual) {
            if (elNome) elNome.textContent = _usuarioAtual.nome || 'Usuário';
            if (elCargo) elCargo.textContent = _usuarioAtual.perfil ? _usuarioAtual.perfil.toUpperCase() : '';
            if (elAvatar && _usuarioAtual.foto) elAvatar.src = _usuarioAtual.foto;
        }
    }

    async function buscarNotificacoes() {
        const container = document.getElementById('notifList');
        if (!container) return;

        // Renderizar Skeletons se primeira carga
        if (_notificacoes.length === 0) {
            renderizarSkeletons();
        }

        try {
            const res = await fetch(`${getApiBaseUrl()}/notificacoes`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            _notificacoes = Array.isArray(json.data) ? json.data : [];
            atualizarContadores();
            renderizarLista();
        } catch (err) {
            console.error('[Notif] Erro ao carregar:', err);
            container.innerHTML = `
                <div class="notif-empty-state">
                    <div class="notif-empty-icon" style="background: rgba(239, 68, 68, 0.1); color: var(--error, #ef4444);">
                        <i class="bi bi-exclamation-triangle"></i>
                    </div>
                    <h3 class="notif-empty-title">Erro ao carregar notificações</h3>
                    <p class="notif-empty-desc">${err.message || 'Verifique sua conexão e tente novamente.'}</p>
                    <button type="button" class="notif-btn-action primary" onclick="window.NotificacoesPage.recarregar()">
                        <i class="bi bi-arrow-clockwise"></i> Tentar novamente
                    </button>
                </div>
            `;
        }
    }

    function renderizarSkeletons() {
        const container = document.getElementById('notifList');
        if (!container) return;
        let html = '';
        for (let i = 0; i < 4; i++) {
            html += `
                <div class="notif-skeleton-card">
                    <div class="notif-skel-icon skeleton"></div>
                    <div class="notif-skel-content">
                        <div class="skeleton notif-skel-line" style="width: 45%;"></div>
                        <div class="skeleton notif-skel-line" style="width: 85%;"></div>
                        <div class="skeleton notif-skel-line" style="width: 30%;"></div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    function atualizarContadores() {
        const naoLidas = _notificacoes.filter(n => !n.lidoPorMim).length;
        const total = _notificacoes.length;

        const elNaoLidas = document.getElementById('statNaoLidas');
        const elTotal = document.getElementById('statTotal');
        const badgeTab = document.getElementById('tabBadgeNaoLidas');

        if (elNaoLidas) elNaoLidas.textContent = naoLidas;
        if (elTotal) elTotal.textContent = total;
        if (badgeTab) {
            badgeTab.textContent = naoLidas;
            badgeTab.style.display = naoLidas > 0 ? 'inline-block' : 'none';
        }
    }

    function filtrarNotificacoes() {
        return _notificacoes.filter(n => {
            // Filtro por tipo
            if (_filtroAtual === 'nao-lidas' && n.lidoPorMim) return false;
            if (_filtroAtual === 'aviso' && !['aviso', 'comunicado', 'mural'].includes(n.tipo)) return false;
            if (_filtroAtual === 'frequencia' && !['frequencia', 'nota'].includes(n.tipo)) return false;
            if (_filtroAtual === 'sistema' && !['sistema', 'seguranca', 'alerta'].includes(n.tipo)) return false;

            // Busca textual
            if (_buscaTermo.trim()) {
                const termo = _buscaTermo.toLowerCase();
                const titulo = (n.titulo || '').toLowerCase();
                const mensagem = (n.mensagem || '').toLowerCase();
                if (!titulo.includes(termo) && !mensagem.includes(termo)) return false;
            }

            return true;
        });
    }

    function renderizarLista() {
        const container = document.getElementById('notifList');
        if (!container) return;

        const filtradas = filtrarNotificacoes();

        if (filtradas.length === 0) {
            container.innerHTML = `
                <div class="notif-empty-state motion-reveal">
                    <div class="notif-empty-icon">
                        <i class="bi bi-bell-slash"></i>
                    </div>
                    <h3 class="notif-empty-title">Nenhuma notificação encontrada</h3>
                    <p class="notif-empty-desc">${_buscaTermo || _filtroAtual !== 'todas' ? 'Tente ajustar os filtros ou a busca acima.' : 'Você está em dia com todos os avisos da escola!'}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = filtradas.map(n => {
            const tipoConfig = ICONES_TIPO[n.tipo] || ICONES_TIPO.default;
            const naoLida = !n.lidoPorMim;
            const tempo = formatarDataRelativa(n.dataCriacao || n.createdAt);

            return `
                <div class="notif-card-item ${naoLida ? 'nao-lida' : ''} tipo-${n.tipo || 'default'} motion-reveal" id="notif-item-${n.id}">
                    <div class="notif-card-icon" style="background: ${tipoConfig.bg}; color: ${tipoConfig.color};">
                        <i class="bi ${tipoConfig.icon}"></i>
                    </div>
                    <div class="notif-card-body">
                        <div class="notif-card-header">
                            <h4 class="notif-card-title">
                                ${escapeHtml(n.titulo || 'Notificação')}
                                <span class="notif-tag" style="background: ${tipoConfig.bg}; color: ${tipoConfig.color};">${tipoConfig.label}</span>
                            </h4>
                            <span class="notif-card-time">${tempo}</span>
                        </div>
                        <p class="notif-card-message">${escapeHtml(n.mensagem || '')}</p>
                        <div class="notif-card-actions">
                            <button type="button" class="notif-action-btn-sm" onclick="window.NotificacoesPage.alternarLida('${n.id}', ${naoLida})">
                                <i class="bi ${naoLida ? 'bi-check2' : 'bi-arrow-counterclockwise'}"></i>
                                ${naoLida ? 'Marcar como lida' : 'Marcar como não lida'}
                            </button>
                            <button type="button" class="notif-action-btn-sm" onclick="window.NotificacoesPage.ouvir('${escapeHtml(n.titulo)}: ${escapeHtml(n.mensagem)}')">
                                <i class="bi bi-volume-up"></i> Ouvir
                            </button>
                            ${n.link || (n.data && n.data.url) ? `
                                <a href="${n.link || n.data.url}" class="notif-action-btn-sm" style="text-decoration: none;">
                                    <i class="bi bi-box-arrow-up-right"></i> Abrir
                                </a>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function escapeHtml(text) {
        if (!text) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    async function alternarLida(id, marcarComoLida) {
        const notif = _notificacoes.find(n => n.id === id);
        if (notif) {
            notif.lidoPorMim = marcarComoLida;
            atualizarContadores();
            renderizarLista();
        }

        try {
            if (marcarComoLida) {
                await fetch(`${getApiBaseUrl()}/notificacoes/${id}/ler`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'X-CSRF-Token': getCsrfToken() || '' }
                });
            }
        } catch (err) {
            console.warn('[Notif] Falha ao atualizar status no servidor:', err);
        }
    }

    async function marcarTodasComoLidas() {
        _notificacoes.forEach(n => { n.lidoPorMim = true; });
        atualizarContadores();
        renderizarLista();

        try {
            await fetch(`${getApiBaseUrl()}/notificacoes/marcar-todas-lidas`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'X-CSRF-Token': getCsrfToken() || '' }
            });
        } catch (err) {
            console.warn('[Notif] Falha ao marcar todas como lidas:', err);
        }
    }

    function getCsrfToken() {
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    function ouvirTexto(texto) {
        if (!texto) return;
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(texto);
            utterance.lang = 'pt-BR';
            utterance.rate = 1.05;
            window.speechSynthesis.speak(utterance);
        }
    }

    // Configurações de Som
    function inicializarConfiguracoesSom() {
        if (!window.SomNotificacao) return;

        const switchAtivo = document.getElementById('switchSomAtivo');
        const containerSons = document.getElementById('soundOptionsContainer');
        const somAtual = window.SomNotificacao.obterSom ? window.SomNotificacao.obterSom() : 'notificacao';

        if (switchAtivo) {
            switchAtivo.checked = window.SomNotificacao.ativo ? window.SomNotificacao.ativo() : true;
            switchAtivo.addEventListener('change', () => {
                window.SomNotificacao.definir(switchAtivo.checked);
                atualizarStatSom();
            });
        }

        if (containerSons && window.SomNotificacao.listarSons) {
            const sons = window.SomNotificacao.listarSons();
            containerSons.innerHTML = sons.map(s => {
                const isSelected = s.id === somAtual;
                const isPrincipal = s.id === 'notificacao';
                return `
                    <div class="notif-sound-option ${isSelected ? 'selected' : ''}" data-sound-id="${s.id}" onclick="window.NotificacoesPage.selecionarSom('${s.id}')">
                        <div class="notif-sound-name">
                            <i class="bi ${isSelected ? 'bi-check-circle-fill' : 'bi-circle'}" style="color: ${isSelected ? 'var(--primary)' : 'var(--text-tertiary)'}"></i>
                            ${escapeHtml(s.nome)}
                            ${isPrincipal ? '<span class="notif-badge-principal">Principal</span>' : ''}
                        </div>
                        <button type="button" class="notif-action-btn-sm" onclick="event.stopPropagation(); window.NotificacoesPage.testarSom('${s.id}')" title="Ouvir som">
                            <i class="bi bi-play-fill"></i> Ouvir
                        </button>
                    </div>
                `;
            }).join('');
        }

        atualizarStatSom();
    }

    function selecionarSom(id) {
        if (!window.SomNotificacao) return;
        window.SomNotificacao.definirSom(id);
        window.SomNotificacao.testar(id);

        document.querySelectorAll('.notif-sound-option').forEach(el => {
            const sid = el.getAttribute('data-sound-id');
            const isSelected = sid === id;
            el.classList.toggle('selected', isSelected);
            const icon = el.querySelector('.bi');
            if (icon) {
                icon.className = isSelected ? 'bi bi-check-circle-fill' : 'bi bi-circle';
                icon.style.color = isSelected ? 'var(--primary)' : 'var(--text-tertiary)';
            }
        });

        atualizarStatSom();
    }

    function testarSom(id) {
        if (!window.SomNotificacao) return;
        window.SomNotificacao.testar(id);
    }

    function atualizarStatSom() {
        const elStat = document.getElementById('statSomStatus');
        const elSub = document.getElementById('statSomSub');
        if (!window.SomNotificacao) return;

        const ativo = window.SomNotificacao.ativo ? window.SomNotificacao.ativo() : true;
        const somId = window.SomNotificacao.obterSom ? window.SomNotificacao.obterSom() : 'notificacao';

        if (elStat) elStat.textContent = ativo ? 'Ativado' : 'Silencioso';
        if (elSub) {
            const sons = window.SomNotificacao.listarSons ? window.SomNotificacao.listarSons() : [];
            const somObj = sons.find(s => s.id === somId);
            elSub.textContent = ativo ? (somObj ? somObj.nome : 'Padrão') : 'Sem som';
        }
    }

    // Configurações de Push Web
    async function inicializarConfiguracoesPush() {
        const elPushStat = document.getElementById('statPushStatus');
        const elPushSub = document.getElementById('statPushSub');
        const elBtnAtivar = document.getElementById('btnAtivarPush');

        const suportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        if (!suportado) {
            if (elPushStat) elPushStat.textContent = 'Não Suportado';
            if (elPushSub) elPushSub.textContent = 'Navegador incompatível';
            if (elBtnAtivar) elBtnAtivar.disabled = true;
            return;
        }

        const permissao = Notification.permission;
        let inscrito = false;

        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            inscrito = !!sub;
        } catch {}

        if (elPushStat) {
            elPushStat.textContent = inscrito ? 'Ativo' : (permissao === 'denied' ? 'Bloqueado' : 'Inativo');
            elPushStat.style.color = inscrito ? 'var(--success, #10b981)' : (permissao === 'denied' ? 'var(--error, #ef4444)' : 'var(--text-primary)');
        }

        if (elPushSub) {
            elPushSub.textContent = inscrito ? 'Recebendo neste aparelho' : (permissao === 'denied' ? 'Permissão negada no navegador' : 'Toque para ativar');
        }

        if (elBtnAtivar) {
            if (inscrito) {
                elBtnAtivar.innerHTML = '<i class="bi bi-check-circle"></i> Push Ativado Neste Aparelho';
                elBtnAtivar.classList.remove('primary');
            } else {
                elBtnAtivar.innerHTML = '<i class="bi bi-bell"></i> Ativar Notificações Push';
                elBtnAtivar.classList.add('primary');
            }
        }
    }

    async function ativarPush() {
        if (!('Notification' in window)) {
            alert('Notificações não são suportadas neste navegador.');
            return;
        }

        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            alert('Permissão de notificações não foi concedida nas configurações do navegador.');
            inicializarConfiguracoesPush();
            return;
        }

        if (window.PushNotifications && window.PushNotifications.subscribe) {
            await window.PushNotifications.subscribe();
        }

        await inicializarConfiguracoesPush();
    }

    async function testarPush() {
        // Toca o som oficial configurado
        if (window.SomNotificacao) {
            window.SomNotificacao.receber();
        }

        // Se suporta notificação nativa
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                const reg = await navigator.serviceWorker.ready;
                reg.showNotification('Escola Jaguari — Teste de Notificação', {
                    body: 'Seu sistema de notificações e som está configurado e pronto!',
                    icon: '/img/icons/icon-192.png',
                    badge: '/img/icons/icon-192.png',
                    vibrate: [90, 60, 90, 60, 260],
                    data: { url: '/html/notificacoes.html' }
                });
            } catch {
                new Notification('Escola Jaguari — Teste de Notificação', {
                    body: 'Seu sistema de notificações e som está configurado e pronto!',
                    icon: '/img/icons/icon-192.png'
                });
            }
        } else {
            alert('Som tocado! Para ver a notificação na tela, ative as notificações push primeiro.');
        }
    }

    // Inicialização da Página
    document.addEventListener('DOMContentLoaded', () => {
        carregarUsuario();
        buscarNotificacoes();
        inicializarConfiguracoesSom();
        inicializarConfiguracoesPush();

        // Eventos de Busca e Filtros
        const inputBusca = document.getElementById('notifSearch');
        if (inputBusca) {
            inputBusca.addEventListener('input', (e) => {
                _buscaTermo = e.target.value;
                renderizarLista();
            });
        }

        document.querySelectorAll('.notif-pill-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.notif-pill-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _filtroAtual = btn.getAttribute('data-filtro') || 'todas';
                renderizarLista();
            });
        });

        // Alternância de Abas
        document.querySelectorAll('.notif-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.notif-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _abaAtual = btn.getAttribute('data-aba');

                const viewLista = document.getElementById('viewListaNotificacoes');
                const viewSettings = document.getElementById('viewConfiguracoes');

                if (_abaAtual === 'notificacoes') {
                    if (viewLista) viewLista.style.display = 'block';
                    if (viewSettings) viewSettings.style.display = 'none';
                } else {
                    if (viewLista) viewLista.style.display = 'none';
                    if (viewSettings) viewSettings.style.display = 'grid';
                }
            });
        });

        // Escutar Socket.IO em tempo real
        if (window.socket) {
            window.socket.on('notification:new', (notif) => {
                _notificacoes.unshift({
                    ...notif,
                    id: notif.id || String(notif._id),
                    lidoPorMim: false,
                    dataCriacao: notif.dataCriacao || new Date().toISOString()
                });
                atualizarContadores();
                renderizarLista();
                if (window.SomNotificacao) window.SomNotificacao.receber();
            });

            window.socket.on('notification:count', (data) => {
                if (typeof data.unreadCount === 'number') {
                    const elNaoLidas = document.getElementById('statNaoLidas');
                    if (elNaoLidas) elNaoLidas.textContent = data.unreadCount;
                }
            });
        }
    });

    // Public API
    window.NotificacoesPage = {
        recarregar: buscarNotificacoes,
        marcarTodasComoLidas,
        alternarLida,
        ouvir: ouvirTexto,
        selecionarSom,
        testarSom,
        ativarPush,
        testarPush
    };

})();
