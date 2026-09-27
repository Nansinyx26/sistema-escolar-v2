/**
 * superadmin-contexto.js — faixa fixa "Você está visualizando a escola X como
 * Super Admin" (Issue #463).
 *
 * Carregado sob demanda por js/api-config.js, só quando a aba tem a marca
 * `superadminContexto` (gravada pela Gestão de Escolas ao entrar numa escola).
 * A marca é só o gatilho: quem confirma o contexto é o servidor
 * (GET /api/superadmin/contexto). Se a sessão já não estiver na escola — saiu
 * por outra aba, trocou de escola, a sessão expirou —, a faixa não aparece e
 * a marca é apagada.
 *
 * Sem animação de entrada: aparece em toda navegação e precisa estar lá desde
 * o primeiro instante, não chamar atenção para si mesma.
 */
(function () {
    'use strict';

    var CHAVE = 'superadminContexto';
    var API = window.API_BASE_URL || '/api';
    var ALTURA = 44;

    function lerMarca() {
        try {
            return JSON.parse(sessionStorage.getItem(CHAVE) || 'null');
        } catch (_e) {
            return null;
        }
    }

    function apagarMarca() {
        try {
            sessionStorage.removeItem(CHAVE);
        } catch (_e) {
            /* nada a apagar */
        }
    }

    function estilos() {
        if (document.getElementById('superadminFaixaEstilo')) return;
        var css =
            '#superadminFaixa{position:fixed;top:0;left:0;right:0;z-index:2147483000;min-height:' +
            ALTURA +
            'px;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;' +
            'padding:6px 16px;background:#7c2d12;color:#fff7ed;font:500 14px/1.35 var(--font-primary,system-ui,sans-serif);' +
            'box-shadow:0 2px 12px rgba(0,0,0,.35);text-align:center}' +
            '#superadminFaixa strong{font-weight:700}' +
            '#superadminFaixa .sa-selo{padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.16);font-size:12px;font-weight:600}' +
            '#superadminFaixa button{min-height:32px;padding:4px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.55);' +
            'background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}' +
            '#superadminFaixa button:hover{background:rgba(255,255,255,.12)}' +
            '#superadminFaixa button:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
            'body.superadmin-com-faixa{padding-top:var(--superadmin-faixa-altura,' +
            ALTURA +
            'px)!important}';
        var style = document.createElement('style');
        style.id = 'superadminFaixaEstilo';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function ajustarEspaco(faixa) {
        document.body.style.setProperty('--superadmin-faixa-altura', faixa.offsetHeight + 'px');
    }

    function montar(contexto) {
        if (document.getElementById('superadminFaixa')) return;
        estilos();

        var faixa = document.createElement('div');
        faixa.id = 'superadminFaixa';
        faixa.setAttribute('role', 'region');
        faixa.setAttribute('aria-label', 'Contexto do Super Admin');

        var texto = document.createElement('span');
        texto.appendChild(document.createTextNode('Você está visualizando a escola '));
        var nome = document.createElement('strong');
        nome.textContent = contexto.nome || 'selecionada';
        texto.appendChild(nome);
        texto.appendChild(document.createTextNode(' como Super Admin'));
        faixa.appendChild(texto);

        if (contexto.status === 'bloqueada') {
            var selo = document.createElement('span');
            selo.className = 'sa-selo';
            selo.textContent = 'Escola bloqueada';
            faixa.appendChild(selo);
        }

        var sair = document.createElement('button');
        sair.type = 'button';
        sair.textContent = 'Sair da escola';
        sair.addEventListener('click', function () {
            sair.disabled = true;
            fetch(API + '/superadmin/contexto', {
                method: 'DELETE',
                credentials: 'include',
                headers: window.csrfHeaders ? window.csrfHeaders(false) : {},
            })
                .catch(function () {
                    /* sai mesmo assim: a próxima tela confirma pelo servidor */
                })
                .then(function () {
                    apagarMarca();
                    var destino =
                        window.ROTAS && typeof window.ROTAS.resolver === 'function'
                            ? window.ROTAS.resolver('admin.gestaoEscolas')
                            : Promise.resolve(null);
                    return destino.then(function (caminho) {
                        window.location.href = caminho || '/superadmin/escolas';
                    });
                });
        });
        faixa.appendChild(sair);

        document.body.insertBefore(faixa, document.body.firstChild);
        document.body.classList.add('superadmin-com-faixa');
        ajustarEspaco(faixa);
        window.addEventListener('resize', function () {
            ajustarEspaco(faixa);
        });
    }

    function iniciar() {
        var marca = lerMarca();
        if (!marca) return;
        // Mostra na hora com a marca da aba; o servidor confirma em seguida.
        montar(marca);
        fetch(API + '/superadmin/contexto', { credentials: 'include' })
            .then(function (r) {
                return r.ok ? r.json() : null;
            })
            .then(function (json) {
                var contexto = json && json.success ? json.data : null;
                if (contexto) return;
                apagarMarca();
                var faixa = document.getElementById('superadminFaixa');
                if (faixa) faixa.remove();
                document.body.classList.remove('superadmin-com-faixa');
            })
            .catch(function () {
                /* rede fora: mantém a faixa — é o lado seguro para quem está vendo dados de outra escola */
            });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
