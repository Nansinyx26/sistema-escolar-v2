/**
 * saude-painel.js — painel de saúde do sistema (html/admin/saude.html).
 *
 * Lê o que o sistema JÁ mede e não mostrava a ninguém: `MonitoringService`
 * acumula banco, cache, memória e métricas de requisição desde sempre, e tudo
 * isso ia só para o log. Aqui vira tela.
 *
 * Sem serviço externo, sem conta, sem chave, sem custo. Para um sistema com
 * dado de menor de idade isso também é melhor por outro motivo: nenhuma
 * métrica de uso da escola sai da infraestrutura própria.
 *
 * Ver a Issue #17 e docs/OBSERVABILITY.md.
 */
(function (global) {
    "use strict";

    var doc = global.document;

    var ENDPOINTS = {
        saude: "/api/monitoring/health",
        rotas: "/api/monitoring/rotas",
    };

    /** Limiares de leitura. Acima disso a linha ganha faixa de severidade. */
    var LIMITE_ERRO_GRAVE = 0.1; // 10% das requisições falhando
    var LIMITE_ERRO_ATENCAO = 0.02; // 2%
    var LIMITE_LENTO_MS = 500;

    function pct(v) {
        return (v * 100).toFixed(v < 0.1 && v > 0 ? 1 : 0) + "%";
    }

    /** Pastilha de estado: cor E texto, nunca só cor. */
    function pastilha(estado, texto) {
        return '<span class="pastilha ' + estado + '">' + texto + "</span>";
    }

    function escapar(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function cartao(rotulo, valor, nota) {
        return (
            '<div class="cartao">' +
            '<div class="cartao-rotulo">' +
            escapar(rotulo) +
            "</div>" +
            '<div class="cartao-valor">' +
            valor +
            "</div>" +
            (nota ? '<div class="cartao-nota">' + nota + "</div>" : "") +
            "</div>"
        );
    }

    function renderResumo(s) {
        var m = s.metrics || {};
        var taxa = m.requests ? m.errors / m.requests : 0;

        var estadoGeral = s.ok ? "ok" : "erro";
        var textoGeral = s.ok ? "Operacional" : "Com falha";

        var partes = [
            cartao("Estado geral", pastilha(estadoGeral, textoGeral), "Verificado agora"),

            cartao(
                "Banco de dados",
                pastilha(
                    s.database && s.database.ok ? "ok" : "erro",
                    s.database ? s.database.status : "?"
                ),
                s.database && s.database.responseTime != null
                    ? "Resposta em " + s.database.responseTime + " ms"
                    : ""
            ),

            cartao(
                "Cache",
                pastilha(s.cache && s.cache.ok ? "ok" : "alerta", s.cache ? s.cache.status : "?"),
                s.cache ? s.cache.type : ""
            ),

            cartao(
                "Taxa de erro",
                pct(taxa),
                (m.errors || 0) + " de " + (m.requests || 0) + " requisições"
            ),

            cartao(
                "Resposta média",
                Math.round(m.avgResponseTime || 0) + " ms",
                (m.avgResponseTime || 0) > LIMITE_LENTO_MS ? "Acima do limite" : "Dentro do limite"
            ),

            cartao(
                "Memória",
                s.system && s.system.memory ? s.system.memory.percentage : "—",
                s.system && s.system.memory
                    ? s.system.memory.used + " de " + s.system.memory.total
                    : ""
            ),

            cartao(
                "No ar há",
                s.system && s.system.uptime ? s.system.uptime.process : "—",
                "Desde o último deploy"
            ),
        ];

        // Alertas ativos só aparecem quando existem — cartão vazio é ruído.
        if (s.alerts && s.alerts.length) {
            partes.push(
                cartao(
                    "Alertas ativos",
                    pastilha("alerta", String(s.alerts.length)),
                    s.alerts[0].message || ""
                )
            );
        }

        return partes.join("");
    }

    function renderRotas(lista) {
        if (!lista || !lista.length) {
            return (
                '<div class="vazio">Nenhuma requisição registrada desde que o servidor subiu. ' +
                "As métricas zeram a cada deploy.</div>"
            );
        }

        var linhas = lista.map(function (r) {
            var classe = "";
            if (r.taxaErro >= LIMITE_ERRO_GRAVE) classe = "grave";
            else if (r.taxaErro >= LIMITE_ERRO_ATENCAO || r.mediaMs > LIMITE_LENTO_MS)
                classe = "atencao";

            return (
                '<tr class="' +
                classe +
                '">' +
                '<td class="rota">' +
                escapar(r.rota) +
                "</td>" +
                '<td class="n">' +
                r.requisicoes +
                "</td>" +
                '<td class="n">' +
                r.erros +
                "</td>" +
                '<td class="n">' +
                pct(r.taxaErro) +
                "</td>" +
                '<td class="n">' +
                pct(r.disponibilidade) +
                "</td>" +
                '<td class="n">' +
                r.mediaMs +
                " ms</td>" +
                '<td class="n">' +
                r.maxMs +
                " ms</td>" +
                "</tr>"
            );
        });

        return (
            '<div class="tabela-caixa"><table>' +
            "<thead><tr>" +
            "<th>Rota</th><th>Requisições</th><th>Erros</th><th>Taxa de erro</th>" +
            "<th>Disponibilidade</th><th>Média</th><th>Pior caso</th>" +
            "</tr></thead><tbody>" +
            linhas.join("") +
            "</tbody></table></div>"
        );
    }

    function falha(mensagem) {
        return '<div class="vazio">' + escapar(mensagem) + "</div>";
    }

    async function carregar() {
        var elCartoes = doc.getElementById("cartoes");
        var elRotas = doc.getElementById("rotas-caixa");
        var elAtualizado = doc.getElementById("atualizado");
        var elRodape = doc.getElementById("rodape");
        var botao = doc.getElementById("recarregar");

        if (global.Motion) {
            global.Motion.busy(botao, true);
            global.Motion.skeleton(elCartoes, { preset: "card", count: 4 });
            global.Motion.skeleton(elRotas, { preset: "table", count: 5 });
        }

        try {
            // As duas em paralelo: uma não depende da outra, e sequencial
            // dobraria a espera à toa.
            var [resSaude, resRotas] = await Promise.all([
                fetch(ENDPOINTS.saude, { credentials: "same-origin" }),
                fetch(ENDPOINTS.rotas, { credentials: "same-origin" }),
            ]);

            // O health responde 503 quando algo está degradado — e é exatamente
            // esse corpo que interessa mostrar. Tratar 503 como erro de rede
            // esconderia a informação no momento em que ela mais importa.
            var saude = await resSaude.json();

            if (global.Motion) global.Motion.ready(elCartoes, renderResumo(saude));
            else elCartoes.innerHTML = renderResumo(saude);

            if (resRotas.ok) {
                var dados = await resRotas.json();
                var html = renderRotas(dados.rotas);
                if (global.Motion) global.Motion.ready(elRotas, html);
                else elRotas.innerHTML = html;

                elRodape.textContent =
                    dados.totalRotas +
                    " de " +
                    dados.limiteRotas +
                    " rotas monitoradas. As métricas são do processo em execução e " +
                    "zeram a cada deploy — não há banco de série histórica.";
            } else if (resRotas.status === 401 || resRotas.status === 403) {
                var aviso = falha("Estatística por rota exige perfil de administrador.");
                if (global.Motion) global.Motion.ready(elRotas, aviso);
                else elRotas.innerHTML = aviso;
            } else {
                var erro = falha("Não foi possível carregar a estatística por rota.");
                if (global.Motion) global.Motion.ready(elRotas, erro);
                else elRotas.innerHTML = erro;
            }

            elAtualizado.textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-BR");
        } catch (e) {
            var msg = falha("Não foi possível falar com o servidor. Ele pode estar reiniciando.");
            if (global.Motion) {
                global.Motion.ready(elCartoes, msg);
                global.Motion.ready(elRotas, "");
            } else {
                elCartoes.innerHTML = msg;
            }
            if (global.Observability) global.Observability.captureException(e, { pagina: "saude" });
        } finally {
            if (global.Motion) global.Motion.busy(botao, false);
        }
    }

    doc.addEventListener("DOMContentLoaded", function () {
        carregar();
        doc.getElementById("recarregar").addEventListener("click", carregar);
    });
})(typeof window !== "undefined" ? window : this);
