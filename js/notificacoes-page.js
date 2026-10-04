/**
 * notificacoes-page.js
 * Lógica da Central Dedicada de Notificações para todas as contas.
 *
 * Duas fontes, as duas do banco (Issue #565):
 *   • `GET /api/notificacoes` — avisos da escola (coleção Notificacao): mural,
 *     comunicados, cadastros. A leitura é por pessoa, no array `lido`.
 *   • `GET /api/notifications/realtime` — notificações da própria pessoa
 *     (coleção RealtimeNotification): reações, avaliações, mensagens. É o que
 *     o sino mostra.
 * A página junta as duas numa lista só, e cada ação vai para a rota da origem.
 */

(function () {
    'use strict';

    /** @type {Array<object>} itens normalizados (ver `daEscola` e `pessoal`) */
    let _notificacoes = [];
    let _filtroAtual = 'todas';
    let _buscaTermo = '';
    let _usuarioAtual = null;
    let _primeiraCarga = true;

    // Não é `notifList`: esse id é da lista do sino, e o js/realtime.js
    // escreve nele quando chega notificação pelo Socket.IO.
    const ID_LISTA = 'centralNotifList';

    // Visual por grupo. `grupo` sai dos campos que o banco grava de fato
    // (categoria, tipo e prioridade da Notificacao; type da RealtimeNotification).
    const VISUAL = {
        aviso: {
            icon: 'bi-megaphone-fill',
            bg: 'rgba(14,165,233,0.15)',
            color: '#38bdf8',
            label: 'Aviso',
        },
        academico: {
            icon: 'bi-journal-check',
            bg: 'rgba(16,185,129,0.12)',
            color: '#34d399',
            label: 'Acadêmico',
        },
        evento: {
            icon: 'bi-calendar-event-fill',
            bg: 'rgba(168,85,247,0.12)',
            color: '#c084fc',
            label: 'Evento',
        },
        saude: {
            icon: 'bi-heart-pulse-fill',
            bg: 'rgba(244,63,94,0.12)',
            color: '#fb7185',
            label: 'Saúde',
        },
        financeiro: {
            icon: 'bi-cash-coin',
            bg: 'rgba(234,179,8,0.12)',
            color: '#facc15',
            label: 'Financeiro',
        },
        interacao: {
            icon: 'bi-chat-heart-fill',
            bg: 'rgba(59,130,246,0.12)',
            color: '#60a5fa',
            label: 'Interação',
        },
        sistema: {
            icon: 'bi-gear-fill',
            bg: 'rgba(245,158,11,0.12)',
            color: '#fbbf24',
            label: 'Sistema',
        },
    };

    const CATEGORIA_DO_AVISO = {
        academico: 'academico',
        evento: 'evento',
        saude: 'saude',
        financeiro: 'financeiro',
        sistema: 'sistema',
    };
    const TIPOS_DE_SISTEMA = ['cadastro', 'sistema', 'alerta', 'seguranca', 'resumo_diario'];

    function getApiBaseUrl() {
        return window.API_BASE_URL || window.location.origin + '/api';
    }

    function cabecalhosEscrita() {
        if (typeof window.csrfHeaders === 'function') return window.csrfHeaders(false);
        const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
        return match ? { 'X-CSRF-Token': decodeURIComponent(match[1]) } : {};
    }

    async function api(caminho, opcoes) {
        const metodo = (opcoes && opcoes.method) || 'GET';
        const escrita = metodo !== 'GET';
        const res = await fetch(`${getApiBaseUrl()}${caminho}`, {
            method: metodo,
            credentials: 'include',
            headers: escrita ? cabecalhosEscrita() : {},
            // "Abrir" marca como lida e navega em seguida: sem keepalive a
            // escrita seria cortada pela troca de página.
            keepalive: escrita,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json().catch(() => ({}));
    }

    /**
     * Só caminho interno vira link. `linkUrl` vem do banco e entra num `href`:
     * `javascript:` ou `//outro-site` ali seriam um clique para fora do sistema.
     */
    function linkSeguro(url) {
        if (typeof url !== 'string') return '';
        const limpo = url.trim();
        return /^\/(?![/\\])/.test(limpo) ? limpo : '';
    }

    // ── Normalização das duas coleções ────────────────────────────────────

    function daEscola(n) {
        const categoria = String(n.categoria || '').toLowerCase();
        const tipo = String(n.tipo || '').toLowerCase();
        const id = String(n.id || n._id || '');
        let grupo = CATEGORIA_DO_AVISO[categoria] || 'aviso';
        if (TIPOS_DE_SISTEMA.includes(tipo)) grupo = 'sistema';
        return {
            chave: `escola:${id}`,
            origem: 'escola',
            id,
            titulo: n.titulo || 'Aviso da escola',
            mensagem: n.mensagem || '',
            data: n.dataEnvio || n.dataCriacao || n.createdAt,
            lida: Boolean(n.lidoPorMim),
            grupo,
            importante: n.prioridade === 'alta',
            link: linkSeguro(n.link),
        };
    }

    function pessoal(n) {
        const tipo = String(n.type || '').toLowerCase();
        const id = String(n._id || '');
        return {
            chave: `pessoal:${id}`,
            origem: 'pessoal',
            id,
            titulo: n.title || 'Notificação',
            mensagem: n.message || '',
            data: n.createdAt,
            lida: Boolean(n.read),
            grupo: tipo === 'system' || tipo === 'alert' ? 'sistema' : 'interacao',
            importante: tipo === 'alert',
            link: linkSeguro(n.linkUrl),
        };
    }

    function porDataDesc(a, b) {
        return new Date(b.data || 0) - new Date(a.data || 0);
    }

    function formatarDataRelativa(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        if (Number.isNaN(d.getTime())) return '';
        const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
        if (diffMin < 1) return 'Agora mesmo';
        if (diffMin < 60) return `Há ${diffMin} min`;
        const diffHoras = Math.floor(diffMin / 60);
        if (diffHoras < 24) return `Há ${diffHoras}h`;
        const diffDias = Math.floor(diffHoras / 24);
        if (diffDias === 1)
            return (
                'Ontem às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            );
        if (diffDias < 7) return `Há ${diffDias} dias`;
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function dataCompleta(isoStr) {
        const d = new Date(isoStr);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR');
    }

    // ── Cabeçalho ─────────────────────────────────────────────────────────

    const ROTULO_PERFIL = {
        admin: 'Administração',
        diretor: 'Direção',
        secretaria: 'Secretaria',
        professor: 'Professor(a)',
        responsavel: 'Responsável',
    };

    async function carregarUsuario() {
        try {
            const data = await api('/auth/me');
            _usuarioAtual = data.user || data.data || null;
            atualizarHeaderUsuario();
        } catch (err) {
            console.warn('[Notif] Não foi possível carregar perfil:', err);
        }
    }

    function atualizarHeaderUsuario() {
        if (!_usuarioAtual) return;
        const elNome = document.getElementById('userName');
        const elCargo = document.getElementById('userCargo');
        const elAvatar = document.getElementById('userAvatar');
        const perfil = String(_usuarioAtual.perfil || '').toLowerCase();
        if (elNome) elNome.textContent = _usuarioAtual.nome || 'Usuário';
        if (elCargo) elCargo.textContent = ROTULO_PERFIL[perfil] || perfil;
        const foto = linkSeguro(_usuarioAtual.foto) || linkSeguro(_usuarioAtual.fotoUrl);
        if (elAvatar && foto) elAvatar.src = foto;

        // O "Voltar" sem histórico leva ao painel de quem está olhando.
        const voltar = document.getElementById('btnVoltar');
        if (voltar && perfil === 'secretaria')
            voltar.dataset.fallback = '/html/secretaria/painel.html';
        if (voltar && perfil === 'responsavel')
            voltar.dataset.fallback = '/portal-responsavel/dist/index.html';
    }

    // ── Lista ─────────────────────────────────────────────────────────────

    async function buscarNotificacoes() {
        if (!document.getElementById(ID_LISTA)) return;
        if (_primeiraCarga) renderizarSkeletons();

        // As duas fontes em paralelo. Uma fora do ar não esconde a outra.
        const [escola, pessoais] = await Promise.allSettled([
            api('/notificacoes'),
            api('/notifications/realtime'),
        ]);

        if (escola.status === 'rejected' && pessoais.status === 'rejected') {
            console.error('[Notif] Erro ao carregar:', escola.reason, pessoais.reason);
            renderizarErro();
            return;
        }

        const lista = [];
        if (escola.status === 'fulfilled' && Array.isArray(escola.value.data))
            lista.push(...escola.value.data.map(daEscola));
        if (pessoais.status === 'fulfilled' && Array.isArray(pessoais.value.data))
            lista.push(...pessoais.value.data.map(pessoal));

        _notificacoes = lista.sort(porDataDesc);
        atualizarContadores();
        renderizarLista(_primeiraCarga);
        _primeiraCarga = false;
    }

    function renderizarSkeletons() {
        const container = document.getElementById(ID_LISTA);
        if (!container) return;
        container.setAttribute('aria-busy', 'true');
        let html = '';
        for (let i = 0; i < 4; i++) {
            html += `
                <div class="notif-skeleton-card" aria-hidden="true">
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

    function renderizarErro() {
        const container = document.getElementById(ID_LISTA);
        if (!container) return;
        container.removeAttribute('aria-busy');
        container.innerHTML = `
            <div class="notif-empty-state">
                <div class="notif-empty-icon" style="background: rgba(239, 68, 68, 0.1); color: var(--error, #ef4444);">
                    <i class="bi bi-exclamation-triangle"></i>
                </div>
                <h3 class="notif-empty-title">Não foi possível carregar as notificações</h3>
                <p class="notif-empty-desc">Verifique sua conexão e tente novamente.</p>
                <button type="button" class="notif-btn-action primary" data-acao="recarregar">
                    <i class="bi bi-arrow-clockwise"></i> Tentar novamente
                </button>
            </div>
        `;
    }

    function atualizarContadores() {
        const naoLidas = _notificacoes.filter((n) => !n.lida).length;

        const elNaoLidas = document.getElementById('statNaoLidas');
        const elTotal = document.getElementById('statTotal');
        const badgeTab = document.getElementById('tabBadgeNaoLidas');

        if (elNaoLidas) elNaoLidas.textContent = naoLidas;
        if (elTotal) elTotal.textContent = _notificacoes.length;
        if (badgeTab) {
            badgeTab.textContent = naoLidas;
            badgeTab.style.display = naoLidas > 0 ? 'inline-block' : 'none';
        }
    }

    function passaNoFiltro(n) {
        switch (_filtroAtual) {
            case 'nao-lidas':
                return !n.lida;
            case 'importantes':
                return n.importante;
            case 'escola':
                return n.origem === 'escola' && n.grupo !== 'sistema';
            case 'academico':
                return n.grupo === 'academico';
            case 'interacoes':
                return n.grupo === 'interacao';
            case 'sistema':
                return n.grupo === 'sistema';
            default:
                return true;
        }
    }

    function filtrarNotificacoes() {
        const termo = _buscaTermo.trim().toLowerCase();
        return _notificacoes.filter((n) => {
            if (!passaNoFiltro(n)) return false;
            if (!termo) return true;
            return (
                n.titulo.toLowerCase().includes(termo) || n.mensagem.toLowerCase().includes(termo)
            );
        });
    }

    function cartao(n, revelar) {
        const visual = VISUAL[n.grupo] || VISUAL.aviso;
        const origem = n.origem === 'escola' ? 'Aviso da escola' : 'Para você';
        return `
            <article class="notif-card-item ${n.lida ? '' : 'nao-lida'} tipo-${n.grupo}"${revelar ? ' data-reveal' : ''} data-chave="${escapeHtml(n.chave)}">
                <div class="notif-card-icon" style="background: ${visual.bg}; color: ${visual.color};" aria-hidden="true">
                    <i class="bi ${visual.icon}"></i>
                </div>
                <div class="notif-card-body">
                    <div class="notif-card-header">
                        <h4 class="notif-card-title">
                            ${escapeHtml(n.titulo)}
                            <span class="notif-tag" style="background: ${visual.bg}; color: ${visual.color};">${visual.label}</span>
                            ${n.importante ? '<span class="notif-tag notif-tag-importante">Importante</span>' : ''}
                            ${n.lida ? '' : '<span class="sr-only">(não lida)</span>'}
                        </h4>
                        <time class="notif-card-time" datetime="${escapeHtml(n.data || '')}" title="${escapeHtml(dataCompleta(n.data))}">${formatarDataRelativa(n.data)}</time>
                    </div>
                    <p class="notif-card-message">${escapeHtml(n.mensagem)}</p>
                    <div class="notif-card-actions">
                        <span class="notif-card-origem">${origem}</span>
                        <button type="button" class="notif-action-btn-sm" data-acao="alternar-lida">
                            <i class="bi ${n.lida ? 'bi-arrow-counterclockwise' : 'bi-check2'}"></i>
                            ${n.lida ? 'Marcar como não lida' : 'Marcar como lida'}
                        </button>
                        <button type="button" class="notif-action-btn-sm" data-acao="ouvir">
                            <i class="bi bi-volume-up"></i> Ouvir
                        </button>
                        ${
                            n.link
                                ? `<a href="${escapeHtml(n.link)}" class="notif-action-btn-sm" data-acao="abrir" style="text-decoration: none;">
                                <i class="bi bi-box-arrow-up-right"></i> Abrir
                            </a>`
                                : ''
                        }
                    </div>
                </div>
            </article>
        `;
    }

    /**
     * @param {boolean} revelar entrada animada (só na primeira carga). Filtro,
     *   busca e marcar como lida são ações de alta frequência: não animam.
     *   A marca é `data-reveal`, que o js/motion.js observa — a classe
     *   `motion-reveal` posta à mão deixava o cartão em `opacity: 0` para sempre.
     */
    function renderizarLista(revelar) {
        const container = document.getElementById(ID_LISTA);
        if (!container) return;
        container.removeAttribute('aria-busy');

        const filtradas = filtrarNotificacoes();

        if (filtradas.length === 0) {
            const filtrando = _buscaTermo.trim() || _filtroAtual !== 'todas';
            container.innerHTML = `
                <div class="notif-empty-state">
                    <div class="notif-empty-icon">
                        <i class="bi bi-bell-slash"></i>
                    </div>
                    <h3 class="notif-empty-title">${filtrando ? 'Nenhuma notificação encontrada' : 'Nenhuma notificação por aqui'}</h3>
                    <p class="notif-empty-desc">${filtrando ? 'Tente ajustar os filtros ou a busca acima.' : 'Quando a escola enviar um aviso ou alguém interagir com você, ele aparece aqui.'}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = filtradas.map((n) => cartao(n, revelar)).join('');
    }

    function escapeHtml(text) {
        if (!text) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"']/g, (m) => map[m]);
    }

    function itemPorChave(chave) {
        return _notificacoes.find((n) => n.chave === chave);
    }

    function rotaDeLeitura(n, marcarComoLida) {
        if (n.origem === 'escola') {
            return {
                caminho: `/notificacoes/${encodeURIComponent(n.id)}/ler`,
                method: marcarComoLida ? 'PUT' : 'DELETE',
            };
        }
        return {
            caminho: `/notifications/realtime/${marcarComoLida ? 'read' : 'unread'}/${encodeURIComponent(n.id)}`,
            method: 'PUT',
        };
    }

    async function alternarLida(chave) {
        const n = itemPorChave(chave);
        if (!n) return;
        const marcarComoLida = !n.lida;

        // Otimista, com volta atrás se o servidor recusar.
        n.lida = marcarComoLida;
        atualizarContadores();
        renderizarLista(false);

        try {
            const rota = rotaDeLeitura(n, marcarComoLida);
            await api(rota.caminho, { method: rota.method });
        } catch (err) {
            console.warn('[Notif] Falha ao atualizar status no servidor:', err);
            n.lida = !marcarComoLida;
            atualizarContadores();
            renderizarLista(false);
            avisar('Não foi possível salvar. Tente novamente.');
        }
    }

    async function marcarTodasComoLidas() {
        if (!_notificacoes.some((n) => !n.lida)) return;
        _notificacoes.forEach((n) => {
            n.lida = true;
        });
        atualizarContadores();
        renderizarLista(false);

        const resultados = await Promise.allSettled([
            api('/notificacoes/marcar-todas-lidas', { method: 'PUT' }),
            api('/notifications/realtime/read-all', { method: 'PUT' }),
        ]);
        if (resultados.some((r) => r.status === 'rejected')) {
            console.warn('[Notif] Falha ao marcar todas como lidas:', resultados);
            avisar('Algumas notificações não puderam ser marcadas. Recarregando…');
            await buscarNotificacoes();
        }
    }

    function avisar(texto) {
        if (typeof window.showToast === 'function') {
            window.showToast(texto, 'error');
            return;
        }
        const regiao = document.getElementById('notifAvisoStatus');
        if (regiao) regiao.textContent = texto;
    }

    /** Notificação recebida pelo Socket.IO (ver js/realtime.js). */
    function receberNova(item) {
        if (!item.id || itemPorChave(item.chave)) return;
        _notificacoes.unshift(item);
        atualizarContadores();
        renderizarLista(false);
        const novo = document.querySelector(
            `#${ID_LISTA} [data-chave="${CSS.escape(item.chave)}"]`
        );
        if (novo) novo.setAttribute('data-reveal', '');
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
        const somAtual = window.SomNotificacao.obterSom
            ? window.SomNotificacao.obterSom()
            : 'notificacao';

        if (switchAtivo) {
            switchAtivo.checked = window.SomNotificacao.ativo
                ? window.SomNotificacao.ativo()
                : true;
            switchAtivo.addEventListener('change', () => {
                window.SomNotificacao.definir(switchAtivo.checked);
                atualizarStatSom();
            });
        }

        if (containerSons && window.SomNotificacao.listarSons) {
            const sons = window.SomNotificacao.listarSons();
            containerSons.innerHTML = sons
                .map((s) => {
                    const isSelected = s.id === somAtual;
                    const isPrincipal = s.id === 'notificacao';
                    return `
                    <div class="notif-sound-option ${isSelected ? 'selected' : ''}" data-sound-id="${escapeHtml(s.id)}" data-acao="selecionar-som" role="radio" aria-checked="${isSelected}" tabindex="0">
                        <div class="notif-sound-name">
                            <i class="bi ${isSelected ? 'bi-check-circle-fill' : 'bi-circle'}" style="color: ${isSelected ? 'var(--primary)' : 'var(--text-tertiary)'}"></i>
                            ${escapeHtml(s.nome)}
                            ${isPrincipal ? '<span class="notif-badge-principal">Principal</span>' : ''}
                        </div>
                        <button type="button" class="notif-action-btn-sm" data-acao="testar-som" title="Ouvir som">
                            <i class="bi bi-play-fill"></i> Ouvir
                        </button>
                    </div>
                `;
                })
                .join('');
        }

        atualizarStatSom();
    }

    function selecionarSom(id) {
        if (!window.SomNotificacao || !id) return;
        window.SomNotificacao.definirSom(id);
        window.SomNotificacao.testar(id);

        document.querySelectorAll('.notif-sound-option').forEach((el) => {
            const isSelected = el.getAttribute('data-sound-id') === id;
            el.classList.toggle('selected', isSelected);
            el.setAttribute('aria-checked', String(isSelected));
            const icon = el.querySelector('.notif-sound-name .bi');
            if (icon) {
                icon.className = isSelected ? 'bi bi-check-circle-fill' : 'bi bi-circle';
                icon.style.color = isSelected ? 'var(--primary)' : 'var(--text-tertiary)';
            }
        });

        atualizarStatSom();
    }

    function testarSom(id) {
        if (!window.SomNotificacao || !id) return;
        window.SomNotificacao.testar(id);
    }

    function atualizarStatSom() {
        const elStat = document.getElementById('statSomStatus');
        const elSub = document.getElementById('statSomSub');
        if (!window.SomNotificacao) return;

        const ativo = window.SomNotificacao.ativo ? window.SomNotificacao.ativo() : true;
        const somId = window.SomNotificacao.obterSom
            ? window.SomNotificacao.obterSom()
            : 'notificacao';

        if (elStat) elStat.textContent = ativo ? 'Ativado' : 'Silencioso';
        if (elSub) {
            const sons = window.SomNotificacao.listarSons ? window.SomNotificacao.listarSons() : [];
            const somObj = sons.find((s) => s.id === somId);
            elSub.textContent = ativo ? (somObj ? somObj.nome : 'Padrão') : 'Sem som';
        }
    }

    // ── Push Web ──────────────────────────────────────────────────────────

    /**
     * Inscrição deste aparelho, sem travar. `navigator.serviceWorker.ready`
     * nunca resolve quando não há service worker registrado — era o
     * "Verificando..." eterno no card de push.
     */
    async function inscricaoDoAparelho() {
        try {
            const reg = await Promise.race([
                navigator.serviceWorker.getRegistration('/'),
                new Promise((resolve) => setTimeout(resolve, 3000)),
            ]);
            if (!reg || !reg.pushManager) return null;
            return await reg.pushManager.getSubscription();
        } catch {
            return null;
        }
    }

    function estadoPush(texto, sub, cor, tag) {
        const elPushStat = document.getElementById('statPushStatus');
        const elPushSub = document.getElementById('statPushSub');
        const elTag = document.getElementById('tagStatusDispositivo');
        if (elPushStat) {
            elPushStat.textContent = texto;
            elPushStat.style.color = cor;
        }
        if (elPushSub) elPushSub.textContent = sub;
        if (elTag) {
            elTag.textContent = tag;
            elTag.style.color = cor;
        }
    }

    async function inicializarConfiguracoesPush() {
        const elBtnAtivar = document.getElementById('btnAtivarPush');
        const verde = 'var(--success, #10b981)';
        const vermelho = 'var(--error, #ef4444)';
        const neutro = 'var(--text-secondary, #94a3b8)';

        const suportado =
            'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        if (!suportado) {
            estadoPush('Não suportado', 'Navegador incompatível', neutro, 'Indisponível');
            if (elBtnAtivar) elBtnAtivar.disabled = true;
            return;
        }

        const permissao = Notification.permission;
        const inscrito = permissao === 'granted' && Boolean(await inscricaoDoAparelho());

        if (inscrito) {
            estadoPush('Ativo', 'Recebendo neste aparelho', verde, 'Conectado');
        } else if (permissao === 'denied') {
            estadoPush('Bloqueado', 'Permissão negada no navegador', vermelho, 'Bloqueado');
        } else {
            estadoPush('Inativo', 'Toque em "Ativar" para receber', neutro, 'Desconectado');
        }

        if (elBtnAtivar) {
            elBtnAtivar.disabled = permissao === 'denied';
            if (inscrito) {
                elBtnAtivar.innerHTML =
                    '<i class="bi bi-check-circle"></i> Push ativado neste aparelho';
                elBtnAtivar.classList.remove('primary');
            } else {
                elBtnAtivar.innerHTML = '<i class="bi bi-bell"></i> Ativar Notificações Push';
                elBtnAtivar.classList.add('primary');
            }
        }
    }

    async function ativarPush() {
        // `PushNotifications.enable()` pede a permissão, trata o iPhone fora da
        // Tela de Início e só devolve `true` depois que o backend grava a
        // inscrição no banco. A página chamava `.subscribe()`, que não existe:
        // o aparelho nunca era inscrito.
        if (!window.PushNotifications || !window.PushNotifications.enable) {
            avisar('Notificações push indisponíveis nesta página.');
            return;
        }
        const ok = await window.PushNotifications.enable();
        if (!ok && 'Notification' in window && Notification.permission === 'denied') {
            avisar('A permissão de notificações foi negada nas configurações do navegador.');
        }
        await inicializarConfiguracoesPush();
    }

    async function testarPush() {
        // Toca o som oficial configurado
        if (window.SomNotificacao) {
            window.SomNotificacao.receber();
        }

        if (!('Notification' in window) || Notification.permission !== 'granted') {
            avisar('Som tocado! Para ver a notificação na tela, ative as notificações push.');
            return;
        }
        const opcoes = {
            body: 'Seu sistema de notificações e som está configurado e pronto!',
            icon: '/img/icons/icon-192.png',
            badge: '/img/icons/icon-192.png',
            vibrate: [90, 60, 90, 60, 260],
            data: { url: '/html/notificacoes.html' },
        };
        try {
            const reg = await navigator.serviceWorker.getRegistration('/');
            if (!reg) throw new Error('sem service worker');
            await reg.showNotification('Teste de Notificação', opcoes);
        } catch {
            new Notification('Teste de Notificação', opcoes);
        }
    }

    // ── Eventos ───────────────────────────────────────────────────────────

    function mostrarAba(aba) {
        document.querySelectorAll('.notif-tab-btn').forEach((b) => {
            const ativa = b.getAttribute('data-aba') === aba;
            b.classList.toggle('active', ativa);
            b.setAttribute('aria-selected', String(ativa));
        });
        const viewLista = document.getElementById('viewListaNotificacoes');
        const viewSettings = document.getElementById('viewConfiguracoes');
        if (viewLista) viewLista.style.display = aba === 'notificacoes' ? 'block' : 'none';
        if (viewSettings) viewSettings.style.display = aba === 'notificacoes' ? 'none' : 'grid';
    }

    // Um ouvinte só, por delegação: nada de `onclick` com texto do banco
    // dentro de string JS — um apóstrofo no título quebrava o "Ouvir".
    function aoClicar(e) {
        const alvo = e.target.closest('[data-acao]');
        if (!alvo) return;
        const acao = alvo.getAttribute('data-acao');
        const card = alvo.closest('[data-chave]');
        const item = card ? itemPorChave(card.getAttribute('data-chave')) : null;

        switch (acao) {
            case 'alternar-lida':
                if (item) alternarLida(item.chave);
                break;
            case 'ouvir':
                if (item) ouvirTexto(`${item.titulo}. ${item.mensagem}`);
                break;
            case 'abrir':
                // Abrir também conta como leitura.
                if (item && !item.lida) alternarLida(item.chave);
                break;
            case 'recarregar':
                buscarNotificacoes();
                break;
            case 'marcar-todas':
                marcarTodasComoLidas();
                break;
            case 'ativar-push':
                ativarPush();
                break;
            case 'testar-push':
                testarPush();
                break;
            case 'testar-som':
                e.stopPropagation();
                testarSom(alvo.closest('[data-sound-id]')?.getAttribute('data-sound-id'));
                break;
            case 'selecionar-som':
                selecionarSom(alvo.getAttribute('data-sound-id'));
                break;
        }
    }

    /**
     * Logo que não carrega cai na imagem de reserva. Era um `onerror` inline
     * (épico #612); o script roda com `defer`, então confere também a que já
     * falhou antes dele. Troca uma vez só, para a reserva quebrada não girar.
     */
    function usarImagemDeReserva(img) {
        const reserva = img.dataset.reserva;
        if (!reserva) return;
        delete img.dataset.reserva;
        img.src = reserva;
    }
    document.querySelectorAll('img[data-reserva]').forEach((img) => {
        if (img.complete && img.naturalWidth === 0) usarImagemDeReserva(img);
        else img.addEventListener('error', () => usarImagemDeReserva(img), { once: true });
    });

    // Inicialização da Página
    document.addEventListener('DOMContentLoaded', () => {
        carregarUsuario();
        buscarNotificacoes();
        inicializarConfiguracoesSom();
        inicializarConfiguracoesPush();

        document.addEventListener('click', aoClicar);
        document.addEventListener('keydown', (e) => {
            const som = e.target.closest ? e.target.closest('[data-acao="selecionar-som"]') : null;
            if (som && e.target === som && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                selecionarSom(som.getAttribute('data-sound-id'));
            }
        });

        const inputBusca = document.getElementById('notifSearch');
        if (inputBusca) {
            inputBusca.addEventListener('input', (e) => {
                _buscaTermo = e.target.value;
                renderizarLista(false);
            });
        }

        document.querySelectorAll('.notif-pill-filter').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.notif-pill-filter').forEach((b) => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', String(b === btn));
                });
                _filtroAtual = btn.getAttribute('data-filtro') || 'todas';
                renderizarLista(false);
            });
        });

        document.querySelectorAll('.notif-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => mostrarAba(btn.getAttribute('data-aba')));
        });

        // Tempo real: o js/realtime.js recebe pelo Socket.IO e repassa como
        // evento de DOM — som e toast já saem de lá.
        document.addEventListener('notificacao:nova', (e) => {
            if (e.detail) receberNova(daEscola({ ...e.detail, lidoPorMim: false }));
        });
        document.addEventListener('notificacao-pessoal:nova', (e) => {
            if (e.detail) receberNova(pessoal({ ...e.detail, read: false }));
        });

        // Voltar à aba com a página aberta há tempo: busca de novo no banco.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !_primeiraCarga) buscarNotificacoes();
        });
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
        testarPush,
    };
})();
