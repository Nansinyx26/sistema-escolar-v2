/**
 * Situação das autorizações da turma — tela do professor (Issue #496).
 *
 * Mostra só se a família autorizou cada atividade (sim, não, sem resposta).
 * Arquivo, dose de medicamento e contato de motorista ficam com a secretaria.
 * A consulta só abre se a direção da escola a liberou.
 */
document.addEventListener('DOMContentLoaded', async () => {
    const alvo = document.getElementById('autorizacoesTurma');
    if (!alvo) return;
    const API = window.API_BASE_URL || '/api';

    const ROTULO = { aceita: 'Autorizado', recusada: 'Não autorizado', pendente: 'Sem resposta' };
    const COR = { aceita: '#22c55e', recusada: '#ef4444', pendente: '#94a3b8' };

    function mensagem(texto) {
        alvo.innerHTML = '';
        const p = document.createElement('p');
        p.style.color = '#94a3b8';
        p.textContent = texto;
        alvo.appendChild(p);
    }

    let json;
    try {
        const res = await fetch(`${API}/turmas/autorizacoes/situacao`, { credentials: 'include' });
        json = await res.json();
    } catch {
        return mensagem('Não foi possível carregar as autorizações.');
    }
    if (!json.success) return mensagem(json.error || 'Não foi possível carregar as autorizações.');
    if (!json.data.length) return mensagem('Nenhum aluno nas suas turmas.');

    alvo.innerHTML = '';
    const porTurma = new Map();
    for (const a of json.data) {
        if (!porTurma.has(a.turma)) porTurma.set(a.turma, []);
        porTurma.get(a.turma).push(a);
    }

    for (const [turma, alunos] of porTurma) {
        const h = document.createElement('h2');
        h.textContent = turma ? `Turma ${turma}` : 'Sem turma';
        h.style.margin = '1.5rem 0 0.5rem';
        h.style.fontSize = '1.05rem';
        alvo.appendChild(h);

        const tipos = alunos[0].autorizacoes;
        const tabela = document.createElement('table');
        tabela.style.width = '100%';
        tabela.style.borderCollapse = 'collapse';
        const cab = document.createElement('tr');
        for (const titulo of ['Aluno', ...tipos.map((t) => t.titulo)]) {
            const th = document.createElement('th');
            th.textContent = titulo;
            th.style.textAlign = 'left';
            th.style.padding = '0.4rem';
            th.style.fontSize = '0.78rem';
            cab.appendChild(th);
        }
        const thead = document.createElement('thead');
        thead.appendChild(cab);
        tabela.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const aluno of alunos) {
            const tr = document.createElement('tr');
            const nome = document.createElement('td');
            nome.textContent = aluno.nome;
            nome.style.padding = '0.4rem';
            tr.appendChild(nome);
            for (const a of aluno.autorizacoes) {
                const td = document.createElement('td');
                td.textContent = ROTULO[a.situacao] || a.situacao;
                td.style.color = COR[a.situacao] || '';
                td.style.padding = '0.4rem';
                td.style.fontSize = '0.82rem';
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        tabela.appendChild(tbody);

        const rolagem = document.createElement('div');
        rolagem.style.overflowX = 'auto';
        rolagem.appendChild(tabela);
        alvo.appendChild(rolagem);
    }
});
