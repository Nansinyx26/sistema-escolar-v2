/** gerenciar-salas-events.js — substitui onclick do gerenciar-salas.html */
document.addEventListener('DOMContentLoaded', function () {
    // Navegação genérica por data-href
    document.querySelectorAll('[data-href]').forEach(function (btn) {
        btn.addEventListener('click', function () { window.location.href = this.dataset.href; });
    });

    // Fechar Modal (botões Fechar e Cancelar)
    document.querySelectorAll('#btn-fechar-modal-salas, .btn-close').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (typeof fecharModal === 'function') fecharModal();
        });
    });

    // Salvar Atribuição
    const btnSalvar = document.getElementById('btn-salvar-atribuicao');
    if (btnSalvar) btnSalvar.addEventListener('click', function () {
        if (typeof salvarAtribuicao === 'function') salvarAtribuicao();
    });

    // Alternar sub-grupo de matérias dinâmico com base no tipo de atribuição
    const radiosTipo = document.querySelectorAll('input[name="tipoAtribuicao"]');
    const subGrupo = document.getElementById('subGrupoMateria');
    
    radiosTipo.forEach(function (radio) {
        radio.addEventListener('change', function () {
            if (this.value === 'adicional') {
                subGrupo.classList.remove('hidden');
                subGrupo.style.display = 'block';
            } else {
                subGrupo.classList.add('hidden');
                subGrupo.style.display = 'none';
            }
        });
    });

    // Alternar entre PEB II e Oficinas
    const radiosCategoria = document.querySelectorAll('input[name="categoriaMateria"]');
    const grupoPeb2 = document.getElementById('grupoPeb2');
    const grupoOficina = document.getElementById('grupoOficina');

    radiosCategoria.forEach(function (radio) {
        radio.addEventListener('change', function () {
            if (this.value === 'peb2') {
                grupoPeb2.classList.remove('hidden');
                grupoPeb2.style.display = 'block';
                grupoOficina.classList.add('hidden');
                grupoOficina.style.display = 'none';
            } else {
                grupoOficina.classList.remove('hidden');
                grupoOficina.style.display = 'block';
                grupoPeb2.classList.add('hidden');
                grupoPeb2.style.display = 'none';
            }
        });
    });
});
