/**
 * motion.js — Runtime de motion, skeleton e lazy loading.
 *
 * Par de css/motion.css. Aplica o sistema automaticamente em qualquer página
 * que carregue este script, inclusive em conteúdo inserido via innerHTML
 * depois de um fetch (que é como a maior parte deste sistema renderiza).
 *
 * Skill: design-motion-principles — weighting Emil (primário) · Jakub (secundário).
 * Regras completas em AGENTS.md §8 e docs/MOTION.md.
 *
 * Sem dependências. Idempotente: carregar duas vezes não duplica observers.
 *
 * API pública (window.Motion):
 *   Motion.reveal(root)                 marca filhos para entrada animada
 *   Motion.lazy(root)                   aplica lazy loading em <img>/<iframe>
 *   Motion.skeleton(el, opts)           troca o conteúdo por skeleton
 *   Motion.ready(el, html)              devolve o conteúdo real com entrada
 *   Motion.progress.start()/done()      barra de progresso do topo
 *   Motion.busy(btn, true|false)        botão em estado de envio
 *   Motion.enabled                      false se o usuário pediu menos movimento
 */
(function (global) {
    "use strict";

    if (global.Motion && global.Motion.__installed) return;

    var doc = global.document;
    var REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

    // ---------------------------------------------------------------- estado

    var prefersReduced = global.matchMedia ? global.matchMedia(REDUCE_QUERY).matches : false;

    // Preferência própria do sistema escolar, se o usuário desligou movimento
    // nas configurações. Vale junto com a preferência do sistema operacional.
    var userOptOut = false;
    try {
        userOptOut = global.localStorage.getItem("motion:off") === "1";
    } catch (_e) {
        // localStorage pode estar bloqueado (modo privado / cookies negados).
    }

    function motionEnabled() {
        return !prefersReduced && !userOptOut;
    }

    if (global.matchMedia) {
        var mq = global.matchMedia(REDUCE_QUERY);
        var onChange = function (ev) {
            prefersReduced = ev.matches;
            syncRootFlag();
        };
        // Safari < 14 só tem addListener.
        if (mq.addEventListener) mq.addEventListener("change", onChange);
        else if (mq.addListener) mq.addListener(onChange);
    }

    function syncRootFlag() {
        if (!doc.documentElement) return;
        if (motionEnabled()) doc.documentElement.removeAttribute("data-motion");
        else doc.documentElement.setAttribute("data-motion", "off");
    }

    // ------------------------------------------------------------- utilidades

    function toArray(list) {
        return Array.prototype.slice.call(list || []);
    }

    function isElement(node) {
        return node && node.nodeType === 1;
    }

    /** Elementos que nunca devem ganhar motion automático. */
    function isExcluded(el) {
        return !!el.closest(
            "[data-motion-skip], .motion-progress, .skeleton, [data-skeleton], " +
                "svg, canvas, script, style, head"
        );
    }

    // ------------------------------------------------------- 1. reveal (entrada)

    var revealObserver = null;

    function ensureRevealObserver() {
        if (revealObserver || !global.IntersectionObserver) return revealObserver;

        revealObserver = new global.IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    var el = entry.target;
                    el.classList.add("is-visible");
                    revealObserver.unobserve(el);

                    // Libera a camada de GPU quando a transição termina.
                    var settle = function () {
                        el.classList.add("is-settled");
                        el.removeEventListener("transitionend", settle);
                    };
                    el.addEventListener("transitionend", settle);
                    global.setTimeout(settle, 700);
                });
            },
            {
                // Começa a revelar um pouco antes de entrar de fato na tela,
                // para o elemento já chegar visível durante um scroll normal.
                rootMargin: "0px 0px -8% 0px",
                threshold: 0.01,
            }
        );

        return revealObserver;
    }

    /**
     * Marca elementos para entrada animada.
     * @param {Element|Document} root
     */
    function reveal(root) {
        root = root || doc;
        if (!motionEnabled()) return;

        var targets = toArray(root.querySelectorAll("[data-reveal]"));

        // Stagger: numera os filhos diretos de cada container escalonado.
        toArray(root.querySelectorAll("[data-reveal-stagger]")).forEach(function (group) {
            group.classList.add("motion-stagger");
            toArray(group.children).forEach(function (child, i) {
                child.style.setProperty("--motion-i", String(i));
                if (!child.hasAttribute("data-reveal")) {
                    child.setAttribute("data-reveal", "");
                    targets.push(child);
                }
            });
        });

        var observer = ensureRevealObserver();

        targets.forEach(function (el) {
            if (el.__motionRevealed || isExcluded(el)) return;
            el.__motionRevealed = true;
            el.classList.add("motion-reveal");

            if (!observer) {
                // Sem IntersectionObserver: mostra tudo. Nunca esconder conteúdo
                // por falta de suporte do navegador.
                el.classList.add("is-visible");
                return;
            }
            observer.observe(el);
        });
    }

    // -------------------------------------------------- 2. lazy loading de mídia

    /**
     * Aplica lazy loading nativo + entrada suave em imagens e iframes.
     * Imagens acima da dobra ficam com loading="eager" — atrasá-las pioraria
     * o LCP, que é justamente o oposto do objetivo.
     */
    function lazy(root) {
        root = root || doc;

        toArray(root.querySelectorAll("img")).forEach(function (img) {
            if (img.__motionLazy || isExcluded(img)) return;
            img.__motionLazy = true;

            if (!img.hasAttribute("decoding")) img.setAttribute("decoding", "async");

            var rect = img.getBoundingClientRect();
            var aboveFold = rect.top < (global.innerHeight || 800) && rect.bottom > 0;

            if (!img.hasAttribute("loading")) {
                img.setAttribute("loading", aboveFold ? "eager" : "lazy");
            }
            if (aboveFold && !img.hasAttribute("fetchpriority")) {
                img.setAttribute("fetchpriority", "high");
            }

            // Sem animação de entrada quando o movimento está desligado.
            if (!motionEnabled()) return;

            // Já veio do cache: não pisca.
            if (img.complete && img.naturalWidth > 0) return;

            img.setAttribute("data-motion-lazy", "");
            var done = function () {
                img.classList.add("is-loaded");
            };
            var failed = function () {
                img.classList.add("is-error");
            };

            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", failed, { once: true });

            // Rede muito lenta não pode deixar a imagem invisível para sempre.
            global.setTimeout(done, 8000);
        });

        toArray(root.querySelectorAll("iframe")).forEach(function (frame) {
            if (frame.hasAttribute("loading") || isExcluded(frame)) return;
            frame.setAttribute("loading", "lazy");
        });
    }

    // ------------------------------------------------------------ 3. skeleton

    var SKELETON_PRESETS = {
        text:
            '<div class="skeleton skeleton-line"></div>' +
            '<div class="skeleton skeleton-line"></div>' +
            '<div class="skeleton skeleton-line"></div>',

        card:
            '<div class="skeleton-card">' +
            '<div class="skeleton skeleton-heading"></div>' +
            '<div class="skeleton skeleton-line"></div>' +
            '<div class="skeleton skeleton-line"></div>' +
            "</div>",

        list:
            '<div class="skeleton-row">' +
            '<div class="skeleton skeleton-circle"></div>' +
            '<div class="skeleton skeleton-line"></div>' +
            "</div>",

        table:
            '<div class="skeleton-row">' +
            '<div class="skeleton skeleton-line"></div>' +
            '<div class="skeleton skeleton-line"></div>' +
            '<div class="skeleton skeleton-line"></div>' +
            '<div class="skeleton skeleton-line"></div>' +
            "</div>",

        media:
            '<div class="skeleton skeleton-thumb"></div>' +
            '<div class="skeleton skeleton-line"></div>',
    };

    /**
     * Substitui o conteúdo de um elemento por skeleton enquanto carrega.
     *
     *   Motion.skeleton(lista, { preset: "list", count: 6 });
     *   const dados = await fetch(...);
     *   Motion.ready(lista, html);
     *
     * @param {Element} el
     * @param {{preset?: string, count?: number, html?: string}} [opts]
     */
    function skeleton(el, opts) {
        if (!isElement(el)) return;
        opts = opts || {};

        var preset = SKELETON_PRESETS[opts.preset] || SKELETON_PRESETS.text;
        var count = Math.max(1, opts.count || 1);
        var markup = opts.html || new Array(count + 1).join(preset);

        // Guarda o conteúdo original só na primeira chamada.
        if (el.__motionOriginal === undefined) {
            el.__motionOriginal = el.innerHTML;
        }

        el.setAttribute("data-loading", "true");
        el.setAttribute("aria-busy", "true");
        el.innerHTML = '<div class="motion-skeleton" aria-hidden="true">' + markup + "</div>";
    }

    /**
     * Devolve o conteúdo real, com a entrada animada do sistema.
     * @param {Element} el
     * @param {string} [html] conteúdo novo; se omitido, restaura o original
     */
    function ready(el, html) {
        if (!isElement(el)) return;

        var content = html !== undefined ? html : el.__motionOriginal || "";

        el.setAttribute("data-loading", "false");
        el.setAttribute("aria-busy", "false");
        el.innerHTML = '<div class="motion-content">' + content + "</div>";
        el.__motionOriginal = undefined;

        // O conteúdo novo também recebe lazy loading e reveal.
        enhance(el);
    }

    // ------------------------------------------------------------ 4. progresso

    var progressEl = null;
    var progressTimer = null;
    var progressDepth = 0;

    function progressNode() {
        if (progressEl && doc.body.contains(progressEl)) return progressEl;
        progressEl = doc.createElement("div");
        progressEl.className = "motion-progress";
        progressEl.setAttribute("role", "progressbar");
        progressEl.setAttribute("aria-label", "Carregando");
        progressEl.setAttribute("aria-hidden", "true");
        doc.body.appendChild(progressEl);
        return progressEl;
    }

    var progress = {
        start: function () {
            progressDepth++;
            if (progressDepth > 1) return;
            if (!doc.body) return;

            // Só aparece se a operação passar de 180ms. Piscar uma barra em
            // toda requisição rápida é ruído, não informação.
            progressTimer = global.setTimeout(function () {
                var bar = progressNode();
                bar.classList.remove("is-done");
                bar.style.transform = "scaleX(0.12)";
                global.requestAnimationFrame(function () {
                    bar.style.transform = "scaleX(0.7)";
                });
            }, 180);
        },

        done: function () {
            progressDepth = Math.max(0, progressDepth - 1);
            if (progressDepth > 0) return;

            global.clearTimeout(progressTimer);
            if (!progressEl) return;

            progressEl.style.transform = "scaleX(1)";
            progressEl.classList.add("is-done");
            var bar = progressEl;
            global.setTimeout(function () {
                bar.style.transform = "scaleX(0)";
                bar.classList.remove("is-done");
            }, 320);
        },

        /** Progresso determinado, de 0 a 1, em um .motion-progress-bar. */
        set: function (el, value) {
            if (!isElement(el)) return;
            var v = Math.min(1, Math.max(0, Number(value) || 0));
            el.style.setProperty("--motion-progress", String(v));
            el.setAttribute("aria-valuenow", String(Math.round(v * 100)));
        },
    };

    /** Botão em envio: trava, evita duplo submit e mostra spinner. */
    function busy(el, state) {
        if (!isElement(el)) return;

        if (state === false) {
            el.classList.remove("is-busy");
            el.removeAttribute("aria-busy");
            if (el.__motionLabel !== undefined) {
                el.innerHTML = el.__motionLabel;
                el.__motionLabel = undefined;
            }
            if (el.tagName === "BUTTON") el.disabled = false;
            return;
        }

        if (el.classList.contains("is-busy")) return;
        el.__motionLabel = el.innerHTML;
        el.classList.add("is-busy");
        el.setAttribute("aria-busy", "true");
        if (el.tagName === "BUTTON") el.disabled = true;
        el.innerHTML =
            '<span class="motion-spinner" aria-hidden="true"></span> ' +
            (el.getAttribute("data-busy-label") || "Aguarde…");
    }

    // -------------------------------------- 5. progresso automático em fetch

    /**
     * Liga a barra de progresso ao fetch global. Requisições marcadas com
     * `headers: { "X-Motion-Silent": "1" }` — polling, telemetria, heartbeat —
     * ficam de fora, senão a barra viveria piscando.
     */
    function hookFetch() {
        if (!global.fetch || global.fetch.__motionWrapped) return;

        var original = global.fetch;
        var wrapped = function (_input, init) {
            var silent = false;
            try {
                var h = (init && init.headers) || {};
                silent =
                    h["X-Motion-Silent"] === "1" ||
                    (typeof h.get === "function" && h.get("X-Motion-Silent") === "1");
            } catch (_e) {
                /* headers exóticos: segue sem silenciar */
            }

            if (silent) return original.apply(this, arguments);

            progress.start();
            return original.apply(this, arguments).then(
                function (res) {
                    progress.done();
                    return res;
                },
                function (err) {
                    progress.done();
                    throw err;
                }
            );
        };
        wrapped.__motionWrapped = true;
        global.fetch = wrapped;
    }

    // ------------------------------------------------- 6. superfícies (estado)

    /**
     * Abre/fecha uma superfície animada com origem correta.
     * @param {Element} el elemento com [data-motion="modal"|"popover"|...]
     * @param {boolean} open
     * @param {Element} [trigger] usado para calcular o transform-origin
     */
    function surface(el, open, trigger) {
        if (!isElement(el)) return;

        if (trigger && isElement(trigger)) {
            var t = trigger.getBoundingClientRect();
            var e = el.getBoundingClientRect();
            var originX = t.left + t.width / 2 - e.left;
            var originY = t.top < e.top ? 0 : e.height;
            el.style.setProperty("--motion-origin", originX + "px " + originY + "px");
        }

        el.setAttribute("data-state", open ? "open" : "closed");
        if (open) el.removeAttribute("hidden");
    }

    // ------------------------------------------ 7. conteúdo dinâmico (observer)

    var mutationObserver = null;
    var pendingScan = null;

    function scheduleScan(node) {
        if (pendingScan) return;
        pendingScan = global.setTimeout(function () {
            pendingScan = null;
            enhance(node && node.isConnected ? node : doc);
        }, 80);
    }

    function watchDynamicContent() {
        if (mutationObserver || !global.MutationObserver || !doc.body) return;

        mutationObserver = new global.MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    if (isElement(added[j])) {
                        scheduleScan(added[j].parentNode || doc);
                        return;
                    }
                }
            }
        });

        mutationObserver.observe(doc.body, { childList: true, subtree: true });
    }

    // ------------------------------------------------------------- 8. enhance

    /**
     * Aplica todo o sistema a uma subárvore. Seguro chamar quantas vezes quiser.
     * @param {Element|Document} [root]
     */
    function enhance(root) {
        root = root || doc;
        lazy(root);
        reveal(root);
    }

    // ------------------------------------------------------------- 9. bootstrap

    function init() {
        syncRootFlag();
        enhance(doc);
        hookFetch();
        watchDynamicContent();

        // Navegação de saída: mostra progresso ao sair para outra página.
        // (Este sistema é multipágina — cada link é um carregamento inteiro.)
        doc.addEventListener(
            "click",
            function (ev) {
                var link = ev.target && ev.target.closest && ev.target.closest("a[href]");
                if (!link) return;
                if (link.target === "_blank" || link.hasAttribute("download")) return;
                if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;

                var href = link.getAttribute("href");
                if (!href || href.charAt(0) === "#" || /^(mailto|tel|javascript):/i.test(href))
                    return;

                progress.start();
            },
            true
        );

        // Voltar pelo histórico com bfcache: a barra não pode ficar presa.
        global.addEventListener("pageshow", function () {
            progressDepth = 0;
            global.clearTimeout(progressTimer);
            if (progressEl) {
                progressEl.style.transform = "scaleX(0)";
                progressEl.classList.remove("is-done");
            }
        });
    }

    if (doc.readyState === "loading") {
        doc.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

    // ---------------------------------------------------------------- exporta

    var Motion = {
        __installed: true,
        enhance: enhance,
        reveal: reveal,
        lazy: lazy,
        skeleton: skeleton,
        ready: ready,
        progress: progress,
        busy: busy,
        surface: surface,
        presets: SKELETON_PRESETS,

        get enabled() {
            return motionEnabled();
        },

        /** Liga/desliga o movimento pela preferência do próprio sistema. */
        setEnabled: function (on) {
            userOptOut = !on;
            try {
                global.localStorage.setItem("motion:off", on ? "0" : "1");
            } catch (_e) {
                /* storage indisponível: vale só nesta sessão */
            }
            syncRootFlag();
        },
    };

    global.Motion = Motion;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = Motion;
    }
})(typeof window !== "undefined" ? window : this);
