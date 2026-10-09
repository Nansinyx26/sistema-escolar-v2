/**
 * autorizacoes-ferramentas.js — página da direção (Issue #741, épico #720).
 *
 * Lê da API o quadro professores × ferramentas da escola e os pedidos
 * pendentes. Autorizar/Revogar só MARCA a alteração na tela; "Salvar
 * autorizações" manda o lote ao backend, que confere a direção, a escola e
 * cada professor antes de gravar. Pedido pendente é decidido direto (autorizar
 * ou recusar), porque o professor recebe o aviso na hora.
 *
 * Nada de decisão fica no navegador: depois de salvar, a tela relê o banco.
 */
document.addEventListener('DOMContentLoaded', () => {
    let user = null;
    try {
        user = JSON.parse(sessionStorage.getItem('currentUser'));
    } catch (_e) {
        user = null;
    }
    if (!user || !['diretor', 'admin'].includes(user.perfil)) {
        window.location.href = '../login.html';
        return;
    }

    const $ = (id) => document.getElementById(id);
    const nomeEl = $('sidebarUserName');
    const papelEl = $('sidebarUserRole');
    if (nomeEl) nomeEl.textContent = user.nome || 'Diretor';
    if (papelEl) papelEl.textContent = user.perfil === 'admin' ? 'Administrador' : 'Diretor';

    const API = (window.API_BASE_URL || `${window.location.origin}/api`).replace(/\/$/, '');
    const corpo = $('corpoTabela');
    const btnSalvar = $('btnSalvar');
    const contador = $('contadorPendentes');
    const filtros = {
        busca: $('filtroBusca'),
        professor: $('filtroProfessor'),
        ferramenta: $('filtroFerramenta'),
        status: $('filtroStatus'),
    };

    const TEXTO_STATUS = {
        autorizado: { rotulo: 'Autorizado', icone: 'bi-check-circle-fill' },
        bloqueado: { rotulo: 'Não autorizado', icone: 'bi-x-circle-fill' },
        pendente: { rotulo: 'Pendente', icone: 'bi-hourglass-split' },
    };

    let quadro = { categorias: [], professores: [] };
    let pedidos = [];
    // professorId|ferramentaId → true/false (alterações ainda não salvas)
    const alteracoes = new Map();
    let pedidoDestacado = new URLSearchParams(window.location.search).get('solicitacao');

    function esc(valor) {
        return String(valor == null ? '' : valor)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function avisar(mensagem, tipo) {
        if (typeof window.showToast === 'function') window.showToast(mensagem, tipo);
        else window.alert(mensagem);
    }

    function lerCsrf() {
        const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    async function api(caminho, { method = 'GET', body } = {}) {
        const res = await fetch(`${API}${caminho}`, {
            method,
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...(method !== 'GET' ? { 'X-CSRF-Token': lerCsrf() } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) {
            const erro = new Error(json.error || 'Não foi possível concluir a operação.');
            erro.status = res.status;
            throw erro;
        }
        return json;
    }

    function formatarData(valor) {
        if (!valor) return '—';
        const d = new Date(valor);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    // ── Catálogo: id → { nome, categoria } ───────────────────────────────────
    function ferramentasDoCatalogo() {
        return quadro.categorias.flatMap((c) =>
            c.ferramentas.map((f) => ({ ...f, categoria: c.nome }))
        );
    }

    function chave(professorId, ferramentaId) {
        return `${professorId}|${ferramentaId}`;
    }

    /** Estado mostrado: o do banco, ou o marcado e ainda não salvo. */
    function estadoDa(professor, ferramentaId) {
        const celula = professor.ferramentas[ferramentaId] || { status: 'bloqueado' };
        const k = chave(professor.id, ferramentaId);
        if (!alteracoes.has(k)) return { ...celula, alterada: false };
        return {
            ...celula,
            status: alteracoes.get(k) ? 'autorizado' : 'bloqueado',
            alterada: true,
        };
    }

    // ── Carregamento ─────────────────────────────────────────────────────────
    function mostrarSkeleton() {
        const linha = `<tr>${'<td><span class="af-skel"></span></td>'.repeat(6)}</tr>`;
        corpo.innerHTML = linha.repeat(5);
    }

    function mostrarEstado(icone, titulo, texto, erro = false) {
        corpo.innerHTML = `
            <tr><td colspan="6">
                <div class="empty-box${erro ? ' is-error' : ''}">
                    <div class="empty-icon"><i class="bi ${icone}"></i></div>
                    <h4>${esc(titulo)}</h4>
                    <p>${esc(texto)}</p>
                </div>
            </td></tr>`;
    }

    async function carregarEscola() {
        try {
            const json = await api('/escolas/minhas');
            const escola =
                (json.data || []).find((e) => String(e._id) === String(json.escolaAtivaId)) ||
                (json.data?.length === 1 ? json.data[0] : null);
            if (escola) {
                $('escolaAtivaNomeTexto').textContent = escola.nome;
                $('escolaAtivaBadge').hidden = false;
            }
        } catch (_e) {
            // Informativo: sem o nome da escola a página continua funcionando.
        }
    }

    async function carregar() {
        mostrarSkeleton();
        try {
            const [resQuadro, resPedidos] = await Promise.all([
                api('/ferramentas/autorizacoes'),
                api('/ferramentas/solicitacoes?status=pendente'),
            ]);
            quadro = resQuadro.data;
            pedidos = resPedidos.data || [];
            montarFiltros();
            desenharTudo();
        } catch (e) {
            mostrarEstado(
                'bi-exclamation-triangle-fill',
                'Não foi possível carregar as autorizações',
                e.message,
                true
            );
        }
    }

    // ── Filtros ──────────────────────────────────────────────────────────────
    function montarFiltros() {
        const profAtual = filtros.professor.value;
        filtros.professor.innerHTML =
            '<option value="">Todos os professores</option>' +
            quadro.professores
                .map((p) => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`)
                .join('');
        filtros.professor.value = profAtual;

        const ferrAtual = filtros.ferramenta.value;
        filtros.ferramenta.innerHTML =
            '<option value="">Todas as ferramentas</option>' +
            quadro.categorias
                .filter((c) => c.ferramentas.length)
                .map(
                    (c) =>
                        `<optgroup label="${esc(c.nome)}">${c.ferramentas
                            .map((f) => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`)
                            .join('')}</optgroup>`
                )
                .join('');
        filtros.ferramenta.value = ferrAtual;
    }

    function linhasFiltradas() {
        const busca = filtros.busca.value.trim().toLocaleLowerCase('pt-BR');
        const profId = filtros.professor.value;
        const ferrId = filtros.ferramenta.value;
        const status = filtros.status.value;
        const linhas = [];
        for (const professor of quadro.professores) {
            if (profId && professor.id !== profId) continue;
            if (busca && !professor.nome.toLocaleLowerCase('pt-BR').includes(busca)) continue;
            for (const f of ferramentasDoCatalogo()) {
                if (ferrId && f.id !== ferrId) continue;
                const estado = estadoDa(professor, f.id);
                if (status && estado.status !== status) continue;
                linhas.push({ professor, ferramenta: f, estado });
            }
        }
        return linhas;
    }

    // ── Desenho ──────────────────────────────────────────────────────────────
    function desenharTudo() {
        desenharResumo();
        desenharPedidos();
        desenharTabela();
        atualizarBotaoSalvar();
    }

    function desenharResumo() {
        $('statProfessores').textContent = quadro.professores.length;
        let ativas = 0;
        for (const p of quadro.professores) {
            for (const c of Object.values(p.ferramentas)) if (c.status === 'autorizado') ativas++;
        }
        $('statAutorizadas').textContent = ativas;
        $('statPedidos').textContent = pedidos.length;
    }

    function desenharPedidos() {
        const card = $('cardPedidos');
        const lista = $('listaPedidos');
        card.hidden = pedidos.length === 0;
        lista.innerHTML = pedidos
            .map(
                (p) => `
            <li class="af-pedido${p.id === pedidoDestacado ? ' af-destaque' : ''}" id="pedido-${esc(p.id)}">
                <div>
                    <span class="af-pedido-quem">${esc(p.professor.nome)}</span>
                    <span class="af-sub">pediu <strong>${esc(p.ferramenta.nome)}</strong> em ${esc(formatarData(p.criadaEm))}</span>
                    ${p.mensagem ? `<p class="af-pedido-msg">“${esc(p.mensagem)}”</p>` : ''}
                </div>
                <div class="af-pedido-acoes">
                    <button type="button" class="btn-action af-acao af-acao-autorizar" data-decidir="autorizar" data-id="${esc(p.id)}">
                        <i class="bi bi-check-lg"></i> Autorizar
                    </button>
                    <button type="button" class="btn-action af-acao af-acao-revogar" data-decidir="recusar" data-id="${esc(p.id)}">
                        <i class="bi bi-x-lg"></i> Recusar
                    </button>
                    <a class="btn-action" href="/html/direcao/conversas.html?chat=${encodeURIComponent(p.professor.id)}">
                        <i class="bi bi-chat-dots"></i> Conversa
                    </a>
                </div>
            </li>`
            )
            .join('');

        if (pedidoDestacado) {
            const alvo = document.getElementById(`pedido-${pedidoDestacado}`);
            if (alvo) alvo.scrollIntoView({ block: 'center' });
            pedidoDestacado = null;
        }
    }

    function desenharTabela() {
        if (quadro.professores.length === 0) {
            mostrarEstado(
                'bi-people',
                'Nenhum professor nesta escola',
                'Quando houver professores cadastrados na escola, eles aparecem aqui.'
            );
            return;
        }
        const linhas = linhasFiltradas();
        if (linhas.length === 0) {
            mostrarEstado('bi-funnel', 'Nada encontrado', 'Nenhuma linha corresponde aos filtros.');
            return;
        }
        corpo.innerHTML = linhas
            .map(({ professor, ferramenta, estado }) => {
                const s = TEXTO_STATUS[estado.status];
                const autorizado = estado.status === 'autorizado';
                const detalhes = [professor.turmas.join(', '), professor.disciplinas.join(', ')]
                    .filter(Boolean)
                    .join(' · ');
                const quem = estado.alteradoPor?.nome ? `por ${esc(estado.alteradoPor.nome)}` : '';
                const acao =
                    estado.status === 'pendente' && !estado.alterada
                        ? `<a class="btn-action af-acao" href="#pedido-${esc(estado.solicitacao?.id || '')}"><i class="bi bi-search"></i> Analisar</a>`
                        : `<button type="button" class="btn-action af-acao ${autorizado ? 'af-acao-revogar' : 'af-acao-autorizar'}"
                               data-marcar="${autorizado ? 'revogar' : 'autorizar'}"
                               data-professor="${esc(professor.id)}" data-ferramenta="${esc(ferramenta.id)}">
                               <i class="bi ${autorizado ? 'bi-lock' : 'bi-unlock'}"></i> ${autorizado ? 'Revogar' : 'Autorizar'}
                           </button>`;
                return `
                <tr class="${estado.alterada ? 'af-alterada' : ''}">
                    <td><span class="af-prof-nome">${esc(professor.nome)}</span></td>
                    <td><span class="af-sub">${esc(detalhes || '—')}</span></td>
                    <td><span class="af-cat">${esc(ferramenta.categoria)}</span>${esc(ferramenta.nome)}</td>
                    <td>
                        <span class="af-status af-status-${estado.status}"><i class="bi ${s.icone}"></i> ${s.rotulo}</span>
                        ${estado.alterada ? '<span class="af-nao-salvo">Alteração não salva</span>' : ''}
                    </td>
                    <td>${esc(formatarData(estado.atualizadoEm))}<span class="af-sub">${quem}</span></td>
                    <td style="text-align: right;">${acao}</td>
                </tr>`;
            })
            .join('');
    }

    function atualizarBotaoSalvar() {
        const n = alteracoes.size;
        btnSalvar.disabled = n === 0;
        contador.hidden = n === 0;
        contador.textContent = String(n);
    }

    // ── Marcar / salvar ──────────────────────────────────────────────────────
    function marcar(professorId, ferramentaId, autorizar) {
        const professor = quadro.professores.find((p) => p.id === professorId);
        if (!professor) return;
        const original = (professor.ferramentas[ferramentaId] || {}).status === 'autorizado';
        const k = chave(professorId, ferramentaId);
        // Voltar ao valor do banco desfaz a marcação.
        if (autorizar === original) alteracoes.delete(k);
        else alteracoes.set(k, autorizar);
        desenharTabela();
        atualizarBotaoSalvar();
    }

    async function salvar() {
        if (alteracoes.size === 0) return;
        const lote = [...alteracoes.entries()].map(([k, autorizado]) => {
            const [professorId, ferramentaId] = k.split('|');
            return { professorId, ferramentaId, autorizado };
        });
        btnSalvar.disabled = true;
        try {
            await api('/ferramentas/autorizacoes', { method: 'PUT', body: { alteracoes: lote } });
            alteracoes.clear();
            avisar('Autorizações salvas com sucesso.', 'success');
            await carregar();
        } catch (e) {
            avisar(`Não foi possível salvar as autorizações. ${e.message}`, 'error');
            atualizarBotaoSalvar();
        }
    }

    // ── Pedidos ──────────────────────────────────────────────────────────────
    const modal = $('modalRecusa');
    let recusando = null;

    function abrirRecusa(pedido) {
        recusando = pedido;
        $('textoRecusa').textContent = `${pedido.professor.nome} pediu "${pedido.ferramenta.nome}". O professor será avisado da recusa.`;
        $('motivoRecusa').value = '';
        modal.classList.add('open');
        $('motivoRecusa').focus();
    }

    function fecharRecusa() {
        modal.classList.remove('open');
        recusando = null;
    }

    async function decidir(id, decisao, motivo) {
        try {
            const json = await api(`/ferramentas/solicitacoes/${encodeURIComponent(id)}/decidir`, {
                method: 'POST',
                body: { decisao, motivo },
            });
            avisar(json.message || 'Decisão registrada.', 'success');
            await carregar();
        } catch (e) {
            avisar(e.message, 'error');
            if (e.status === 409 || e.status === 404) await carregar();
        }
    }

    // ── Eventos ──────────────────────────────────────────────────────────────
    corpo.addEventListener('click', (ev) => {
        const botao = ev.target.closest('button[data-marcar]');
        if (!botao) return;
        marcar(botao.dataset.professor, botao.dataset.ferramenta, botao.dataset.marcar === 'autorizar');
    });

    $('listaPedidos').addEventListener('click', (ev) => {
        const botao = ev.target.closest('button[data-decidir]');
        if (!botao) return;
        const pedido = pedidos.find((p) => p.id === botao.dataset.id);
        if (!pedido) return;
        if (botao.dataset.decidir === 'autorizar') {
            botao.disabled = true;
            decidir(pedido.id, 'autorizar');
        } else {
            abrirRecusa(pedido);
        }
    });

    $('confirmarRecusa').addEventListener('click', () => {
        if (!recusando) return;
        const id = recusando.id;
        const motivo = $('motivoRecusa').value.trim();
        fecharRecusa();
        decidir(id, 'recusar', motivo);
    });
    $('cancelarRecusa').addEventListener('click', fecharRecusa);
    $('fecharRecusa').addEventListener('click', fecharRecusa);
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal) fecharRecusa();
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && modal.classList.contains('open')) fecharRecusa();
    });

    btnSalvar.addEventListener('click', salvar);
    for (const el of Object.values(filtros)) {
        el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', desenharTabela);
    }

    // Sair com alteração não salva pede confirmação.
    window.addEventListener('beforeunload', (ev) => {
        if (alteracoes.size === 0) return;
        ev.preventDefault();
        ev.returnValue = '';
    });

    // Pedido novo chega em tempo real (Issue #733). O socket nasce depois do
    // realtime.js, que é carregado com defer.
    let tentativas = 0;
    const esperarSocket = setInterval(() => {
        tentativas++;
        if (window.socket && typeof window.socket.on === 'function') {
            clearInterval(esperarSocket);
            window.socket.on('ferramentas:solicitacao', () => {
                // Não atropela o que a direção está marcando: só recarrega os pedidos.
                api('/ferramentas/solicitacoes?status=pendente')
                    .then((json) => {
                        pedidos = json.data || [];
                        desenharResumo();
                        desenharPedidos();
                    })
                    .catch(() => {});
            });
        } else if (tentativas > 20) {
            clearInterval(esperarSocket);
        }
    }, 500);

    carregarEscola();
    carregar();
});
