/**
 * escolas-modal.js — popula o modal "Escolas em Americana" da landing page
 * a partir de GET /api/escolas (substitui a lista hardcoded).
 *
 * - Escola ativa   → link clicável para /html/login.html?escolaId=<id>
 * - Escola inativa → cadeado, não clicável, tooltip "em breve"
 * - Se a API falhar, mantém o fallback estático já presente no HTML.
 */
(function () {
    'use strict';

    var API_BASE = window.API_BASE_URL || (
        (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? 'http://localhost:3001/api'
            : (location.origin + '/api')
    );

    function iconePorTipo(tipo) {
        return tipo === 'CIEP' ? 'bi-mortarboard' : 'bi-book';
    }

    function textoEscola(e) {
        var partes = [e.nome];
        var local = [e.endereco, e.bairro].filter(Boolean).join(' - ');
        if (local) partes.push(local);
        return partes.join(' — ');
    }

    function renderEscolas(escolas) {
        var lista = document.getElementById('schoolSwitcherList');
        if (!lista || !escolas.length) return;

        // Ativas primeiro, depois por tipo/nome (a API já ordena por tipo/nome)
        escolas.sort(function (a, b) { return (b.ativo ? 1 : 0) - (a.ativo ? 1 : 0); });

        lista.textContent = '';
        escolas.forEach(function (e) {
            var item = document.createElement('a');
            item.className = 'school-list-item ' + (e.tipo === 'CIEP' ? 'ciep' : 'emef');

            var icone = document.createElement('i');
            icone.className = 'bi ' + iconePorTipo(e.tipo);
            item.appendChild(icone);
            item.appendChild(document.createTextNode(' ' + textoEscola(e) + ' '));

            if (e.ativo) {
                item.href = '/html/login.html?escolaId=' + encodeURIComponent(e._id);
                item.title = 'Entrar em ' + e.nome;
                // Persiste a escolha: a marca da landing (e futuras visitas)
                // passa a exibir a escola selecionada
                item.addEventListener('click', function () {
                    try {
                        localStorage.setItem('escolaSelecionada', JSON.stringify({ id: String(e._id), nome: e.nome }));
                    } catch (err) { /* armazenamento indisponível */ }
                    aplicarMarcaEscola(e.nome);
                });
            } else {
                var cadeado = document.createElement('i');
                cadeado.className = 'bi bi-lock-fill lock-icon-item';
                item.appendChild(cadeado);
                item.title = 'Em breve';
                item.setAttribute('aria-disabled', 'true');
            }
            lista.appendChild(item);
        });
    }

    /**
     * Marquee da landing com os nomes REAIS das escolas da rede —
     * substitui a faixa genérica de funcionalidades (conteúdo verdadeiro
     * ancora a página; a lista genérica parecia template).
     */
    function renderMarquee(escolas) {
        var inner = document.querySelector('.marquee-inner');
        if (!inner || !escolas.length) return;

        inner.textContent = '';
        // Duplica a sequência para o loop contínuo do CSS não "saltar"
        var sequencia = escolas.concat(escolas);
        sequencia.forEach(function (e) {
            var item = document.createElement('span');
            item.className = 'marquee-item';
            var dot = document.createElement('span');
            dot.className = 'mdot';
            item.appendChild(dot);
            item.appendChild(document.createTextNode(e.nome + (e.ativo ? '' : ' · em breve')));
            inner.appendChild(item);
        });
    }

    /**
     * Troca o nome no topo da landing pela escola selecionada.
     * Padrão: "Escola Jaguari" (a escola em operação).
     */
    function aplicarMarcaEscola(nome) {
        var brand = document.getElementById('navBrandNome');
        if (brand && nome) brand.textContent = nome.toUpperCase();
        var splash = document.querySelector('.splash-title');
        if (splash && nome) splash.textContent = nome;
    }

    function restaurarMarcaEscola() {
        try {
            var salva = JSON.parse(localStorage.getItem('escolaSelecionada') || 'null');
            if (salva && salva.nome) aplicarMarcaEscola(salva.nome);
        } catch (e) { /* mantém a marca padrão */ }
    }

    function carregar() {
        restaurarMarcaEscola();
        fetch(API_BASE + '/escolas')
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (json) {
                if (json && json.success && Array.isArray(json.data) && json.data.length > 0) {
                    renderEscolas(json.data);
                    renderMarquee(json.data);
                }
                // API vazia ou fora do ar: mantém o fallback estático do HTML
            })
            .catch(function () { /* fallback estático permanece */ });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', carregar);
    } else {
        carregar();
    }
})();
