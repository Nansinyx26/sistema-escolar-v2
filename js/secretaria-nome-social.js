/**
 * Nome social do aluno — tela da secretaria (Issue #510).
 *
 * O registro exige o requerimento escrito: do próprio aluno, se maior de 18
 * anos, ou dos responsáveis. A regra de idade é conferida no servidor; aqui só
 * se coleta e se mostra a recusa. O nome social não vai para o console nem
 * para a URL.
 */
document.addEventListener('DOMContentLoaded', () => {
    const API = window.API_BASE_URL || '/api';
    const busca = document.getElementById('nomeSocialBusca');
    const resultados = document.getElementById('nomeSocialResultados');
    const painel = document.getElementById('nomeSocialPainel');
    const titulo = document.getElementById('nomeSocialAlunoTitulo');
    const atual = document.getElementById('nomeSocialAtual');
    const form = document.getElementById('nomeSocialForm');
    const campo = document.getElementById('nomeSocialCampo');
    const requerente = document.getElementById('nomeSocialRequerente');
    const confirmacao = document.getElementById('nomeSocialConfirmacao');
    const remover = document.getElementById('nomeSocialRemover');
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

    function mostrarAtual(nomeSocial) {
        atual.textContent = nomeSocial
            ? `Nome social registrado: ${nomeSocial}`
            : 'Nenhum nome social registrado.';
        remover.hidden = !nomeSocial;
    }

    async function abrir(aluno) {
        alunoAtual = aluno;
        titulo.textContent = aluno.nomeExibicao;
        painel.hidden = false;
        campo.value = '';
        confirmacao.checked = false;
        try {
            const json = await chamar(`/alunos/${encodeURIComponent(aluno.id)}`, { method: 'GET' });
            mostrarAtual(json.data?.nomeSocial || '');
            campo.value = json.data?.nomeSocial || '';
            if (json.data?.nomeSocialRequerimento?.requerente) {
                requerente.value = json.data.nomeSocialRequerimento.requerente;
            }
        } catch (e) {
            aviso(e.message, 'error');
        }
    }

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!alunoAtual) return;
        try {
            const json = await chamar(
                `/secretaria/alunos/${encodeURIComponent(alunoAtual.id)}/nome-social`,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        nomeSocial: campo.value,
                        requerente: requerente.value,
                        requerimentoArquivado: confirmacao.checked === true,
                    }),
                }
            );
            aviso('Nome social salvo.');
            confirmacao.checked = false;
            mostrarAtual(json.data?.nomeSocial || '');
        } catch (e) {
            aviso(e.message, 'error');
        }
    });

    remover.addEventListener('click', async () => {
        if (!alunoAtual) return;
        if (!confirm('Remover o nome social? O professor volta a ver o nome civil.')) return;
        try {
            await chamar(`/secretaria/alunos/${encodeURIComponent(alunoAtual.id)}/nome-social`, {
                method: 'DELETE',
            });
            aviso('Nome social removido.');
            campo.value = '';
            mostrarAtual('');
        } catch (e) {
            aviso(e.message, 'error');
        }
    });

    busca.addEventListener('input', () => {
        clearTimeout(atraso);
        atraso = setTimeout(buscar, 300);
    });
});
