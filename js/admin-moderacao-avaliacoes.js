/**
 * Moderação das avaliações que vão para a página inicial (Issue #489).
 *
 * A API devolve só iniciais, papel, nota e texto — a tela não tem como mostrar
 * mais que isso, e não precisa: a decisão é sobre o texto publicado.
 */
(() => {
    const corpo = document.getElementById('tabelaModeracaoBody');
    const filtro = document.getElementById('filtroSituacao');

    function linhaVazia(texto) {
        corpo.innerHTML = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.style.textAlign = 'center';
        td.style.padding = '2rem';
        td.textContent = texto;
        tr.appendChild(td);
        corpo.appendChild(tr);
    }

    function celula(texto) {
        const td = document.createElement('td');
        td.textContent = texto;
        return td;
    }

    async function decidir(item, decisao, b) {
        b.disabled = true;
        try {
            const r = await window.apiFetch(`/avaliacoes/moderacao/${item.colecao}/${item._id}`, {
                method: 'PATCH',
                body: JSON.stringify({ decisao }),
            });
            if (!r.success) throw new Error(r.error || 'Falha ao salvar a decisão.');
            await carregar();
        } catch (e) {
            b.disabled = false;
            alert(e.message);
        }
    }

    function botao(rotulo, decisao, item) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className =
            decisao === 'aprovada' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
        b.textContent = rotulo;
        b.addEventListener('click', () => decidir(item, decisao, b));
        return b;
    }

    async function carregar() {
        linhaVazia('Carregando avaliações...');
        try {
            const r = await window.apiFetch(
                `/avaliacoes/moderacao?situacao=${encodeURIComponent(filtro.value)}`
            );
            if (!r.success) throw new Error(r.error || 'Falha ao carregar.');
            if (!r.data.length) return linhaVazia('Nenhuma avaliação nesta situação.');

            corpo.innerHTML = '';
            for (const item of r.data) {
                const tr = document.createElement('tr');
                tr.appendChild(celula(`${item.nome} · ${item.perfil}`));
                tr.appendChild(celula('★'.repeat(Number(item.estrelas) || 0)));
                tr.appendChild(celula(item.texto || ''));
                tr.appendChild(celula(item.exibirPublicamente ? 'Sim' : 'Não'));
                tr.appendChild(
                    celula(
                        item.dataCriacao
                            ? new Date(item.dataCriacao).toLocaleDateString('pt-BR')
                            : '—'
                    )
                );
                const acoes = document.createElement('td');
                acoes.style.display = 'flex';
                acoes.style.gap = '0.4rem';
                if (item.moderacao !== 'aprovada')
                    acoes.appendChild(botao('Aprovar', 'aprovada', item));
                if (item.moderacao !== 'recusada')
                    acoes.appendChild(botao('Recusar', 'recusada', item));
                tr.appendChild(acoes);
                corpo.appendChild(tr);
            }
        } catch (e) {
            linhaVazia(e.message);
        }
    }

    filtro.addEventListener('change', carregar);
    document.getElementById('btnAtualizarModeracao').addEventListener('click', carregar);
    carregar();
})();
