/**
 * Cadastro de Aluno — LGPD Compliant
 * Integração com /api/alunos + log de auditoria em tempo real
 */

const _debounce = {};
let _auditCount = 0;
let _docs = [];

// ─── Inicialização ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    addAudit('abertura', 'Formulário', 'aberto', 'audit-action-open');
    carregarTurmas();
    updateProgress();
});

// ─── Carrega turmas do backend ────────────────────────────────────────────────

async function carregarTurmas() {
    try {
        const sel = document.getElementById('turmaId');
        const data = await apiFetch('/turmas');
        if (data.success && data.data) {
            data.data
                .sort((a, b) => (a.id || a._id).localeCompare(b.id || b._id))
                .forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t._id || t.id;
                    opt.textContent = `${t.id || t._id} — ${t.periodo || ''}`.trim().replace(/\s*—\s*$/, '');
                    sel.appendChild(opt);
                });
        }
    } catch (e) {
        console.warn('Erro ao carregar turmas:', e);
    }
}

// ─── Progresso ────────────────────────────────────────────────────────────────

function updateProgress() {
    const allConsents = ['c1','c2','c3','c4'].every(id => document.getElementById(id)?.checked);
    const steps = [
        isStep1Done(),
        isStep2Done(),
        isStep3Done(),
        isStep4Done(),
        allConsents
    ];

    const done = steps.filter(Boolean).length;
    const pct = Math.round((done / 5) * 100);

    document.getElementById('caProgressBar').style.width = pct + '%';

    steps.forEach((ok, i) => {
        const el = document.getElementById(`step${i + 1}`);
        if (!el) return;
        el.classList.remove('active', 'done');
        if (ok) {
            el.classList.add('done');
        } else {
            // Primeiro não-done é o ativo
            const hasActive = document.querySelector('.ca-step.active');
            if (!hasActive) el.classList.add('active');
        }
    });

    // Garante pelo menos um ativo
    if (!document.querySelector('.ca-step.active') && !document.querySelector('.ca-step:not(.done)')) {
        document.getElementById('step1').classList.add('active');
    }
}

function isStep1Done() {
    return !!(v('nome') && v('nascimento') && v('turmaId'));
}
function isStep2Done() {
    return !!(v('cep') && v('logradouro') && v('cidade'));
}
function isStep3Done() {
    return !!(v('respNome') && v('respCPF') && v('respTelefone'));
}
function isStep4Done() {
    return true; // campos opcionais
}

