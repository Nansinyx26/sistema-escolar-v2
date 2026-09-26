/**
 * Gestão de Escolas — tela do super admin (Issue #463).
 *
 * Consome /api/superadmin/*. A casca desta página abre para qualquer admin
 * (o gate de páginas decide por perfil); quem decide de verdade é a API, que
 * devolve 403 a quem não é super admin — e aí a tela mostra a recusa.
 *
 * Toda mensagem vinda do servidor passa por `escapar` antes de ir ao toast:
 * o `showToast` de utils.js monta o HTML com innerHTML, e nome de escola é
 * texto cadastrado.
 */
document.addEventListener('DOMContentLoaded', async () => {
    const API = window.API_BASE_URL || '/api';
    const LIMITE = 12;
    const CHAVE_CONTEXTO = 'superadminContexto';

    const el = {
        conteudo: document.getElementById('geConteudo'),
        semAcesso: document.getElementById('geSemAcesso'),
        tabela: document.getElementById('geTabela'),
        linhas: document.getElementById('geLinhas'),
        busca: document.getElementById('geBusca'),
        filtros: document.getElementById('geFiltros'),
        opcoesStatus: Array.from(document.querySelectorAll('.ge-status-opcao')),
        paginacao: document.getElementById('gePaginacao'),
        paginaInfo: document.getElementById('gePaginaInfo'),
        anterior: document.getElementById('gePaginaAnterior'),
        proxima: document.getElementById('gePaginaProxima'),
        dialogoBloquear: document.getElementById('geDialogoBloquear'),
        formBloquear: document.getElementById('geFormBloquear'),
        motivo: document.getElementById('geMotivo'),
        motivoContador: document.getElementById('geMotivoContador'),
        motivoErro: document.getElementById('geMotivoErro'),
        confirmarBloqueio: document.getElementById('geConfirmarBloqueio'),
        dialogoDesbloquear: document.getElementById('geDialogoDesbloquear'),
        formDesbloquear: document.getElementById('geFormDesbloquear'),
        motivoAtual: document.getElementById('geMotivoAtual'),
        confirmarDesbloqueio: document.getElementById('geConfirmarDesbloqueio'),
    };

    const estado = { busca: '', status: 'todas', pagina: 1, totalPaginas: 1, escolas: [] };
    let escolaEmAcao = null;
    let requisicaoAtual = 0;

    function escapar(s) {
        return String(s == null ? '' : s).replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
        );
    }

    function avisar(msg, tipo) {
        if (typeof window.showToast === 'function') window.showToast(escapar(msg), tipo, 4000);
    }

    function formatarData(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        return Number.isNaN(d.getTime())
            ? null
            : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }

    async function chamar(caminho, opcoes = {}) {
        const headers = window.csrfHeaders ? window.csrfHeaders(!!opcoes.body) : {};
        const res = await fetch(API + caminho, {
            credentials: 'include',
            ...opcoes,
            headers: { ...headers, ...(opcoes.headers || {}) },
        });
        let json = null;
        try {
            json = await res.json();
        } catch (_e) {
            json = null;
        }
        return {
            status: res.status,
            ok: res.ok && json && json.success !== false,
            json: json || {},
        };
    }

    // ── Renderização ────────────────────────────────────────────────────
    function skeleton() {
        el.tabela.setAttribute('aria-busy', 'true');
        el.linhas.innerHTML = Array.from({ length: 4 })
            .map(
                () => `<div class="ge-linha-skeleton" aria-hidden="true">
                    <div><div class="skeleton skeleton-line" style="width:70%"></div><div class="skeleton skeleton-line" style="width:40%"></div></div>
                    <div class="skeleton skeleton-chip"></div>
                    <div class="skeleton skeleton-line" style="width:3rem"></div>
                    <div class="skeleton skeleton-line" style="width:60%"></div>
                    <div class="skeleton skeleton-btn" style="justify-self:end"></div>
                </div>`
            )
            .join('');
    }

    function linhaDaEscola(e) {
        const bloqueada = e.status === 'bloqueada';
        const local = [e.bairro, e.municipio].filter(Boolean).join(' · ');
        const ultima = bloqueada ? e.bloqueadaEm : e.desbloqueadaEm;
        const quem = bloqueada ? e.bloqueadaPor : e.desbloqueadaPor;
        const dataTexto = formatarData(ultima);
        const data = dataTexto
            ? `${bloqueada ? 'Bloqueada' : 'Desbloqueada'} em ${escapar(dataTexto)}${quem && quem.nome ? `<small>por ${escapar(quem.nome)}</small>` : ''}`
            : 'Nunca bloqueada';

        const acaoStatus = bloqueada
            ? `<button type="button" class="btn btn-success btn-sm ge-acao" data-acao="desbloquear" data-id="${escapar(e._id)}"><i class="bi bi-unlock" aria-hidden="true"></i> Desbloquear</button>`
            : `<button type="button" class="btn btn-danger btn-sm ge-acao" data-acao="bloquear" data-id="${escapar(e._id)}"><i class="bi bi-lock" aria-hidden="true"></i> Bloquear</button>`;

        return `<div class="ge-linha motion-content" role="row" data-status="${bloqueada ? 'bloqueada' : 'ativa'}" data-id="${escapar(e._id)}">
            <div class="ge-c-escola" role="cell">
                <span class="ge-nome">${escapar(e.nome)}</span>
                <span class="ge-local">${escapar(local || e.tipo || '')}${e.disponivel ? '' : ' · ainda não liberada'}</span>
                ${bloqueada && e.motivoBloqueio ? `<p class="ge-motivo-linha"><span class="sr-only">Motivo: </span>${escapar(e.motivoBloqueio)}</p>` : ''}
            </div>
            <div class="ge-c-situacao" role="cell">
                <span class="ge-badge ${bloqueada ? 'ge-badge-bloqueada' : 'ge-badge-ativa'}">
                    <i class="bi ${bloqueada ? 'bi-lock-fill' : 'bi-check-circle-fill'}" aria-hidden="true"></i>${bloqueada ? 'Bloqueada' : 'Ativa'}
                </span>
            </div>
            <div class="ge-c-usuarios ge-num" role="cell"><span class="ge-rotulo-mobile">Usuários: </span>${Number(e.usuarios) || 0}</div>
            <div class="ge-c-data ge-data" role="cell">${data}</div>
            <div class="ge-c-acoes" role="cell">
                <div class="ge-acoes">
                    ${acaoStatus}
                    <button type="button" class="btn btn-secondary btn-sm ge-acao" data-acao="acessar" data-id="${escapar(e._id)}"><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i> Acessar escola</button>
                </div>
            </div>
        </div>`;
    }

    function renderizar(dados) {
        el.tabela.setAttribute('aria-busy', 'false');
        estado.escolas = dados.data || [];

        const resumo = dados.resumo || {};
        document.querySelectorAll('[data-contagem]').forEach((span) => {
            const valor = resumo[span.getAttribute('data-contagem')];
            span.textContent = typeof valor === 'number' ? String(valor) : '–';
        });

        if (!estado.escolas.length) {
            const filtrado = estado.busca || estado.status !== 'todas';
            el.linhas.innerHTML = `<div class="ge-vazio">
                <i class="bi bi-buildings" aria-hidden="true"></i>
                <h2>${filtrado ? 'Nenhuma escola encontrada' : 'Nenhuma escola cadastrada'}</h2>
                <p>${filtrado ? 'Mude a busca ou o filtro de situação para ver outras escolas.' : 'As escolas cadastradas na rede aparecem aqui.'}</p>
            </div>`;
        } else {
            el.linhas.innerHTML = estado.escolas.map(linhaDaEscola).join('');
        }

        const pag = dados.paginacao || { pagina: 1, totalPaginas: 1, total: 0 };
        estado.totalPaginas = pag.totalPaginas || 1;
        el.paginacao.hidden = estado.totalPaginas <= 1;
        el.paginaInfo.textContent = `Página ${pag.pagina} de ${estado.totalPaginas} · ${pag.total} escola(s)`;
        el.anterior.disabled = estado.pagina <= 1;
        el.proxima.disabled = estado.pagina >= estado.totalPaginas;
    }

    async function carregar({ comSkeleton = false } = {}) {
        const numero = ++requisicaoAtual;
        if (comSkeleton) skeleton();
        const params = new URLSearchParams({
            status: estado.status,
            pagina: String(estado.pagina),
            limite: String(LIMITE),
        });
        if (estado.busca) params.set('busca', estado.busca);

        const r = await chamar(`/superadmin/escolas?${params.toString()}`);
        // Resposta de uma busca já digitada por cima: descarta.
        if (numero !== requisicaoAtual) return;

        if (r.status === 401) {
            window.location.href = '/html/login.html';
            return;
        }
        if (r.status === 403) {
            el.conteudo.hidden = true;
            el.semAcesso.hidden = false;
            return;
        }
        if (!r.ok) {
            el.tabela.setAttribute('aria-busy', 'false');
            el.linhas.innerHTML = `<div class="ge-vazio"><i class="bi bi-wifi-off" aria-hidden="true"></i>
                <h2>Não foi possível carregar as escolas</h2>
                <p>${escapar(r.json.error || 'Verifique a conexão e tente de novo.')}</p>
                <button type="button" class="btn btn-secondary btn-sm" data-acao="recarregar">Tentar de novo</button></div>`;
            return;
        }
        // Página que ficou vazia depois de um bloqueio mudar o filtro: volta uma.
        if (!(r.json.data || []).length && estado.pagina > 1) {
            estado.pagina -= 1;
            return carregar();
        }
        renderizar(r.json);
    }

    // ── Filtros e paginação ─────────────────────────────────────────────
    let atrasoBusca = null;
    el.busca.addEventListener('input', () => {
        clearTimeout(atrasoBusca);
        atrasoBusca = setTimeout(() => {
            estado.busca = el.busca.value.trim();
            estado.pagina = 1;
            carregar();
        }, 300);
    });
    el.filtros.addEventListener('submit', (ev) => ev.preventDefault());

    function escolherStatus(botao) {
        el.opcoesStatus.forEach((b) => {
            const ativo = b === botao;
            b.setAttribute('aria-checked', String(ativo));
            b.tabIndex = ativo ? 0 : -1;
        });
        estado.status = botao.dataset.status;
        estado.pagina = 1;
        carregar();
    }
    el.opcoesStatus.forEach((botao, i) => {
        botao.tabIndex = i === 0 ? 0 : -1;
        botao.addEventListener('click', () => escolherStatus(botao));
        // Grupo de rádio: setas movem a escolha (padrão WAI-ARIA).
        botao.addEventListener('keydown', (ev) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
            ev.preventDefault();
            const passo = ev.key === 'ArrowRight' ? 1 : -1;
            const alvo =
                el.opcoesStatus[(i + passo + el.opcoesStatus.length) % el.opcoesStatus.length];
            alvo.focus();
            escolherStatus(alvo);
        });
    });

    el.anterior.addEventListener('click', () => {
        if (estado.pagina > 1) {
            estado.pagina -= 1;
            carregar({ comSkeleton: true });
        }
    });
    el.proxima.addEventListener('click', () => {
        if (estado.pagina < estado.totalPaginas) {
            estado.pagina += 1;
            carregar({ comSkeleton: true });
        }
    });

    // ── Ações por escola ────────────────────────────────────────────────
    function escolaPorId(id) {
        return estado.escolas.find((e) => e._id === id) || null;
    }

    function preencherNome(dialogo, nome) {
        dialogo.querySelectorAll('[data-nome-escola]').forEach((s) => {
            s.textContent = nome;
        });
    }

    function abrirBloqueio(escola) {
        escolaEmAcao = escola;
        preencherNome(el.dialogoBloquear, escola.nome);
        el.motivo.value = '';
        el.motivoContador.textContent = '0/500';
        el.motivoErro.hidden = true;
        el.motivo.removeAttribute('aria-invalid');
        el.dialogoBloquear.showModal();
        el.motivo.focus();
    }

    function abrirDesbloqueio(escola) {
        escolaEmAcao = escola;
        preencherNome(el.dialogoDesbloquear, escola.nome);
        el.motivoAtual.hidden = !escola.motivoBloqueio;
        el.motivoAtual.textContent = escola.motivoBloqueio
            ? `Motivo do bloqueio: ${escola.motivoBloqueio}`
            : '';
        el.dialogoDesbloquear.showModal();
        el.confirmarDesbloqueio.focus();
    }

    async function acessar(escola, botao) {
        botao.disabled = true;
        const r = await chamar(`/superadmin/escolas/${encodeURIComponent(escola._id)}/acessar`, {
            method: 'POST',
        });
        botao.disabled = false;
        if (!r.ok) {
            avisar(r.json.error || 'Não foi possível entrar na escola.', 'error');
            return;
        }
        try {
            sessionStorage.setItem(CHAVE_CONTEXTO, JSON.stringify(r.json.data));
        } catch (_e) {
            /* sem sessionStorage a faixa se confirma pelo servidor */
        }
        window.location.href = r.json.redirect_to || '/html/dashboard.html';
    }

    el.linhas.addEventListener('click', (ev) => {
        const botao = ev.target.closest('[data-acao]');
        if (!botao) return;
        if (botao.dataset.acao === 'recarregar') {
            carregar({ comSkeleton: true });
            return;
        }
        const escola = escolaPorId(botao.dataset.id);
        if (!escola) return;
        if (botao.dataset.acao === 'bloquear') abrirBloqueio(escola);
        else if (botao.dataset.acao === 'desbloquear') abrirDesbloqueio(escola);
        else if (botao.dataset.acao === 'acessar') acessar(escola, botao);
    });

    document.querySelectorAll('.ge-dialogo [data-fechar]').forEach((b) => {
        b.addEventListener('click', () => b.closest('dialog').close());
    });

    el.motivo.addEventListener('input', () => {
        el.motivoContador.textContent = `${el.motivo.value.length}/500`;
        if (!el.motivoErro.hidden && el.motivo.value.trim().length >= 5) {
            el.motivoErro.hidden = true;
            el.motivo.removeAttribute('aria-invalid');
        }
    });

    el.formBloquear.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!escolaEmAcao) return;
        const motivo = el.motivo.value.trim();
        if (motivo.length < 5) {
            el.motivoErro.textContent = 'Escreva o motivo do bloqueio (pelo menos 5 caracteres).';
            el.motivoErro.hidden = false;
            el.motivo.setAttribute('aria-invalid', 'true');
            el.motivo.focus();
            return;
        }
        el.confirmarBloqueio.disabled = true;
        const r = await chamar(
            `/superadmin/escolas/${encodeURIComponent(escolaEmAcao._id)}/bloquear`,
            {
                method: 'PATCH',
                body: JSON.stringify({ motivo }),
            }
        );
        el.confirmarBloqueio.disabled = false;
        if (!r.ok) {
            el.motivoErro.textContent = r.json.error || 'Não foi possível bloquear a escola.';
            el.motivoErro.hidden = false;
            return;
        }
        el.dialogoBloquear.close();
        avisar(`Escola "${escolaEmAcao.nome}" bloqueada. O acesso dela foi encerrado.`, 'success');
        escolaEmAcao = null;
        carregar();
    });

    el.formDesbloquear.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!escolaEmAcao) return;
        el.confirmarDesbloqueio.disabled = true;
        const r = await chamar(
            `/superadmin/escolas/${encodeURIComponent(escolaEmAcao._id)}/desbloquear`,
            { method: 'PATCH' }
        );
        el.confirmarDesbloqueio.disabled = false;
        el.dialogoDesbloquear.close();
        if (!r.ok) {
            avisar(r.json.error || 'Não foi possível desbloquear a escola.', 'error');
            carregar();
            return;
        }
        avisar(`Escola "${escolaEmAcao.nome}" desbloqueada. O acesso já está liberado.`, 'success');
        escolaEmAcao = null;
        carregar();
    });

    if (window.auth && typeof window.auth.init === 'function') {
        try {
            await window.auth.init();
        } catch (_e) {
            /* a própria API decide o acesso logo abaixo */
        }
    }
    carregar({ comSkeleton: true });
});
