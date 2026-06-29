/**
 * direcao-notificacoes.js — v4
 * Mural Escolar — Direção
 */

'use strict';

let comunicados = [];
let imagensSelecionadas = [];
let arquivosSelecionados = [];
let histFiltroAtual = 'todos';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await auth.init();
        if (!auth.isAuthenticated()) { window.location.href = '/login.html'; return; }
        const user = auth.getCurrentUser();
        if (user.perfil !== 'diretor' && user.perfil !== 'admin') { window.location.href = '/dashboard.html'; return; }
        const fotoEl = document.getElementById('userPhotoPreview');
        if (fotoEl) fotoEl.src = window.getPhotoUrl(user.foto, user.fotoGoogle);
        setupEventListeners();
        await carregarListaTurmas();
        await carregarDadosMural();
    } catch (err) {
        console.error('[Mural] Erro na inicialização:', err);
        showToast('Erro ao inicializar a página.', 'error');
    }
});

function setupEventListeners() {
    document.getElementById('btnVoltar')?.addEventListener('click', () => window.location.href = '/direcao/');
    document.getElementById('btnNovaNotificacao')?.addEventListener('click', () => {
        document.getElementById('cardPostar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => document.getElementById('tituloNotif')?.focus(), 400);
    });
    document.getElementById('searchMural')?.addEventListener('input', debounce(carregarDadosMural, 450));
    document.querySelectorAll('.mn-cat-btn[data-cat]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mn-cat-btn[data-cat]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            carregarDadosMural();
        });
    });
    document.querySelectorAll('.mn-cat-btn[data-hist]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mn-cat-btn[data-hist]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            histFiltroAtual = btn.dataset.hist;
            renderHistorico();
        });
    });
    document.getElementById('btnConfigDest')?.addEventListener('click', () => {
        document.getElementById('quickDestSetup')?.classList.toggle('open');
    });
    document.getElementById('inputImagens')?.addEventListener('change', e => handleUpload(e.target.files, 'img'));
    document.getElementById('inputArquivos')?.addEventListener('change', e => handleUpload(e.target.files, 'file'));
    document.getElementById('editorComunicado')?.addEventListener('input', e => {
        const el = document.getElementById('charCount');
        if (el) el.textContent = e.target.innerText.replace(/\n/g, '').length;
    });
    document.getElementById('formNotificacao')?.addEventListener('submit', publicarMural);
    document.getElementById('btnFecharModal')?.addEventListener('click', fecharModal);
    document.getElementById('modalConfirm')?.addEventListener('click', e => {
        if (e.target === document.getElementById('modalConfirm')) fecharModal();
    });
}

async function carregarDadosMural() {
    const busca = document.getElementById('searchMural')?.value?.trim() || '';
    const categoriaBtn = document.querySelector('.mn-cat-btn.active[data-cat]');
    const categoria = categoriaBtn?.dataset?.cat || 'Todos';
    const liveBadge = document.getElementById('liveBadge');
    if (liveBadge) liveBadge.textContent = '● ATUALIZANDO...';
    try {
        const url = new URL(`${window.API_BASE_URL}/comunicados`, window.location.origin);
        if (busca) url.searchParams.append('busca', busca);
        if (categoria !== 'Todos') url.searchParams.append('categoria', categoria);
        const res = await fetch(url.toString(), { credentials: 'include' });
        const json = await res.json();
        if (json.success) {
            comunicados = json.data || [];
            atualizarStats();
            renderHistorico();
            atualizarSidebarResumo();
            const el = document.getElementById('notifCount');
            if (el) el.textContent = `${comunicados.length} aviso${comunicados.length !== 1 ? 's' : ''} ativo${comunicados.length !== 1 ? 's' : ''}`;
            window.dispatchEvent(new CustomEvent('mural:refresh', { detail: { comunicados, busca, categoria } }));
        } else {
            showToast(json.error || 'Erro ao carregar avisos.', 'error');
        }
    } catch (err) {
        console.error('[Mural] Erro ao carregar:', err);
        showToast('Erro de conexão ao carregar o mural.', 'error');
    } finally {
        if (liveBadge) liveBadge.textContent = '● AO VIVO';
    }
}