function v(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

// ─── Edição de campos → log de auditoria ─────────────────────────────────────

function onFieldEdit(section, field) {
    const key = section + '.' + field;
    clearTimeout(_debounce[key]);
    _debounce[key] = setTimeout(() => {
        addAudit('edição', section, field, 'audit-action-edit');
        updateProgress();
    }, 900);
}

// ─── Consentimento ────────────────────────────────────────────────────────────

function toggleConsent(checkId, itemId) {
    const cb = document.getElementById(checkId);
    const item = document.getElementById(itemId);
    if (!cb || !item) return;
    cb.checked = !cb.checked;
    item.classList.toggle('checked', cb.checked);
    const label = cb.checked ? 'aceito' : 'revogado';
    addAudit(`consentimento ${label}`, 'consentimento', checkId, 'audit-action-consent');
    checkConsents();
    updateProgress();
}

function checkConsents() {
    const allOk = ['c1','c2','c3','c4'].every(id => document.getElementById(id)?.checked);
    document.getElementById('btnSave').disabled = !allOk;
    updateProgress();
}

// ─── Toggle PCD ───────────────────────────────────────────────────────────────

function togglePcd(val) {
    const sec = document.getElementById('pcdTipoSection');
    sec.classList.toggle('visible', val === 'Sim');
    if (val !== 'Sim') document.getElementById('pcdTipo').value = '';
}

// ─── Documentos ───────────────────────────────────────────────────────────────

function addDocs(files) {
    const list = document.getElementById('docList');
    Array.from(files).forEach(file => {
        if (file.size > 10 * 1024 * 1024) {
            showToast(`Arquivo "${file.name}" excede 10 MB e foi ignorado.`, 'error');
            return;
        }
        const id = Date.now() + '_' + Math.random().toString(36).slice(2);
        _docs.push({ id, file });

        const item = document.createElement('div');
        item.className = 'doc-item';
        item.id = 'doc_' + id;
        item.innerHTML = `
            <i class="bi bi-file-earmark-text"></i>
            <span class="doc-item-name">${file.name}</span>
            <span class="doc-item-size">${(file.size / 1024).toFixed(0)} KB</span>
            <button class="doc-item-remove" onclick="removeDoc('${id}')" title="Remover">
                <i class="bi bi-x"></i>
            </button>`;
        list.appendChild(item);

        addAudit('documento adicionado', 'documentos', file.name, 'audit-action-edit');
    });
    // Reset input para permitir re-seleção do mesmo arquivo
    document.getElementById('docInput').value = '';
}

function removeDoc(id) {
    _docs = _docs.filter(d => d.id !== id);
    const el = document.getElementById('doc_' + id);
    if (el) el.remove();
    addAudit('documento removido', 'documentos', id, 'audit-action-edit');
}

// ─── Pessoas autorizadas a retirar ───────────────────────────────────────────

let _pessoasAutorizadas = [];

function addPessoaAutorizada(data = {}) {
    const idx = _pessoasAutorizadas.length;
    _pessoasAutorizadas.push({ nome: data.nome || '', parentesco: data.parentesco || '', telefone: data.telefone || '', documento: data.documento || '' });
    renderPessoasAutorizadas();
}

function removePessoaAutorizada(idx) {
    _pessoasAutorizadas.splice(idx, 1);
    renderPessoasAutorizadas();
}

function renderPessoasAutorizadas() {
    const container = document.getElementById('listaAutorizadosRetirada');
    if (!container) return;
    container.innerHTML = _pessoasAutorizadas.map((p, i) => `
        <div class="ca-grid ca-grid-4" style="margin-bottom:.5rem;align-items:end">
            <div class="ca-field"><label>Nome</label>
                <input type="text" value="${p.nome}" onchange="_pessoasAutorizadas[${i}].nome=this.value"></div>
            <div class="ca-field"><label>Parentesco</label>
                <input type="text" value="${p.parentesco}" onchange="_pessoasAutorizadas[${i}].parentesco=this.value"></div>
            <div class="ca-field"><label>Telefone</label>
                <input type="tel" value="${p.telefone}" oninput="maskTel(this);_pessoasAutorizadas[${i}].telefone=this.value"></div>
            <div class="ca-field"><label>Documento</label>
                <div style="display:flex;gap:.5rem">
                    <input type="text" value="${p.documento}" onchange="_pessoasAutorizadas[${i}].documento=this.value" style="flex:1">
                    <button type="button" class="doc-item-remove" onclick="removePessoaAutorizada(${i})"><i class="bi bi-x"></i></button>
                </div></div>
        </div>`).join('');
}

function toggleConducaoFields() {
    const show = v('authConducao') === 'sim';
    document.getElementById('conducaoFields').style.display = show ? 'grid' : 'none';
}

function toggleAntitermicoFields() {
    const show = v('authAntitermico') === 'sim';
    document.getElementById('antitermicoFields').style.display = show ? 'grid' : 'none';
}

function authToBool(val) {
    if (val === 'sim') return true;
    if (val === 'nao') return false;
    return null;
}

async function uploadDocumentos(alunoId) {
    if (_docs.length === 0) return;
    const formData = new FormData();
    _docs.forEach(d => formData.append('documentos', d.file));
    const token = localStorage.getItem('token') || '';
    const apiBase = (window.API_BASE_URL || '/api').replace(/\/$/, '');
    const res = await fetch(`${apiBase}/upload/documento`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
        body: formData
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Erro no upload de documentos');
    await apiFetch(`/responsavel/aluno/${alunoId}/documentos`, {
        method: 'POST',
        body: JSON.stringify({ arquivos: json.data })
    });
}

function buildResponsaveis() {
    const resp1 = {
        nome: v('respNome'),
        tipo: v('respParentesco'),
        parentesco: v('respParentesco'),
        cpf: v('respCPF'),
        telefone: v('respTelefone'),
        whatsapp: v('respWhatsapp') || v('respTelefone'),
        email: v('respEmail'),
        responsabilidadeFinanceira: v('respFinanceiro') || 'Não',
        autorizadoBusca: v('respBusca') === 'Sim'
    };
    const responsaveis = [resp1];
    if (v('resp2Nome')) {
        responsaveis.push({
            nome: v('resp2Nome'),
            tipo: v('resp2Tipo') || 'Responsável Legal',
            parentesco: v('resp2Tipo'),
            cpf: v('resp2CPF'),
            telefone: v('resp2Telefone'),
            whatsapp: v('resp2Whatsapp') || v('resp2Telefone'),
            email: v('resp2Email'),
            responsabilidadeFinanceira: v('resp2Financeiro') || 'Não',
            autorizadoBusca: true
        });
    }
    return responsaveis;
}

function buildAutorizacoes() {
    return {
        tratamentoOdontologico: authToBool(v('authOdontologico')),
        tratamentoMedicoEmergencial: authToBool(v('authMedico')),
        testagemAcuidade: authToBool(v('authAcuidade')),
        atividadesFisicas: authToBool(v('authAtivFisicas')),
        atividadesExtraclasse: authToBool(v('authExtraclasse')),
        conducaoEscolar: authToBool(v('authConducao')),
        motoristaNome: v('authConducao') === 'sim' ? v('motoristaNome') : undefined,
        motoristaTelefone: v('authConducao') === 'sim' ? v('motoristaTelefone') : undefined,
        antitermico: authToBool(v('authAntitermico')),
        medicamentoNome: v('authAntitermico') === 'sim' ? v('medicamentoNome') : undefined,
        medicamentoDose: v('authAntitermico') === 'sim' ? v('medicamentoDose') : undefined
    };
}

// ─── Salvar ───────────────────────────────────────────────────────────────────

async function salvarAluno() {
    const btn = document.getElementById('btnSave');

    // Validação básica
    if (!v('nome') || !v('nascimento') || !v('turmaId')) {
        showToast('Preencha nome, nascimento e turma (obrigatórios).', 'error');
        return;
    }
    if (!v('respNome') || !v('respCPF') || !v('respTelefone')) {
        showToast('Preencha os dados obrigatórios do responsável.', 'error');
        return;
    }

    const payload = {
        nome: v('nome'),
        nascimento: v('nascimento'),
        turmaId: v('turmaId'),
        nivel: v('nivel') || undefined,
        cpfAluno: v('cpfAluno') || undefined,
        nacionalidade: v('nacionalidade') || undefined,
        etnia: v('etnia') || undefined,
        religiao: v('religiao') || undefined,

        endereco: {
            cep: v('cep'),
            logradouro: v('logradouro'),
            numero: v('numero'),
            complemento: v('complemento'),
            bairro: v('bairro'),
            cidade: v('cidade'),
            estado: v('estado')
        },

        responsavel: v('respEmail') || v('respNome'),
        responsavelDados: {
            nome: v('respNome'),
            parentesco: v('respParentesco'),
            cpf: v('respCPF'),
            telefone: v('respTelefone'),
            whatsapp: v('respWhatsapp') || v('respTelefone'),
            email: v('respEmail'),
            responsabilidadeFinanceira: v('respFinanceiro') || 'Não',
            autorizadoBusca: v('respBusca') === 'Sim'
        },
        responsaveis: buildResponsaveis(),
        guardaLegal: v('guardaLegal') || undefined,
        pessoasAutorizadasRetirada: _pessoasAutorizadas.filter(p => p.nome),
        autorizacoesEscolares: buildAutorizacoes(),
        fichaDocumentoStatus: _docs.length > 0 ? 'enviado' : 'pendente',

        deficiencia: v('pcd') === 'Sim' ? (v('pcdTipo') || 'Não especificada') : undefined,
        pcd: v('pcd') === 'Sim',
        alergiasAlimentos: v('alergiasAlimentos') || undefined,
        alergiasRemedio: v('alergiasRemedio') || undefined,
        planoSaude: v('planoSaude') || undefined,
        condicao: v('condicao') || undefined,
        observacoes: v('observacoes') || undefined,

        lgpdConsentimento: {
            dadosMenor: document.getElementById('c1').checked,
            dadosSensiveis: document.getElementById('c2').checked,
            comunicacoes: document.getElementById('c3').checked,
            politicaPrivacidade: document.getElementById('c4').checked,
            dataConsentimento: new Date().toISOString()
        },

        ativo: true,
        criadoEm: new Date().toISOString()
    };

    // Remove campos undefined
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';

    try {
        addAudit('tentativa de envio', 'formulário', 'POST /api/alunos', 'audit-action-nav');

        const result = await apiFetch('/alunos', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (result.success) {
            const alunoId = result.data?._id || result.data?.id;
            const ra = result.data?.matricula || alunoId || '—';
            if (result.data?.matricula) {
                document.getElementById('matricula').value = result.data.matricula;
            }
            if (_docs.length > 0 && alunoId) {
                try {
                    await uploadDocumentos(alunoId);
                } catch (uploadErr) {
                    showToast('Aluno salvo, mas erro no upload: ' + uploadErr.message, 'error');
                }
            }
            addAudit('cadastro salvo', 'formulário', `RA: ${ra}`, 'audit-action-consent');
            showToast(`Aluno cadastrado com sucesso! RA: ${ra}`, 'success');
            btn.innerHTML = '<i class="bi bi-check-lg"></i> Cadastrado!';
            setTimeout(() => window.history.back(), 2500);
        } else {
            throw new Error(result.error || 'Erro ao salvar');
        }
    } catch (err) {
        console.error('Erro ao salvar aluno:', err);
        addAudit('erro no envio', 'formulário', err.message, 'audit-action-edit');
        showToast('Erro ao salvar: ' + err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg"></i> Salvar Cadastro';
        checkConsents(); // Reabilita se consentimentos OK
    }
}

// ─── Log de Auditoria ─────────────────────────────────────────────────────────

function addAudit(acao, secao, campo, cssClass) {
    _auditCount++;
    document.getElementById('auditCount').textContent = `${_auditCount} registro${_auditCount !== 1 ? 's' : ''}`;

    const tbody = document.getElementById('auditBody');
    const row = document.createElement('tr');
    row.className = 'audit-new';

    const now = new Date();
    const hora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const ip = '189.44.xx.xx'; // Mascarado por privacidade

    row.innerHTML = `
        <td>${hora}</td>
        <td class="${cssClass || ''}">${acao}</td>
        <td>${secao} › ${campo}</td>
        <td>${ip}</td>
    `;

    tbody.insertBefore(row, tbody.firstChild);

    // Mantém no máximo 100 linhas
    while (tbody.children.length > 100) {
        tbody.removeChild(tbody.lastChild);
    }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let _toastTimer;
function showToast(msg, type = 'info') {
    const toast = document.getElementById('caToast');
    const icon = document.getElementById('caToastIcon');
    const msgEl = document.getElementById('caToastMsg');

    const icons = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', info: 'bi-info-circle-fill' };
    icon.className = `bi ${icons[type] || icons.info}`;
    msgEl.textContent = msg;
    toast.className = `ca-toast ${type} show`;

    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

// ─── Máscaras ─────────────────────────────────────────────────────────────────

function maskCPF(input) {
    let v = input.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d+)/, '$1.$2.$3');
    else if (v.length > 3) v = v.replace(/(\d{3})(\d+)/, '$1.$2');
    input.value = v;
}

function maskTel(input) {
    let v = input.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 10) v = v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    else if (v.length > 6) v = v.replace(/(\d{2})(\d{4})(\d+)/, '($1) $2-$3');
    else if (v.length > 2) v = v.replace(/(\d{2})(\d+)/, '($1) $2');
    input.value = v;
}

function maskCEP(input) {
    let v = input.value.replace(/\D/g, '').slice(0, 8);
    if (v.length > 5) v = v.replace(/(\d{5})(\d+)/, '$1-$2');
    input.value = v;
}

// ─── Busca CEP via ViaCEP ─────────────────────────────────────────────────────

async function buscarCEP(cep) {
    const clean = cep.replace(/\D/g, '');
    if (clean.length !== 8) return;
    try {
        const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
        const d = await res.json();
        if (d.erro) return;
        document.getElementById('logradouro').value = d.logradouro || '';
        document.getElementById('bairro').value = d.bairro || '';
        document.getElementById('cidade').value = d.localidade || '';
        document.getElementById('estado').value = d.uf || '';
        addAudit('CEP preenchido automaticamente', 'endereco', d.localidade || '', 'audit-action-nav');
        updateProgress();
    } catch (e) {
        // ViaCEP indisponível — usuário preenche manualmente
    }
}
