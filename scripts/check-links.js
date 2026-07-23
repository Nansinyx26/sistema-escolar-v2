/**
 * Varre HTML/JS do projeto procurando alvos de navegação .html
 * (href=, window.location.href=, data-href=) e verifica se o arquivo
 * existe no disco, simulando a resolução de URL do servidor
 * (paths que sobem acima da raiz são "clampados" na raiz, como o browser faz).
 *
 * Para arquivos JS, os alvos relativos são resolvidos contra o diretório de
 * CADA página HTML que inclui o script (via <script src>), pois é esse o
 * contexto de URL em tempo de execução.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
if (!ROOT) { console.error('uso: node check-links.js <raiz>'); process.exit(1); }

const SCAN_DIRS = ['html', 'direcao', 'detalhes', 'graficos', 'js'];
const SCAN_ROOT_FILES = ['index.html'];

let htmlFiles = [], jsFiles = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); }
    else if (e.name.endsWith('.html')) htmlFiles.push(full);
    else if (e.name.endsWith('.js')) jsFiles.push(full);
  }
}
SCAN_DIRS.forEach(d => { const p = path.join(ROOT, d); if (fs.existsSync(p)) walk(p); });
SCAN_ROOT_FILES.forEach(f => { const p = path.join(ROOT, f); if (fs.existsSync(p)) htmlFiles.push(p); });

const patterns = [
  /href="([^"#?]+\.html)[^"]*"/g,
  /location\.href\s*=\s*['"`]([^'"`#?$]+\.html)[^'"`]*['"`]/g,
  /location\.replace\(\s*['"`]([^'"`#?$]+\.html)[^'"`]*['"`]/g,
  /data-href="([^"#?]+\.html)[^"]*"/g,
  /window\.open\(\s*['"`]([^'"`#?$]+\.html)[^'"`]*['"`]/g,
];

// Resolve como o browser: caminho absoluto do site, ou relativo com clamp na raiz
function resolveFromUrlDir(urlDir, target) {
  if (/^https?:|^mailto:|\$\{/.test(target)) return null;
  if (target.startsWith('/')) return path.join(ROOT, target);
  const stack = urlDir.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') stack.pop(); else stack.push(seg);
  }
  return path.join(ROOT, ...stack);
}
const urlDirOf = (file) => '/' + path.relative(ROOT, path.dirname(file)).replace(/\\/g, '/');

// Mapa: js file -> conjunto de urlDirs das páginas que o incluem
const jsIncludedFrom = new Map();
for (const hf of htmlFiles) {
  const content = fs.readFileSync(hf, 'utf8');
  const re = /<script[^>]+src="([^"]+\.js)[^"]*"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const resolved = resolveFromUrlDir(urlDirOf(hf), m[1]);
    if (!resolved) continue;
    const key = path.normalize(resolved);
    if (!jsIncludedFrom.has(key)) jsIncludedFrom.set(key, new Set());
    jsIncludedFrom.get(key).add(urlDirOf(hf));
  }
}

function extractTargets(content) {
  const out = [];
  for (const pat of patterns) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(content)) !== null) {
      out.push({ target: m[1], index: m.index });
    }
  }
  return out;
}

let broken = [];
// HTML: resolve contra o próprio diretório
for (const file of htmlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const { target, index } of extractTargets(content)) {
    const resolved = resolveFromUrlDir(urlDirOf(file), target);
    if (resolved && !fs.existsSync(resolved)) {
      const lineNo = content.slice(0, index).split('\n').length;
      broken.push({ source: path.relative(ROOT, file).replace(/\\/g, '/') + ':' + lineNo, target, ctx: '(própria página)' });
    }
  }
}
// JS: resolve contra cada página que o inclui; só reporta se quebra em TODAS
for (const file of jsFiles) {
  const key = path.normalize(file);
  const contexts = jsIncludedFrom.get(key);
  if (!contexts || contexts.size === 0) continue; // JS órfão — fora de escopo aqui
  const content = fs.readFileSync(file, 'utf8');
  for (const { target, index } of extractTargets(content)) {
    const failures = [];
    for (const ctxDir of contexts) {
      const resolved = resolveFromUrlDir(ctxDir, target);
      if (resolved && !fs.existsSync(resolved)) failures.push(ctxDir);
    }
    if (failures.length === contexts.size && failures.length > 0) {
      const lineNo = content.slice(0, index).split('\n').length;
      broken.push({ source: path.relative(ROOT, file).replace(/\\/g, '/') + ':' + lineNo, target, ctx: 'incluído por páginas em: ' + [...contexts].join(', ') });
    }
  }
}

if (broken.length === 0) {
  console.log('OK — nenhum link .html quebrado encontrado.');
} else {
  console.log(`${broken.length} link(s) quebrado(s):\n`);
  for (const b of broken) console.log(`  ${b.source}\n    -> "${b.target}"  ${b.ctx}\n`);
  process.exitCode = 1;
}