function atualizarStats() {
    const total = comunicados.length;
    const importantes = comunicados.filter(c => c.prioridade && c.prioridade !== 'Normal').length;
    const user = auth.getCurrentUser();
    const uid = String(user?.id || user?._id || '');
    const lidos = comunicados.filter(c => Array.isArray(c.visualizacoes) && c.visualizacoes.some(v => String(v) === uid)).length;
    animateCount('statsTotal', total);
    animateCount('statsLidos', lidos);
    animateCount('statsImportantes', importantes);
}

function atualizarSidebarResumo() {
    const total = comunicados.length;
    const urgentes = comunicados.filter(c => c.prioridade === 'Urgente').length;
    const umaSemanaAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const semana = comunicados.filter(c => new Date(c.dataCriacao) >= umaSemanaAtras).length;
    const elTotal = document.getElementById('resumoTotal');
    const elUrg = document.getElementById('resumoUrgentes');
    const elSemana = document.getElementById('resumoSemana');
    if (elTotal) elTotal.textContent = total;
    if (elUrg) elUrg.textContent = urgentes;
    if (elSemana) elSemana.textContent = semana;
}

function animateCount(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const from = parseInt(el.textContent) || 0;
    const duration = 700;
    let start = null;
    function step(now) {
        if (!start) start = now;
        const p = Math.min((now - start) / duration, 1);
        el.textContent = Math.floor(from + (target - from) * p);
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function renderHistorico() {
    const tbody = document.getElementById('historico');
    if (!tbody) return;
    let lista = [...comunicados];
    if (histFiltroAtual === 'ativos') lista = lista.filter(c => c.ativo !== false);
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#52525b;padding:2.5rem;">Nenhum aviso encontrado.</td></tr>`;
        return;
    }
    tbody.innerHTML = lista.map(c => {
        const data = new Date(c.dataCriacao).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
        const priorBadge = c.prioridade === 'Urgente' ? '<span class="mn-badge red">🔴 Urgente</span>' : c.prioridade === 'Importante' ? '<span class="mn-badge yellow">🟡 Importante</span>' : '';
        const statusBadge = c.ativo !== false ? '<span class="mn-badge green">Ativo</span>' : '<span class="mn-badge red">Removido</span>';
        const destTags = Array.isArray(c.destinatarios) ? c.destinatarios.map(d => {
            const label = d === 'todos' ? 'Todos' : d === 'professores' ? 'Professores' : d === 'responsaveis' ? 'Responsáveis' : d.startsWith('turma:') ? `T: ${d.replace('turma:', '')}` : d.startsWith('usuario:') ? 'Indiv.' : d;
            return `<span class="mn-dest-tag">${label}</span>`;
        }).join('') : '—';
        return `<tr>
            <td data-label="Título"><div style="font-weight:600;color:#fff;font-size:.88rem;margin-bottom:3px;">${escapeHtml(c.titulo)}</div><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"><span class="mn-badge blue">${c.categoria || 'Geral'}</span>${priorBadge}</div></td>
            <td data-label="Público"><div class="mn-dest-tags">${destTags}</div></td>
            <td data-label="Data" style="color:#71717a;white-space:nowrap;font-size:.82rem;">${data}</td>
            <td data-label="Status" style="text-align:center;">${statusBadge}</td>
            <td data-label="Ações" style="text-align:center;"><div style="display:flex;gap:4px;justify-content:center;">
                <button class="mn-btn-icon view" onclick="verDetalhe('${c._id}')" title="Ver detalhes"><i class="bi bi-eye"></i></button>
                <button class="mn-btn-icon" onclick="excluirComunicado('${c._id}')" title="Remover aviso"><i class="bi bi-trash"></i></button>
            </div></td>
        </tr>`;
    }).join('');
}

window.excluirComunicado = async function(id) {
    if (!confirm('Deseja realmente remover este aviso do mural?')) return;
    try {
        const res = await fetch(`${window.API_BASE_URL}/comunicados/${id}`, { method: 'DELETE', credentials: 'include', headers: getCsrfHeaders() });
        const data = await res.json();
        if (data.success) { showToast('Aviso removido com sucesso!', 'success'); carregarDadosMural(); }
        else showToast(data.error || 'Erro ao remover aviso.', 'error');
    } catch (err) { console.error('[Mural] Erro ao excluir:', err); showToast('Erro de conexão.', 'error'); }
};

window.verDetalhe = function(id) {
    const c = comunicados.find(x => x._id === id);
    if (!c) return;
    const dest = Array.isArray(c.destinatarios) ? c.destinatarios.map(d => d === 'todos' ? 'Todos' : d === 'professores' ? 'Professores' : d === 'responsaveis' ? 'Responsáveis' : d.startsWith('turma:') ? `Turma ${d.replace('turma:', '')}` : d).join(', ') : '—';
    document.getElementById('modalTitle').textContent = c.titulo;
    document.getElementById('confirmText').innerHTML = `<strong style="color:#a1a1aa;">Categoria:</strong> ${c.categoria || '—'}<br><strong style="color:#a1a1aa;">Prioridade:</strong> ${c.prioridade || 'Normal'}<br><strong style="color:#a1a1aa;">Público:</strong> ${dest}<br><strong style="color:#a1a1aa;">Data:</strong> ${new Date(c.dataCriacao).toLocaleString('pt-BR')}<br><br>${c.conteudo || ''}`;
    document.getElementById('btnConfirmarEnvio').style.display = 'none';
    abrirModal();
};

async function publicarMural(e) {
    e.preventDefault();
    const titulo = document.getElementById('tituloNotif').value.trim();
    const conteudo = document.getElementById('editorComunicado').innerHTML.trim();
    const categoria = document.getElementById('categoriaNotif').value;
    const prioridade = document.getElementById('prioridadeNotif').value;
    const dataAgend = document.getElementById('dataAgend')?.value || null;
    if (!titulo) { showToast('Informe o título do aviso.', 'warning'); document.getElementById('tituloNotif').focus(); return; }
    if (!conteudo || document.getElementById('editorComunicado').innerText.trim() === '') { showToast('Escreva o conteúdo do aviso.', 'warning'); document.getElementById('editorComunicado').focus(); return; }
    const destinatarios = [];
    if (document.getElementById('destTodosProfs')?.checked) destinatarios.push('professores');
    if (document.getElementById('destTodosResps')?.checked) destinatarios.push('responsaveis');
    const turma = document.getElementById('selectTurma')?.value;
    if (turma) destinatarios.push(`turma:${turma}`);
    const aluno = document.getElementById('selectAluno')?.value;
    if (aluno) destinatarios.push(`usuario:${aluno}`);
    if (destinatarios.length === 0) destinatarios.push('todos');
    const btn = document.getElementById('btnPublicar');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Publicando...';
    try {
        const res = await fetch(`${window.API_BASE_URL}/comunicados`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() }, body: JSON.stringify({ titulo, conteudo, categoria, prioridade, dataAgendada: dataAgend || null, destinatarios, imagens: imagensSelecionadas, arquivos: arquivosSelecionados }), credentials: 'include' });
        const data = await res.json();
        if (data.success) { showToast('✅ Aviso publicado com sucesso!', 'success'); limparForm(); carregarDadosMural(); }
        else showToast(data.error || 'Erro ao publicar aviso.', 'error');
    } catch (err) { console.error('[Mural] Erro ao publicar:', err); showToast('Erro de conexão ao publicar.', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = originalHTML; }
}

