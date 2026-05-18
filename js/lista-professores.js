/**
 * Lista de Professores Script
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Inicializa o banco e autenticação
    const connected = await db.init();
    if (!connected) {
        console.error('Falha ao conectar ao banco de dados no init');
    }
    await auth.init();

    // Verifica autenticação
    if (!auth.isAuthenticated()) {
        window.location.href = 'index.html';
        return;
    }

    const user = auth.getCurrentUser();
    // Apenas Diretor e Admin podem acessar
    if (user.perfil !== 'diretor' && user.perfil !== 'admin') {
        window.location.href = 'dashboard.html';
        return;
    }

    // Carregar dados iniciais do banco
    await carregarDados();
});

// === CARREGAR DADOS ===
async function carregarDados() {
    try {
        console.log('📥 Chamando API para carregar dados...');
        const url = `${db.baseUrl}/atribuicoes`;
        console.log(`🔗 URL: ${url}`);

        const response = await fetch(url);
        const text = await response.text();

        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            console.error('Resposta inválida (não JSON):', text);
            throw new Error('O servidor retornou uma resposta inválida. Verifique se o backend está rodando na porta 3001.');
        }

        if (!response.ok || !json.success) {
            throw new Error(json.error || 'Erro ao buscar dados do servidor');
        }

        renderizarTabela(json.data);
    } catch (error) {
        console.error('Erro ao carregar atribuições:', error);
        showToast(`Erro ao carregar: ${error.message}`, 'error');
    }
}

function renderizarTabela(atribuicoes) {
    const tbody = document.querySelector('#tabelaProfessores tbody');
    tbody.innerHTML = '';

    if (!atribuicoes || atribuicoes.length === 0) {
        adicionarProfessor(); // Adiciona uma linha vazia se não houver nada
        return;
    }

    atribuicoes.forEach(atrib => {
        const novaLinha = document.createElement('tr');
        if (atrib._id) novaLinha.dataset.id = atrib._id;

        novaLinha.innerHTML = `
            <td><input type="text" value="${atrib.nome || ''}" placeholder="Nome do professor"></td>
            <td><input type="text" value="${atrib.classe || ''}" placeholder="Classe"></td>
            <td><input type="number" value="${atrib.pontuacao || ''}" placeholder="Pontuação"></td>
            <td><input type="text" value="${atrib.serieTurma || ''}" placeholder="Série/Turma"></td>
            <td><input type="number" value="${atrib.ha || '04'}" placeholder="H.A"></td>
            <td><input type="number" value="${atrib.rp || '04'}" placeholder="R.P"></td>
            <td><input type="number" value="${atrib.estudoL || '03'}" placeholder="Estudo L"></td>
            <td><input type="number" value="${atrib.estudoEsc || '02'}" placeholder="Estudo Esc."></td>
            <td><input type="text" value="${atrib.cargaHoraria || '40h'}" placeholder="Carga"></td>
            <td><input type="text" value="${atrib.observacoes || ''}" placeholder="Observações"></td>
            <td class="col-assinatura">_____________________</td>
            <td><button class="btn btn-delete btn-sm" onclick="removerLinha(this)"><i class="bi bi-trash"></i></button></td>
        `;
        tbody.appendChild(novaLinha);
    });
}

function adicionarProfessor() {
    const tbody = document.querySelector('#tabelaProfessores tbody');
    const novaLinha = document.createElement('tr');

    novaLinha.innerHTML = `
        <td><input type="text" placeholder="Nome do professor"></td>
        <td><input type="text" placeholder="Classe"></td>
        <td><input type="number" placeholder="Pontuação"></td>
        <td><input type="text" placeholder="Série/Turma"></td>
        <td><input type="number" placeholder="H.A" value="04"></td>
        <td><input type="number" placeholder="R.P" value="04"></td>
        <td><input type="number" placeholder="Estudo L" value="03"></td>
        <td><input type="number" placeholder="Estudo Esc." value="02"></td>
        <td><input type="text" placeholder="Carga" value="40h"></td>
        <td><input type="text" placeholder="Observações"></td>
        <td class="col-assinatura">_____________________</td>
        <td><button class="btn btn-delete btn-sm" onclick="removerLinha(this)"><i class="bi bi-trash"></i></button></td>
    `;

    tbody.appendChild(novaLinha);
    novaLinha.querySelector('input').focus();
}

async function removerLinha(botao) {
    const linha = botao.closest('tr');
    const id = linha.dataset.id;

    if (confirm('Deseja realmente remover este professor?')) {
        if (id) {
            try {
                const url = `${db.baseUrl}/atribuicoes/${id}`;
                const response = await fetch(url, { method: 'DELETE' });
                const json = await response.json();
                if (!response.ok || !json.success) throw new Error(json.error || 'Erro ao deletar no servidor');
                showToast('Professor removido com sucesso', 'success');
            } catch (error) {
                console.error('Erro ao deletar:', error);
                showToast(`Erro ao remover: ${error.message}`, 'error');
                return;
            }
        }

        linha.classList.add('fade-out');
        setTimeout(() => linha.remove(), 300);
    }
}

// === SALVAR ALTERAÇÕES ===
async function salvarAlteracoes() {
    const btnSave = document.querySelector('button[onclick="salvarAlteracoes()"]');
    try {
        const rows = document.querySelectorAll('#tabelaProfessores tbody tr');
        const atribuicoes = [];

        rows.forEach(row => {
            const inputs = row.querySelectorAll('input');
            const atrib = {
                nome: inputs[0].value.trim(),
                classe: inputs[1].value.trim(),
                pontuacao: Number(inputs[2].value) || 0,
                serieTurma: inputs[3].value.trim(),
                ha: Number(inputs[4].value) || 0,
                rp: Number(inputs[5].value) || 0,
                estudoL: Number(inputs[6].value) || 0,
                estudoEsc: Number(inputs[7].value) || 0,
                cargaHoraria: inputs[8].value.trim(),
                observacoes: inputs[9].value.trim()
            };

            if (row.dataset.id) {
                atrib._id = row.dataset.id;
            }

            // Apenas adiciona se tiver nome
            if (atrib.nome) {
                atribuicoes.push(atrib);
            }
        });

        if (atribuicoes.length === 0) {
            showToast('Nenhum professor com nome para salvar', 'warning');
            return;
        }

        if (btnSave) {
            btnSave.disabled = true;
            btnSave.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';
        }

        const url = `${db.baseUrl}/atribuicoes/sync`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ atribuicoes })
        });

        const text = await response.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            console.error('Resposta não-JSON do servidor:', text);
            throw new Error('Servidor enviou uma resposta inválida (não JSON).');
        }

        if (!response.ok || !json.success) {
            throw new Error(json.error || json.message || 'Erro ao sincronizar dados no servidor');
        }

        renderizarTabela(json.data);
        showToast('Todas as alterações foram salvas com sucesso!', 'success');

    } catch (error) {
        console.error('Erro ao salvar alterações:', error);
        showToast(`Erro ao salvar: ${error.message}`, 'error');
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = '<i class="bi bi-save"></i> Salvar Alterações';
        }
    }
}

function gerarPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');

    const observacoes = document.getElementById('caixaTexto').value;

    // Título Centralizado
    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text('Lista de Professores - Controle de Atribuições', 148, 15, { align: 'center' });

    let currentY = 25;

    if (observacoes) {
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Observações Gerais:', 14, currentY);
        currentY += 5;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const splitObs = doc.splitTextToSize(observacoes, 260);
        doc.text(splitObs, 14, currentY);
        currentY += (splitObs.length * 5) + 5;
    }

    const linhas = [];
    const rows = document.querySelectorAll('#tabelaProfessores tbody tr');

    rows.forEach(row => {
        const inputs = row.querySelectorAll('input');
        const dados = [];
        inputs.forEach(input => {
            dados.push(input.value || '-');
        });
        // Adiciona uma coluna vazia para a Assinatura (para assinatura manual no papel)
        dados.push('');
        linhas.push(dados);
    });

    doc.autoTable({
        startY: currentY,
        head: [['Nome', 'Classe', 'Pontuação', 'Série/Turma', 'H.A', 'R.P', 'Estudo L', 'Estudo Esc.', 'Carga', 'Observações', 'Assinatura']],
        body: linhas,
        theme: 'grid',
        headStyles: {
            fillColor: [76, 154, 255],
            textColor: [255, 255, 255],
            fontSize: 9,
            fontStyle: 'bold',
            halign: 'center'
        },
        columnStyles: {
            0: { cellWidth: 40 }, // Nome
            9: { cellWidth: 40 }, // Observações
            10: { cellWidth: 35 } // Assinatura
        },
        bodyStyles: {
            fontSize: 8,
            textColor: [50, 50, 50],
            valign: 'middle'
        },
        alternateRowStyles: {
            fillColor: [248, 250, 252]
        },
        margin: { top: 10, left: 10, right: 10 }
    });

    const dataAtual = new Date().toLocaleDateString('pt-BR');
    const horaAtual = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Gerado em: ${dataAtual} às ${horaAtual}`, 14, doc.internal.pageSize.height - 10);
    doc.text('Sistema de Gestão Escolar', 283, doc.internal.pageSize.height - 10, { align: 'right' });

    doc.save(`lista_professores_${dataAtual.replace(/\//g, '-')}.pdf`);
}
