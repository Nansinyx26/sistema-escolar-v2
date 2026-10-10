/**
 * js/planos-ia.js — tela de Plano de aula e Plano de estudo com IA (Issue #761).
 *
 * Chama `POST /api/ia/plano-aula` e `POST /api/ia/plano-estudo`. A regra de
 * quem pode é toda do servidor (IA ligada na escola, autorização da direção
 * por professor, aluno da turma de quem pede); esta tela só reflete:
 *
 *   - ferramenta trancada → o formulário dá lugar ao cadeado e ao pedido
 *     (js/ferramentas-professor.js), e volta sozinho quando a direção libera;
 *   - o HTML que o modelo devolve passa pelo DOMPurify com uma lista fechada
 *     de tags e NENHUM atributo antes de ir para a tela.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PlanosIA = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    'use strict';

    // O que o prompt pede (h3, h4, p, ul, li, strong) e um pouco de folga.
    // Nenhum atributo: sem href, sem style, sem on*.
    const TAGS_PERMITIDAS = ['h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'br'];

    const ROTA = { aula: '/ia/plano-aula', estudo: '/ia/plano-estudo' };
    const FERRAMENTA = { aula: 'ia.plano-aula', estudo: 'ia.plano-estudo' };
    const TITULO = { aula: 'Plano de aula', estudo: 'Plano de estudo' };

    /**
     * HTML do modelo → HTML seguro. Sem DOMPurify na página, vira texto puro:
     * melhor um plano sem formatação do que um plano com script.
     */
    function sanitizarPlano(html, purify) {
        const texto = typeof html === 'string' ? html : '';
        const dp = purify || (typeof window !== 'undefined' ? window.DOMPurify : null);
        if (dp && typeof dp.sanitize === 'function') {
            return dp.sanitize(texto, {
                ALLOWED_TAGS: TAGS_PERMITIDAS,
                ALLOWED_ATTR: [],
            });
        }
        const div = document.createElement('div');
        div.textContent = texto.replace(/<[^>]*>/g, ' ');
        return div.innerHTML;
    }

    function lerCookie(nome) {
        const partes = `; ${document.cookie}`.split(`; ${nome}=`);
        return partes.length === 2 ? partes.pop().split(';').shift() : '';
    }

    function baseApi() {
        return window.API_BASE_URL || '/api';
    }

    async function postar(rota, corpo) {
        const res = await fetch(baseApi() + rota, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': lerCookie('csrf_token'),
            },
            body: JSON.stringify(corpo),
        });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, json };
    }

    function iniciar() {
        const abas = [...document.querySelectorAll('.pi-aba')];
        const paineis = {
            aula: document.getElementById('painelAula'),
            estudo: document.getElementById('painelEstudo'),
        };
        const resultado = document.getElementById('resultado');
        const plano = document.getElementById('plano');
        const avisoOffline = document.getElementById('avisoOffline');
        const tituloResultado = document.getElementById('resultadoTitulo');
        const ferramentas = window.FerramentasProfessor;
        let abaAtual = 'aula';
        let resultadoDe = null;

        // ── Abas ──────────────────────────────────────────────────────────
        function abrirAba(qual, foco) {
            abaAtual = qual;
            for (const aba of abas) {
                const ativa = aba.dataset.aba === qual;
                aba.setAttribute('aria-selected', String(ativa));
                aba.tabIndex = ativa ? 0 : -1;
                if (ativa && foco) aba.focus();
            }
            for (const [nome, painel] of Object.entries(paineis)) painel.hidden = nome !== qual;
            // O resultado é da aba que o gerou: na outra aba ele some.
            resultado.hidden = resultadoDe !== qual;
        }
        for (const aba of abas) {
            aba.addEventListener('click', () => abrirAba(aba.dataset.aba));
            aba.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                abrirAba(abaAtual === 'aula' ? 'estudo' : 'aula', true);
            });
        }

        // ── Cadeado por aba ───────────────────────────────────────────────
        function refletir(qual) {
            const painel = paineis[qual];
            const alvo = painel.querySelector('.pi-bloqueio-alvo');
            const trancada = ferramentas?.trancada(FERRAMENTA[qual]);
            if (trancada) {
                painel.dataset.trancado = '';
                alvo.innerHTML = '';
                alvo.appendChild(ferramentas.criarBloqueio({ id: FERRAMENTA[qual] }));
            } else if ('trancado' in painel.dataset) {
                delete painel.dataset.trancado;
                alvo.innerHTML = '';
            }
        }
        if (ferramentas) {
            document.addEventListener('ferramentas:mudou', (e) => {
                for (const qual of Object.keys(FERRAMENTA)) {
                    if (e.detail?.ferramentaId === FERRAMENTA[qual]) refletir(qual);
                }
            });
            ferramentas.iniciar().then(() => {
                refletir('aula');
                refletir('estudo');
            });
        }

        // ── Geração ───────────────────────────────────────────────────────
        function mostrarSkeleton(qual) {
            resultadoDe = qual;
            tituloResultado.textContent = `Gerando ${TITULO[qual].toLowerCase()}…`;
            avisoOffline.hidden = true;
            plano.setAttribute('aria-busy', 'true');
            plano.innerHTML = [
                '<span class="pi-skel pi-skel-titulo" data-skeleton></span>',
                ...Array(4).fill('<span class="pi-skel" data-skeleton></span>'),
                '<span class="pi-skel pi-skel-titulo" data-skeleton></span>',
                ...Array(3).fill('<span class="pi-skel" data-skeleton></span>'),
            ].join('');
            resultado.hidden = false;
        }

        function mostrarPlano(qual, dados) {
            tituloResultado.textContent = TITULO[qual];
            plano.innerHTML = sanitizarPlano(dados.planoHtml);
            plano.removeAttribute('aria-busy');
            avisoOffline.hidden = !dados.modoOffline;
            resultado.scrollIntoView({ block: 'start' });
        }

        function falhar(qual, form, mensagem) {
            form.querySelector('.pi-erro').textContent = mensagem;
            if (resultadoDe === qual) {
                resultado.hidden = true;
                resultadoDe = null;
            }
        }

        async function gerar(qual, form, corpo) {
            const botao = form.querySelector('.pi-gerar');
            form.querySelector('.pi-erro').textContent = '';
            botao.disabled = true;
            mostrarSkeleton(qual);
            try {
                const { status, json } = await postar(ROTA[qual], corpo);
                if (json.codigo === 'FERRAMENTA_NAO_AUTORIZADA') {
                    falhar(qual, form, '');
                    // O servidor é quem sabe: ajusta o status e a aba tranca.
                    ferramentas?.definirStatus(
                        FERRAMENTA[qual],
                        json.solicitacaoPendente ? 'pendente' : 'bloqueado'
                    );
                    if (!ferramentas) falhar(qual, form, json.error);
                    return;
                }
                if (status >= 400 || !json.success) {
                    falhar(qual, form, json.error || 'Não foi possível gerar o plano agora.');
                    return;
                }
                mostrarPlano(qual, json.data || {});
            } catch {
                falhar(qual, form, 'Sem conexão. Tente de novo em instantes.');
            } finally {
                botao.disabled = false;
            }
        }

        const formAula = document.getElementById('formAula');
        formAula.addEventListener('submit', (e) => {
            e.preventDefault();
            const dados = Object.fromEntries(new FormData(formAula));
            const campos = {
                materia: dados.materia?.trim(),
                ano: dados.ano?.trim(),
                tema: dados.tema?.trim(),
            };
            if (!campos.materia || !campos.ano || !campos.tema) {
                formAula.querySelector('.pi-erro').textContent =
                    'Preencha disciplina, ano/turma e tema.';
                return;
            }
            gerar('aula', formAula, { ...campos, objetivos: dados.objetivos?.trim() || undefined });
        });

        // ── Busca de aluno (plano de estudo) ──────────────────────────────
        const formEstudo = document.getElementById('formEstudo');
        const busca = document.getElementById('buscaAluno');
        const lista = document.getElementById('listaAlunos');
        const escolhido = document.getElementById('alunoEscolhido');
        let aluno = null;
        let temporizador = null;
        let consulta = 0;

        function fecharLista() {
            lista.hidden = true;
            busca.setAttribute('aria-expanded', 'false');
        }

        function escolher(item) {
            aluno = { id: item.id, nome: item.nome };
            busca.value = item.nome;
            escolhido.textContent = `Aluno escolhido: ${item.nome}${item.turma ? ` · Turma ${item.turma}` : ''}`;
            escolhido.hidden = false;
            fecharLista();
        }

        async function buscarAlunos(termo) {
            const minha = ++consulta;
            try {
                const res = await fetch(
                    `${baseApi()}/alunos?q=${encodeURIComponent(termo)}&limit=8`,
                    { credentials: 'include' }
                );
                const json = await res.json();
                if (minha !== consulta) return; // chegou uma busca mais nova
                lista.innerHTML = '';
                const alunos = json.success && Array.isArray(json.data) ? json.data : [];
                if (!alunos.length) {
                    const li = document.createElement('li');
                    li.className = 'pi-vazio';
                    li.textContent = 'Nenhum aluno das suas turmas com esse nome.';
                    lista.appendChild(li);
                }
                for (const a of alunos) {
                    const li = document.createElement('li');
                    li.setAttribute('role', 'option');
                    li.textContent = a.nome;
                    if (a.turma) {
                        const turma = document.createElement('small');
                        turma.textContent = `Turma ${a.turma}`;
                        li.appendChild(turma);
                    }
                    li.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        escolher({ id: a.id || a._id, nome: a.nome, turma: a.turma });
                    });
                    lista.appendChild(li);
                }
                lista.hidden = false;
                busca.setAttribute('aria-expanded', 'true');
            } catch {
                fecharLista();
            }
        }

        busca.addEventListener('input', () => {
            aluno = null;
            escolhido.hidden = true;
            clearTimeout(temporizador);
            const termo = busca.value.trim();
            if (termo.length < 2) return fecharLista();
            temporizador = setTimeout(() => buscarAlunos(termo), 250);
        });
        busca.addEventListener('keydown', (e) => {
            const opcoes = [...lista.querySelectorAll('[role="option"]')];
            if (lista.hidden || !opcoes.length) return;
            const atual = opcoes.findIndex((o) => o.getAttribute('aria-selected') === 'true');
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const prox =
                    e.key === 'ArrowDown'
                        ? Math.min(atual + 1, opcoes.length - 1)
                        : Math.max(atual - 1, 0);
                for (const [i, o] of opcoes.entries())
                    o.setAttribute('aria-selected', String(i === prox));
            } else if (e.key === 'Enter' && atual >= 0) {
                e.preventDefault();
                opcoes[atual].dispatchEvent(new MouseEvent('mousedown'));
            } else if (e.key === 'Escape') {
                fecharLista();
            }
        });
        busca.addEventListener('blur', () => setTimeout(fecharLista, 120));

        formEstudo.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!aluno) {
                formEstudo.querySelector('.pi-erro').textContent = 'Escolha um aluno da lista.';
                busca.focus();
                return;
            }
            const objetivos = new FormData(formEstudo).get('objetivos')?.trim();
            gerar('estudo', formEstudo, { alunoId: aluno.id, objetivos: objetivos || undefined });
        });

        // ── Copiar e imprimir ─────────────────────────────────────────────
        document.getElementById('btnCopiar').addEventListener('click', async (e) => {
            const botao = e.currentTarget;
            try {
                await navigator.clipboard.writeText(plano.innerText);
                botao.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i> Copiado';
                setTimeout(() => {
                    botao.innerHTML = '<i class="bi bi-clipboard" aria-hidden="true"></i> Copiar';
                }, 1800);
            } catch {
                botao.textContent = 'Não foi possível copiar';
            }
        });
        document.getElementById('btnImprimir').addEventListener('click', () => window.print());
    }

    if (typeof document !== 'undefined' && typeof module === 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', iniciar);
        } else {
            iniciar();
        }
    }

    return { sanitizarPlano, iniciar, TAGS_PERMITIDAS };
});