function limparForm() {
    document.getElementById('formNotificacao')?.reset();
    const editor = document.getElementById('editorComunicado');
    if (editor) editor.innerHTML = '';
    const charCount = document.getElementById('charCount');
    if (charCount) charCount.textContent = '0';
    imagensSelecionadas = []; arquivosSelecionados = [];
    renderPreviewImg(); renderPreviewFiles();
    document.getElementById('quickDestSetup')?.classList.remove('open');
}

function handleUpload(files, type) {
    Array.from(files).forEach(file => {
        if (type === 'img') {
            // Comprimir imagem via Canvas antes de converter para base64
            _comprimirImagem(file, 1200, 0.82).then(base64 => {
                imagensSelecionadas.push(base64);
                renderPreviewImg();
            }).catch(() => {
                // Fallback: lê direto sem compressão
                const reader = new FileReader();
                reader.onload = e => { imagensSelecionadas.push(e.target.result); renderPreviewImg(); };
                reader.readAsDataURL(file);
            });
        } else {
            const reader = new FileReader();
            reader.onload = e => {
                arquivosSelecionados.push({ nome: file.name, url: e.target.result, tipo: file.type });
                renderPreviewFiles();
            };
            reader.readAsDataURL(file);
        }
    });
}

/**
 * Converte qualquer imagem para WebP via Canvas API.
 * Redimensiona se necessário e sempre emite WebP (fallback JPEG).
 * @param {File|Blob} file   — arquivo de imagem
 * @param {number}    maxW   — largura máxima em px (mantém proporção)
 * @param {number}    quality — qualidade 0-1
 * @returns {Promise<string>} — data URL WebP (ou JPEG como fallback)
 */
