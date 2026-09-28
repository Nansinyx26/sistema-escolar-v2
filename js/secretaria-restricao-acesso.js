/**
 * Bloqueio de acesso por decisão judicial — tela da secretaria (Issue #491).
 *
 * O e-mail na ficha do aluno dá acesso aos dados dele. Quando a Justiça
 * restringe o acesso de um genitor ou responsável, a escola marca aqui o
 * e-mail, e o bloqueio vence o cadastro: a pessoa deixa de ver o aluno em
 * qualquer tela e tem as sessões encerradas. Não se registra detalhe do
 * processo — a decisão fica arquivada na secretaria.
 */
document.addEventListener('DOMContentLoaded', () => {
    const API = window.API_BASE_URL || '/api';
    const busca = document.getElementById('restricaoBusca');
    const resultados = document.getElementById('restricaoResultados');
    const painel = document.getElementById('restricaoPainel');
    const titulo = document.getElementById('restricaoAlunoTitulo');
    const lista = document.getElementById('restricaoLista');
    const form = document.getElementById('restricaoForm');
    const campoEmail = document.getElementById('restricaoEmail');
    const confirmacao = document.getElementById('restricaoConfirmacao');
    if (!busca || !form) return;

    let alunoAtual = null;
    let atraso = null;

    function aviso(msg, tipo = 'success') {
        const d = document.createElement('div');
        d.className = `sec-toast sec-toast-${tipo}`;
        d.setAttribute('role', 'alert');
        d.textContent = msg;
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 3000);
    }

    async function chamar(caminho, opcoes = {}) {
        const res = await fetch(`${API}${caminho}`, {
            credentials: 'include',
            headers: window.csrfHeaders(true),
            ...opcoes,
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Não foi possível concluir.');
        return json;
    }

    async function buscar() {
        const termo = busca.value.trim();
        resultados.innerHTML = '';
        if (termo.length < 2) return;
        try {
            const json = await chamar(`/secretaria/alunos/buscar?q=${encodeURIComponent(termo)}`, {
                method: 'GET',
            });
            for (const a of json.data?.alunos || []) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'sec-filter-btn';
                b.textContent = a.turmaAtual
                    ? `${a.nomeExibicao} · ${a.turmaAtual}`
                    : a.nomeExibicao;
                b.addEventListener('click', () => abrir(a));
                resultados.appendChild(b);
            }
        } catch (e) {
            aviso(e.message, 'error');
        }
    }

    async function abrir(aluno) {
        alunoAtual = aluno;
        titulo.textContent = aluno.nomeExibicao;
        painel.hidden = false;
        await carregar();
    }

    async function carregar() {
        lista.innerHTML = '';
        try {
            const json = await chamar(
                `/secretaria/alunos/${encodeURIComponent(alunoAtual.id)}/restricoes-acesso`,
                { method: 'GET' }
            );
            if (!json.data.length) {
                const li = document.createElement('li');
                li.textContent = 'Nenhum bloqueio para este aluno.';
                lista.appendChild(li);
                return;
            }
            for (const r of json.data) {
                const li = document.createElement('li');
                li.style.display = 'flex';
                li.style.gap = '0.5rem';
                li.style.alignItems = 'center';
                const texto = document.createElement('span');
                const desde = r.registradoEm
                    ? new Date(r.registradoEm).toLocaleDateString('pt-BR')
                    : '';
                texto.textContent = desde ? `${r.email} — desde ${desde}` : r.email;
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'sec-filter-btn';
                b.textContent = 'Retirar bloqueio';
                b.addEventListener('click', () => retirar(r.email));
                li.append(texto, b);
                lista.appendChild(li);
            }
        } catch (e) {
            aviso(e.message, 'error');
        }
    }

    async function retirar(email) {
        if (
            !confirm(
                `Retirar o bloqueio de ${email}? A pessoa volta a ter acesso se o e-mail estiver na ficha.`
            )
        ) {
            return;
        }
        try {
            await chamar(
                `/secretaria/alunos/${encodeURIComponent(alunoAtual.id)}/restricoes-acesso/remover`,
                {
                    method: 'POST',
                    body: JSON.stringify({ email }),
                }
            );
            aviso('Bloqueio retirado.');
            await carregar();
        } catch (e) {
            aviso(e.message, 'error');
        }
    }

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!alunoAtual) return;
        try {
            await chamar(
                `/secretaria/alunos/${encodeURIComponent(alunoAtual.id)}/restricoes-acesso`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        email: campoEmail.value,
                        confirmacao: confirmacao.checked === true,
                    }),
                }
            );
            aviso('Acesso bloqueado. As sessões da pessoa foram encerradas.');
            campoEmail.value = '';
            confirmacao.checked = false;
            await carregar();
        } catch (e) {
            aviso(e.message, 'error');
        }
    });

    busca.addEventListener('input', () => {
        clearTimeout(atraso);
        atraso = setTimeout(buscar, 300);
    });
});
