/**
 * js/moderacao/denuncias.js — as denúncias recebidas pelo canal aberto
 * (Issue #726). Tela: html/denuncias.html.
 *
 * O RELATO SÓ VEM QUANDO ALGUÉM PEDE
 * ==================================
 * A listagem (`GET /api/moderacao/denuncias`) traz categoria, data e situação —
 * nunca o relato. Ele chega só ao clicar em "Abrir relato", e esse pedido grava
 * `DENUNCIA_VISUALIZAR` no AuditLog. Buscar todos os relatos de uma vez para
 * "deixar a tela mais rápida" registraria como lido o que ninguém leu.
 *
 * SEM `innerHTML` COM DADO DO SERVIDOR
 * ====================================
 * O relato e as anotações são texto livre, escrito por quem denunciou e pela
 * equipe. Tudo entra por `textContent`; montar isso como marcação seria XSS
 * numa tela de gestão.
 *
 * A tela não decide permissão — quem decide é a API (`authorize.estrito` +
 * `filtrarPorEscola`). Motion: só `.skeleton` e `Motion.reveal` (`data-reveal`) de
 * css/motion.css; salvar não anima (ação de alta frequência, docs/MOTION.md).
 */

(() => {
    'use strict';

    const API = `${window.API_BASE_URL || '/api'}/moderacao/denuncias`;
    const LIMITE = 100;
    const ANOTACAO_MINIMA = 10;

    // Mesmos rótulos do formulário de quem denuncia (js/canal-denuncia.js).
    const CATEGORIAS = [
        ['bullying', 'Bullying'],
        ['ciberbullying', 'Cyberbullying (pela internet)'],
        ['assedio', 'Assédio'],
        ['discriminacao', 'Discriminação ou preconceito'],
        ['violencia', 'Violência ou ameaça'],
        ['automutilacao', 'Automutilação ou risco à vida'],
        ['outro', 'Outro'],
    ];
    const CATEGORIA_ROTULO = Object.fromEntries(CATEGORIAS);

    const SITUACAO_ROTULO = { nova: 'Nova', em_apuracao: 'Em apuração', concluida: 'Concluída' };

    const PERFIL_ROTULO = {
        responsavel: 'Responsável',
        professor: 'Professor(a)',
        secretaria: 'Secretaria',
        diretor: 'Direção',
        coordenacao: 'Coordenação',
        admin: 'Administração',
    };

    const CONSELHO_ROTULO = {
        pendente: 'Comunicação pendente',
        comunicado: 'Comunicado',
        dispensado: 'Dispensada pela direção',
    };

    const el = {
        abas: document.getElementById('den-abas'),
        categoria: document.getElementById('den-categoria'),
        lista: document.getElementById('den-lista'),
        vazio: document.getElementById('den-vazio'),
        limite: document.getElementById('den-limite'),
        erro: document.getElementById('den-erro'),
    };

    const estado = { situacao: '', categoria: '', resumo: null, pedido: 0 };

    /** `admin` precisa dizer de qual escola está falando (authorize.estrito). */
    function consulta(params = {}) {
        const q = new URLSearchParams();
        const escolaId = new URLSearchParams(location.search).get('escolaId');
        if (escolaId) q.set('escolaId', escolaId);
        for (const [chave, valor] of Object.entries(params)) {
            if (valor) q.set(chave, String(valor));
        }
        const texto = q.toString();
        return texto ? `?${texto}` : '';
    }

    async function pedir(caminho, opcoes = {}) {
        const resposta = await fetch(`${API}${caminho}`, {
            credentials: 'include',
            ...opcoes,
            headers: {
                ...(window.csrfHeaders
                    ? window.csrfHeaders(true)
                    : { 'Content-Type': 'application/json' }),
                ...(opcoes.headers || {}),
            },
        });

        const corpo = await resposta.json().catch(() => ({}));
        if (!resposta.ok) {
            const erro = new Error(corpo.error || 'Falha na requisição.');
            erro.codigo = corpo.codigo;
            erro.status = resposta.status;
            throw erro;
        }
        return corpo;
    }

    /** `createElement` com classe e texto — nunca `innerHTML`. */
    function no(tag, classe, texto) {
        const elemento = document.createElement(tag);
        if (classe) elemento.className = classe;
        if (texto !== undefined && texto !== null) elemento.textContent = String(texto);
        return elemento;
    }

    function formatarData(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function seloSituacao(situacao) {
        const selo = no(
            'span',
            `den-selo den-selo--${situacao}`,
            SITUACAO_ROTULO[situacao] || situacao
        );
        selo.dataset.papel = 'situacao';
        return selo;
    }

    function linhaDados(dl, rotulo, valor, papel) {
        const dt = no('dt', '', rotulo);
        const dd = no('dd', '', valor);
        if (papel) dd.dataset.papel = papel;
        dl.append(dt, dd);
    }

    function mostrarErro(mensagem) {
        el.erro.textContent = mensagem;
        el.erro.hidden = false;
    }

    function limparErro() {
        el.erro.hidden = true;
    }

    // ── Lista ───────────────────────────────────────────────────────────────

    function montarCartao(denuncia, indice) {
        const cartao = no('article', 'den-card');
        cartao.style.setProperty('--motion-i', String(indice));
        // `data-reveal`, e não a classe `motion-reveal` direto: a classe esconde
        // o cartão, e só quem passa por `Motion.reveal` ganha o `is-visible`.
        // Com a classe posta à mão, a lista carregava e ficava invisível.
        cartao.setAttribute('data-reveal', '');

        const topo = no('header', 'den-card__topo');
        const gravidade = denuncia.severidade === 'grave' ? 'grave' : 'moderada';
        topo.appendChild(
            no(
                'span',
                `den-selo den-selo--${gravidade}`,
                CATEGORIA_ROTULO[denuncia.categoria] || denuncia.categoria
            )
        );
        topo.appendChild(seloSituacao(denuncia.situacao));
        if (denuncia.sigilosa)
            topo.appendChild(no('span', 'den-selo den-selo--sigilosa', 'Sigilosa'));

        const quando = no('time', 'den-card__data', formatarData(denuncia.criadoEm));
        quando.dateTime = denuncia.criadoEm || '';
        topo.appendChild(quando);
        cartao.appendChild(topo);

        const dl = no('dl', 'den-dados');
        linhaDados(dl, 'Protocolo', denuncia.protocolo);
        linhaDados(
            dl,
            'Enviada por',
            PERFIL_ROTULO[denuncia.remetentePerfil] || denuncia.remetentePerfil || '—'
        );
        if (denuncia.conselhoTutelar) {
            linhaDados(
                dl,
                'Conselho Tutelar',
                CONSELHO_ROTULO[denuncia.conselhoTutelar.situacao] ||
                    denuncia.conselhoTutelar.situacao
            );
        }
        linhaDados(
            dl,
            'Última atualização',
            denuncia.atualizadoEm ? formatarData(denuncia.atualizadoEm) : 'Ainda sem andamento',
            'atualizado'
        );
        cartao.appendChild(dl);

        const idDetalhe = `den-detalhe-${denuncia.id}`;
        const botao = no('button', 'den-btn');
        botao.type = 'button';
        botao.setAttribute('aria-expanded', 'false');
        botao.setAttribute('aria-controls', idDetalhe);
        const icone = no('i', 'bi bi-file-earmark-text');
        icone.setAttribute('aria-hidden', 'true');
        botao.append(icone, no('span', '', 'Abrir relato'));

        const painel = no('div', 'den-detalhe');
        painel.id = idDetalhe;
        painel.hidden = true;

        botao.addEventListener('click', () => alternarDetalhe(denuncia, cartao, botao, painel));
        cartao.append(botao, painel);
        return cartao;
    }

    function renderarResumo() {
        const resumo = estado.resumo || {};
        el.abas.querySelectorAll('[data-total]').forEach((alvo) => {
            const chave = alvo.dataset.total || 'total';
            alvo.textContent = String(resumo[chave] ?? 0);
        });
    }

    /** Skeleton enquanto carrega — obrigatório por docs/MOTION.md. */
    function mostrarEsqueleto(alvo, preset, count) {
        if (window.Motion && typeof window.Motion.skeleton === 'function') {
            window.Motion.skeleton(alvo, { preset, count });
            return;
        }
        alvo.replaceChildren();
    }

    /**
     * Sai do estado de carregamento. `Motion.ready` recebe HTML em string, e
     * aqui o conteúdo é montado como nó — então os atributos saem à mão.
     */
    function encerrarEsqueleto(alvo) {
        alvo.replaceChildren();
        alvo.setAttribute('data-loading', 'false');
        alvo.setAttribute('aria-busy', 'false');
    }

    async function carregar() {
        const pedido = ++estado.pedido;
        limparErro();
        el.vazio.hidden = true;
        el.limite.hidden = true;
        mostrarEsqueleto(el.lista, 'card', 3);

        try {
            const resposta = await pedir(
                consulta({ situacao: estado.situacao, categoria: estado.categoria, limite: LIMITE })
            );
            // Troca rápida de filtro: só a resposta do último pedido desenha.
            if (pedido !== estado.pedido) return;

            estado.resumo = resposta.resumo || null;
            renderarResumo();

            encerrarEsqueleto(el.lista);
            const denuncias = resposta.data || [];
            el.vazio.hidden = denuncias.length > 0;
            denuncias.forEach((denuncia, i) => {
                el.lista.appendChild(montarCartao(denuncia, i));
            });

            if (denuncias.length >= LIMITE) {
                el.limite.textContent = `Mostrando as ${LIMITE} mais recentes. Use os filtros para ver as demais.`;
                el.limite.hidden = false;
            }

            if (window.Motion && typeof window.Motion.reveal === 'function') {
                window.Motion.reveal(el.lista);
            }
        } catch (erro) {
            if (pedido !== estado.pedido) return;
            encerrarEsqueleto(el.lista);
            if (erro.codigo === 'ESCOLA_NAO_INFORMADA') {
                mostrarErro('Informe a escola na URL (?escolaId=…) para ver as denúncias dela.');
                return;
            }
            mostrarErro(erro.message || 'Não foi possível carregar as denúncias.');
        }
    }

    // ── Detalhe ─────────────────────────────────────────────────────────────

    async function alternarDetalhe(denuncia, cartao, botao, painel) {
        const abrir = painel.hidden;
        painel.hidden = !abrir;
        botao.setAttribute('aria-expanded', String(abrir));
        botao.querySelector('span').textContent = abrir ? 'Fechar relato' : 'Abrir relato';
        if (!abrir || painel.dataset.carregado === 'true') return;

        mostrarEsqueleto(painel, 'text', 1);
        try {
            const resposta = await pedir(`/${encodeURIComponent(denuncia.id)}${consulta()}`);
            painel.dataset.carregado = 'true';
            encerrarEsqueleto(painel);
            renderarDetalhe(resposta.data, cartao, painel);
        } catch (erro) {
            encerrarEsqueleto(painel);
            painel.appendChild(
                no('p', 'den-erro', erro.message || 'Não foi possível abrir a denúncia.')
            );
        }
    }

    function preencherHistorico(alvo, andamentos) {
        alvo.replaceChildren();
        if (!andamentos.length) {
            alvo.appendChild(no('p', 'den-form__ajuda', 'Nenhum andamento registrado ainda.'));
            return;
        }
        const lista = no('ol', 'den-historico');
        for (const andamento of andamentos) {
            const item = no('li');
            item.appendChild(
                no('strong', '', SITUACAO_ROTULO[andamento.situacao] || andamento.situacao)
            );
            const quem = [
                andamento.porNome,
                PERFIL_ROTULO[andamento.porPerfil] || andamento.porPerfil,
            ]
                .filter(Boolean)
                .join(', ');
            item.appendChild(
                no(
                    'span',
                    'den-historico__meta',
                    ` · ${quem || '—'} · ${formatarData(andamento.em)}`
                )
            );
            if (andamento.anotacao) {
                item.appendChild(no('p', 'den-historico__nota', andamento.anotacao));
            }
            lista.appendChild(item);
        }
        alvo.appendChild(lista);
    }

    function renderarDetalhe(detalhe, cartao, painel) {
        if (detalhe.sigilosa) {
            painel.appendChild(
                no(
                    'p',
                    'den-sigilo',
                    'Caso sigiloso (Lei 13.819/2019): trate só com a equipe que apura e não comente fora dela.'
                )
            );
        }

        painel.appendChild(no('h3', '', 'Relato'));
        painel.appendChild(no('p', 'den-relato', detalhe.relato || '—'));

        painel.appendChild(no('h3', '', 'Quem denunciou'));
        const perfil = PERFIL_ROTULO[detalhe.autor?.perfil] || detalhe.autor?.perfil;
        painel.appendChild(
            no(
                'p',
                '',
                [detalhe.autor?.nome || 'Nome não encontrado', perfil].filter(Boolean).join(' · ')
            )
        );

        painel.appendChild(no('h3', '', 'Andamento'));
        const historico = no('div');
        preencherHistorico(historico, detalhe.andamentos || []);
        painel.appendChild(historico);

        painel.appendChild(montarFormulario(detalhe, cartao, historico));
    }

    function montarFormulario(detalhe, cartao, historico) {
        const formulario = no('form', 'den-form');
        const grupo = no('fieldset');
        grupo.appendChild(no('legend', '', 'Registrar andamento'));

        const nome = `den-situacao-${detalhe.id}`;
        const inicial = detalhe.situacao === 'nova' ? 'em_apuracao' : detalhe.situacao;
        for (const valor of ['em_apuracao', 'concluida']) {
            const rotulo = no('label');
            const radio = no('input');
            radio.type = 'radio';
            radio.name = nome;
            radio.value = valor;
            radio.checked = valor === inicial;
            rotulo.append(radio, no('span', '', SITUACAO_ROTULO[valor]));
            grupo.appendChild(rotulo);
        }
        formulario.appendChild(grupo);

        const idCampo = `den-anotacao-${detalhe.id}`;
        const rotuloCampo = no('label', '', 'Anotação');
        rotuloCampo.htmlFor = idCampo;
        const campo = no('textarea');
        campo.id = idCampo;
        campo.maxLength = 1000;
        campo.rows = 4;
        const idAjuda = `${idCampo}-ajuda`;
        campo.setAttribute('aria-describedby', idAjuda);

        const ajuda = no(
            'p',
            'den-form__ajuda',
            `Para concluir ou reabrir, escreva o que a escola apurou e fez (mínimo ${ANOTACAO_MINIMA} caracteres). Só esta equipe vê a anotação.`
        );
        ajuda.id = idAjuda;

        const aviso = no('p', 'den-form__aviso');
        aviso.setAttribute('role', 'status');
        aviso.setAttribute('aria-live', 'polite');

        const salvar = no('button', 'den-btn den-btn--primario', 'Salvar andamento');
        salvar.type = 'submit';
        const acoes = no('div', 'den-form__acoes');
        acoes.appendChild(salvar);

        formulario.append(rotuloCampo, campo, ajuda, aviso, acoes);

        formulario.addEventListener('submit', async (evento) => {
            evento.preventDefault();
            const escolhida = formulario.querySelector(`input[name="${nome}"]:checked`)?.value;
            const anotacao = campo.value.trim();

            // A API também exige — conferir aqui só poupa o clique perdido.
            const mexeNaConclusao = escolhida === 'concluida' || detalhe.situacao === 'concluida';
            if (mexeNaConclusao && anotacao.length < ANOTACAO_MINIMA) {
                aviso.textContent = `Escreva o que a escola apurou e fez (mínimo ${ANOTACAO_MINIMA} caracteres).`;
                campo.focus();
                return;
            }

            salvar.disabled = true;
            aviso.textContent = 'Salvando...';
            try {
                const resposta = await pedir(
                    `/${encodeURIComponent(detalhe.id)}/andamento${consulta()}`,
                    {
                        method: 'POST',
                        body: JSON.stringify({ situacao: escolhida, anotacao }),
                    }
                );
                const anterior = detalhe.situacao;
                Object.assign(detalhe, resposta.data);
                preencherHistorico(historico, detalhe.andamentos || []);
                atualizarCartao(cartao, anterior, detalhe);
                campo.value = '';
                aviso.textContent = 'Andamento salvo.';
            } catch (erro) {
                aviso.textContent = erro.message || 'Não foi possível salvar o andamento.';
            } finally {
                salvar.disabled = false;
            }
        });

        return formulario;
    }

    /** Reflete o andamento no cartão e nos números das abas, sem recarregar a lista. */
    function atualizarCartao(cartao, anterior, detalhe) {
        cartao
            .querySelector('[data-papel="situacao"]')
            ?.replaceWith(seloSituacao(detalhe.situacao));
        const atualizado = cartao.querySelector('[data-papel="atualizado"]');
        if (atualizado) atualizado.textContent = formatarData(detalhe.atualizadoEm);

        if (estado.resumo && anterior !== detalhe.situacao) {
            estado.resumo[anterior] = Math.max(0, (estado.resumo[anterior] || 0) - 1);
            estado.resumo[detalhe.situacao] = (estado.resumo[detalhe.situacao] || 0) + 1;
            renderarResumo();
        }
    }

    // ── Filtros ─────────────────────────────────────────────────────────────

    function iniciar() {
        for (const [valor, rotulo] of CATEGORIAS) {
            const opcao = no('option', '', rotulo);
            opcao.value = valor;
            el.categoria.appendChild(opcao);
        }

        el.abas.querySelectorAll('[data-situacao]').forEach((aba) => {
            aba.addEventListener('click', () => {
                el.abas.querySelectorAll('[data-situacao]').forEach((outra) => {
                    outra.setAttribute('aria-pressed', String(outra === aba));
                });
                estado.situacao = aba.dataset.situacao;
                carregar();
            });
        });

        el.categoria.addEventListener('change', () => {
            estado.categoria = el.categoria.value;
            carregar();
        });

        carregar();
    }

    document.addEventListener('DOMContentLoaded', iniciar);
})();