function _comprimirImagem(file, maxW = 1200, quality = 0.82) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) { reject(new Error('Não é imagem')); return; }

        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = (e) => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                let { width, height } = img;
                if (width > maxW) {
                    height = Math.round(height * maxW / width);
                    width = maxW;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);

                // Sempre WebP — fallback para JPEG se o browser não suportar
                const webp = canvas.toDataURL('image/webp', quality);
                resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// Expõe globalmente para reuso em outros módulos
window.converterParaWebP = _comprimirImagem;

function renderPreviewImg() {
    const container = document.getElementById('previewImagens');
    if (!container) return;
    container.innerHTML = imagensSelecionadas.map((src, i) => `<div class="mn-preview-item"><img src="${src}" alt="Preview"><button type="button" onclick="removeImg(${i})" title="Remover">&times;</button></div>`).join('');
}

function renderPreviewFiles() {
    const container = document.getElementById('previewArquivos');
    if (!container) return;
    container.innerHTML = arquivosSelecionados.map((f, i) => `<span class="mn-file-pill"><i class="bi bi-file-earmark-pdf"></i>${escapeHtml(f.nome)}<button type="button" onclick="removeFile(${i})">×</button></span>`).join('');
}

window.removeImg = (i) => { imagensSelecionadas.splice(i, 1); renderPreviewImg(); };
window.removeFile = (i) => { arquivosSelecionados.splice(i, 1); renderPreviewFiles(); };

async function carregarListaTurmas() {
    try {
        const select = document.getElementById('selectTurma');
        if (!select) return;
        try {
            const res = await fetch(`${window.API_BASE_URL}/turmas`, { credentials: 'include' });
            const json = await res.json();
            if (json.success && Array.isArray(json.data) && json.data.length > 0) {
                select.innerHTML = '<option value="">Todas as turmas</option>' + json.data.map(t => `<option value="${t._id || t.nome}">${t.nome || t._id}</option>`).join('');
                return;
            }
        } catch (_) {}
        const turmas = (await db.getAll?.('turmas')) || [];
        select.innerHTML = '<option value="">Todas as turmas</option>' + turmas.map(t => `<option value="${t.nome || t.id}">${t.nome || t.id}</option>`).join('');
    } catch (e) { console.warn('[Mural] Não foi possível carregar turmas:', e); }
}

function abrirModal() { document.getElementById('modalConfirm')?.classList.add('open'); document.body.style.overflow = 'hidden'; }
function fecharModal() { document.getElementById('modalConfirm')?.classList.remove('open'); document.body.style.overflow = ''; }

window.formatDoc = (cmd, val) => { document.execCommand(cmd, false, val); document.getElementById('editorComunicado')?.focus(); };
window.inserirEmoji = (emoji) => { document.execCommand('insertText', false, emoji); document.getElementById('editorComunicado')?.focus(); };

function showToast(msg, type = 'info') {
    document.querySelectorAll('.mn-toast').forEach(t => t.remove());
    const icon = type === 'success' ? 'bi-check-circle-fill' : type === 'error' ? 'bi-x-circle-fill' : type === 'warning' ? 'bi-exclamation-triangle-fill' : 'bi-info-circle-fill';
    const toast = document.createElement('div');
    toast.className = `mn-toast ${type}`;
    toast.innerHTML = `<i class="bi ${icon}"></i> <span>${msg}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 450); }, 3200);
}
window.showToast = showToast;

function debounce(fn, ms) { let t; return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); }; }
function escapeHtml(str) { if (!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function getCsrfHeaders() { const m = document.cookie.match(/csrf_token=([^;]+)/); return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {}; }
