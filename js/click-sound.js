/**
 * js/click-sound.js
 * Som de clique suave para botões (mobile + desktop).
 *
 * - Usa a Web Audio API para sintetizar o som em tempo real,
 *   então não depende de nenhum arquivo de áudio externo.
 * - O AudioContext só é criado/desbloqueado no primeiro toque do
 *   usuário (exigência do iOS/Android e da maioria dos navegadores).
 * - Respeita `prefers-reduced-motion` e permite silenciar salvando
 *   `localStorage.clickSound = 'off'`.
 */
(function () {
  'use strict';

  // Evita carregar duas vezes se o script for incluído em duplicidade.
  if (window.__clickSoundLoaded) return;
  window.__clickSoundLoaded = true;

  // Garante o controle de tema (claro/escuro) em todo o sistema.
  // click-sound.js está presente em praticamente todas as páginas, então
  // usamos ele para injetar js/theme.js sem precisar editar cada HTML.
  (function loadThemeController() {
    if (window.__themeControllerLoaded) return; // já incluído diretamente
    try {
      var self = document.currentScript;
      var base = self && self.src ? self.src.replace(/[^/]*$/, '') : 'js/';
      window.__assetJsBase = base; // fallback de caminho para o theme.js
      var s = document.createElement('script');
      s.src = base + 'theme.js';
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return; // Navegador sem Web Audio: sai silenciosamente.

  var ctx = null;
  var lastPlay = 0; // throttle para evitar cliques sobrepostos

  var reducedMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isEnabled() {
    try {
      if (localStorage.getItem('clickSound') === 'off') return false;
    } catch (e) {}
    return !reducedMotion;
  }

  // Cria o contexto no primeiro gesto do usuário e o mantém "acordado".
  function ensureContext() {
    if (!ctx) {
      try {
        ctx = new AudioCtx();
      } catch (e) {
        return null;
      }
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(function () {});
    }
    return ctx;
  }

  /**
   * Toca um clique curto e suave.
   * Dois osciladores rápidos com decaimento exponencial dão a sensação
   * de "tick" tátil sem ser estridente.
   */
  function playClick() {
    if (!isEnabled()) return;

    var now = Date.now();
    if (now - lastPlay < 40) return; // no máx. ~25 cliques/s
    lastPlay = now;

    var ac = ensureContext();
    if (!ac) return;

    var t = ac.currentTime;

    var gain = ac.createGain();
    // Volume suave. Ajuste 0.10 se quiser mais/menos.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.10, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    gain.connect(ac.destination);

    // Corpo do clique (frequência que cai levemente).
    var osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + 0.06);
    osc.connect(gain);

    // Pequeno "attack" agudo para dar o toque de clique.
    var osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1400, t);
    var g2 = ac.createGain();
    g2.gain.setValueAtTime(0.05, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    osc2.connect(g2);
    g2.connect(ac.destination);

    osc.start(t);
    osc2.start(t);
    osc.stop(t + 0.09);
    osc2.stop(t + 0.03);
  }

  // Elementos que devem soar ao serem acionados.
  var SELECTOR =
    'button, a, [role="button"], input[type="button"], ' +
    'input[type="submit"], input[type="reset"], .btn, ' +
    '[data-click-sound], summary, label[for], select';

  function shouldSound(el) {
    if (!el || !el.closest) return false;
    var target = el.closest(SELECTOR);
    if (!target) return false;
    // Permite desativar por elemento com data-click-sound="off".
    if (target.getAttribute &&
        target.getAttribute('data-click-sound') === 'off') return false;
    if (target.disabled) return false;
    if (target.getAttribute && target.getAttribute('aria-disabled') === 'true')
      return false;
    return true;
  }

  // Usamos `pointerdown` (com fallbacks) para que o som acompanhe o toque
  // imediatamente no mobile, sem o atraso do evento `click`.
  var lastHandled = 0;
  function handler(e) {
    // Evita disparo duplo entre pointerdown e click no mesmo gesto.
    var now = Date.now();
    if (now - lastHandled < 60) return;
    if (!shouldSound(e.target)) return;
    lastHandled = now;
    playClick();
  }

  var opts = { capture: true, passive: true };
  if (window.PointerEvent) {
    document.addEventListener('pointerdown', handler, opts);
  } else {
    document.addEventListener('touchstart', handler, opts);
    document.addEventListener('mousedown', handler, opts);
  }

  // Desbloqueia o áudio no primeiro gesto, mesmo fora de um botão.
  function unlockOnce() {
    ensureContext();
    document.removeEventListener('pointerdown', unlockOnce, true);
    document.removeEventListener('touchstart', unlockOnce, true);
    document.removeEventListener('keydown', unlockOnce, true);
  }
  document.addEventListener('pointerdown', unlockOnce, true);
  document.addEventListener('touchstart', unlockOnce, true);
  document.addEventListener('keydown', unlockOnce, true);

  // ── Botão flutuante para ligar/desligar o som ─────────────────────────────
  var toggleBtn = null;

  function updateToggleUI() {
    if (!toggleBtn) return;
    var on = isEnabled();
    toggleBtn.textContent = on ? '🔊' : '🔇'; // 🔊 / 🔇
    toggleBtn.setAttribute(
      'aria-label',
      on ? 'Desativar som dos cliques' : 'Ativar som dos cliques'
    );
    toggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    toggleBtn.title = on ? 'Som dos cliques: ligado' : 'Som dos cliques: desligado';
    toggleBtn.style.opacity = on ? '0.55' : '0.9';
  }

  function createToggle() {
    if (toggleBtn || reducedMotion) return; // não cria se o usuário pediu menos movimento
    toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    // Não deve emitir som ao clicar nele próprio.
    toggleBtn.setAttribute('data-click-sound', 'off');
    toggleBtn.style.cssText = [
      'position:fixed',
      'right:16px',
      'top:16px',
      'z-index:2147483000',
      'width:40px',
      'height:40px',
      'border-radius:50%',
      'border:1px solid rgba(255,255,255,0.15)',
      'background:rgba(20,20,25,0.6)',
      'color:#fff',
      'font-size:18px',
      'line-height:1',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
      'transition:opacity .2s, transform .15s',
      'padding:0'
    ].join(';');

    toggleBtn.addEventListener('mouseenter', function () {
      toggleBtn.style.opacity = '1';
      toggleBtn.style.transform = 'scale(1.08)';
    });
    toggleBtn.addEventListener('mouseleave', function () {
      updateToggleUI();
      toggleBtn.style.transform = 'scale(1)';
    });

    toggleBtn.addEventListener('click', function () {
      if (isEnabled()) {
        window.ClickSound.disable();
      } else {
        window.ClickSound.enable();
        ensureContext();
        playClick(); // feedback imediato ao religar
      }
      updateToggleUI();
    });

    document.body.appendChild(toggleBtn);
    updateToggleUI();
  }

  // Botão flutuante removido (agora controlado via settings-drawer)
  // if (document.readyState === 'loading') {
  //   document.addEventListener('DOMContentLoaded', createToggle);
  // } else {
  //   createToggle();
  // }

  // API opcional para controlar por código.
  window.ClickSound = {
    play: playClick,
    enable: function () {
      try { localStorage.setItem('clickSound', 'on'); } catch (e) {}
      updateToggleUI();
    },
    disable: function () {
      try { localStorage.setItem('clickSound', 'off'); } catch (e) {}
      updateToggleUI();
    },
    isEnabled: isEnabled
  };
})();
