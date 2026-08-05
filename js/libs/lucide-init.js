/**
 * Lucide init + shim de compatibilidade Bootstrap Icons -> Lucide.
 *
 * Padroniza os ícones do sistema legado (HTML) na mesma família usada pelo
 * Portal do Responsável (lucide-react), SEM precisar reescrever as ~919 tags
 * `<i class="bi bi-*">` de uma vez.
 *
 * Como funciona:
 *   1. Percorre todo `<i class="bi bi-*">` da página.
 *   2. Se o ícone tiver correspondente no mapa BI_TO_LUCIDE, seta `data-lucide`
 *      e deixa o Lucide substituir por um <svg> line-icon.
 *   3. Ícones sem mapa permanecem como Bootstrap Icons (fallback) — nada quebra.
 *   4. Também renderiza qualquer elemento novo escrito direto como
 *      `<i data-lucide="nome">`.
 *
 * Uso na página (após bootstrap-icons.min.css e antes de </body>):
 *   <script src="../js/libs/lucide.min.js"></script>
 *   <script src="../js/libs/lucide-init.js"></script>
 */
(function () {
  'use strict';

  // Bootstrap Icons -> nome Lucide (v0.469). Ícones de marca sem equivalente
  // (ex.: google) e numerados (1-circle) ficam de fora e mantêm o Bootstrap.
  var BI_TO_LUCIDE = {
    'mortarboard-fill': 'graduation-cap', 'mortarboard': 'graduation-cap',
    'arrow-left': 'arrow-left', 'arrow-right': 'arrow-right',
    'arrow-right-short': 'arrow-right', 'arrow-left-right': 'arrow-left-right',
    'arrow-repeat': 'refresh-cw', 'arrow-clockwise': 'rotate-cw',
    'arrow-counterclockwise': 'rotate-ccw',
    'arrow-right-circle-fill': 'circle-arrow-right',
    'arrow-left-circle': 'circle-arrow-left',
    'check-circle-fill': 'circle-check', 'check-circle': 'circle-check',
    'check-lg': 'check', 'check': 'check', 'check-all': 'check-check',
    'check2-all': 'check-check',
    'circle': 'circle', 'x': 'x', 'x-lg': 'x', 'x-circle': 'circle-x',
    'lock-fill': 'lock', 'lock': 'lock',
    'shield-check': 'shield-check', 'shield-lock': 'shield',
    'shield-lock-fill': 'shield', 'shield-shaded': 'shield',
    'shield-fill': 'shield',
    'eye': 'eye', 'eye-fill': 'eye', 'eye-slash': 'eye-off',
    'envelope': 'mail', 'envelope-at-fill': 'mail',
    'person': 'user', 'person-fill': 'user', 'person-circle': 'circle-user',
    'person-badge': 'id-card', 'person-badge-fill': 'id-card',
    'person-plus': 'user-plus', 'person-plus-fill': 'user-plus',
    'person-check-fill': 'user-check', 'person-x': 'user-x',
    'person-x-fill': 'user-x', 'person-gear': 'user-cog',
    'person-vcard': 'contact-round', 'person-lines-fill': 'contact-round',
    'person-workspace': 'presentation', 'person-standing': 'person-standing',
    'people': 'users', 'people-fill': 'users',
    'key-fill': 'key', 'key': 'key',
    'building': 'building-2', 'building-fill': 'building-2',
    'building-lock': 'building-2', 'building-gear': 'building-2',
    'laptop': 'laptop', 'search': 'search', 'briefcase': 'briefcase',
    'briefcase-fill': 'briefcase', 'book': 'book', 'book-fill': 'book',
    'book-half': 'book-open', 'download': 'download', 'upload': 'upload',
    'megaphone': 'megaphone', 'megaphone-fill': 'megaphone',
    'clock-history': 'history', 'clock': 'clock', 'clock-fill': 'clock',
    'calendar3': 'calendar', 'calendar-week': 'calendar-days',
    'calendar-week-fill': 'calendar-days', 'calendar-check': 'calendar-check',
    'calendar-check-fill': 'calendar-check', 'calendar-range': 'calendar-range',
    'calendar-x': 'calendar-x',
    'trash': 'trash-2', 'trash-fill': 'trash-2', 'trash3': 'trash-2',
    'star': 'star', 'star-fill': 'star', 'send': 'send', 'send-fill': 'send',
    'send-check': 'send', 'file-earmark-text': 'file-text',
    'file-earmark-text-fill': 'file-text', 'file-text': 'file-text',
    'file-text-fill': 'file-text', 'file-pdf-fill': 'file-text',
    'file-earmark-pdf': 'file-text', 'file-word-fill': 'file-text',
    'file-earmark-word-fill': 'file-text', 'file-earmark-excel': 'file-spreadsheet',
    'filetype-csv': 'file-spreadsheet', 'file-earmark-plus': 'file-plus',
    'file-earmark-check': 'file-check', 'file-earmark-arrow-up': 'file-up',
    'file-earmark': 'file',
    'bar-chart-fill': 'bar-chart-3', 'bar-chart-line': 'bar-chart-3',
    'save': 'save', 'floppy-fill': 'save', 'phone': 'phone',
    'telephone': 'phone', 'hourglass-split': 'hourglass',
    'grid-1x2-fill': 'layout-dashboard', 'grid-3x3-gap-fill': 'layout-grid',
    'chevron-right': 'chevron-right', 'chevron-left': 'chevron-left',
    'caret-up-fill': 'chevron-up', 'card-checklist': 'clipboard-list',
    'box-arrow-in-right': 'log-in', 'box-arrow-right': 'log-out',
    'box-arrow-left': 'log-out', 'robot': 'bot', 'plus-lg': 'plus',
    'plus-circle': 'circle-plus', 'journal-text': 'notebook-text',
    'journal-bookmark-fill': 'book-marked', 'journal-check': 'book-check',
    'info-circle': 'info', 'info-circle-fill': 'info',
    'graph-up-arrow': 'trending-up', 'graph-up': 'trending-up',
    'gear-fill': 'settings', 'gear': 'settings', 'cloud-upload': 'cloud-upload',
    'cloud-upload-fill': 'cloud-upload', 'cloud-download': 'cloud-download',
    'cloud-check': 'cloud', 'clipboard-check': 'clipboard-check',
    'clipboard-check-fill': 'clipboard-check', 'clipboard': 'clipboard',
    'clipboard2-data': 'clipboard-list', 'clipboard-data-fill': 'clipboard-list',
    'camera': 'camera', 'list': 'list', 'list-ul': 'list',
    'house-heart': 'house', 'house-fill': 'house',
    'exclamation-triangle': 'triangle-alert',
    'exclamation-triangle-fill': 'triangle-alert',
    'exclamation-circle': 'circle-alert', 'exclamation-circle-fill': 'circle-alert',
    'door-open-fill': 'door-open', 'door-open': 'door-open',
    'door-closed': 'door-closed', 'volume-up-fill': 'volume-2',
    'volume-up': 'volume-2', 'volume-mute': 'volume-x', 'trophy': 'trophy',
    'tools': 'wrench', 'terminal-fill': 'terminal', 'table': 'table',
    'speedometer': 'gauge', 'speedometer2': 'gauge', 'printer': 'printer',
    'palette': 'palette', 'lightning-charge-fill': 'zap',
    'lightning-fill': 'zap', 'lightbulb-fill': 'lightbulb', 'cpu': 'cpu',
    'bell-fill': 'bell', 'bell': 'bell', 'activity': 'activity',
    'type-underline': 'underline', 'type-italic': 'italic', 'type-bold': 'bold',
    'translate': 'languages', 'stars': 'sparkles', 'soundwave': 'audio-lines',
    'share-fill': 'share-2', 'question-circle': 'circle-help',
    'play-fill': 'play', 'play-circle-fill': 'circle-play',
    'pie-chart-fill': 'pie-chart', 'pencil-square': 'square-pen',
    'pencil-fill': 'pencil', 'patch-question': 'badge-help',
    'patch-check': 'badge-check', 'paperclip': 'paperclip',
    'newspaper': 'newspaper', 'mic-fill': 'mic', 'linkedin': 'linkedin',
    'instagram': 'instagram', 'github': 'github', 'inbox': 'inbox',
    'heart-pulse-fill': 'heart-pulse', 'hand-index': 'hand',
    'globe': 'globe', 'geo-alt-fill': 'map-pin', 'folder2-open': 'folder-open',
    'folder-fill': 'folder', 'flask': 'flask-conical', 'chat-dots': 'message-circle',
    'card-text': 'file-text', 'calculator-fill': 'calculator',
    'bullseye': 'target', 'broom': 'brush', 'collection-fill': 'layers'
  };

  function upgradeBootstrapIcons(root) {
    var scope = root || document;
    var els = scope.querySelectorAll('i.bi, span.bi');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute('data-lucide')) continue;
      var name = null;
      for (var c = 0; c < el.classList.length; c++) {
        var cls = el.classList[c];
        if (cls.indexOf('bi-') === 0) { name = cls.slice(3); break; }
      }
      if (name && BI_TO_LUCIDE[name]) {
        el.setAttribute('data-lucide', BI_TO_LUCIDE[name]);
        // Marca para estilo, preserva as demais classes (sizing/cor do sistema).
        el.classList.add('lucide-icon');
      }
    }
  }

  function render() {
    if (typeof window.lucide === 'undefined' || !window.lucide.createIcons) return;
    upgradeBootstrapIcons(document);
    window.lucide.createIcons({
      attrs: { width: '1em', height: '1em', 'stroke-width': 1.75 }
    });
  }

  // Estilo mínimo para casar métrica do line-icon com a fonte de ícones.
  var style = document.createElement('style');
  style.textContent =
    '.lucide{vertical-align:-0.125em;display:inline-block}' +
    'svg.lucide{width:1em;height:1em}';
  document.head.appendChild(style);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  // Reexpõe para conteúdo injetado dinamicamente (modais, listas, etc.).
  window.renderLucideIcons = render;
})();
