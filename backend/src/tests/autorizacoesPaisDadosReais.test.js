/**
 * @jest-environment jsdom
 */

/**
 * autorizacoesPaisDadosReais.test.js — a tela "Autorizações dos Pais" só mostra o
 * que o responsável de fato respondeu ou enviou (Issue #270).
 *
 * O DEFEITO
 * ---------
 * A tela inventava dados em quatro pontos:
 *   - autorização nunca respondida aparecia como "Aceita" (`campo === false ?
 *     'nao_aceita' : 'aceita'`);
 *   - "Uso de imagem" lia um campo que não existe no cadastro, então era
 *     sempre "Aceita";
 *   - aluno sem documento recebia cinco documentos de exemplo com links
 *     `mock-preview`;
 *   - datas de resposta, responsável, matrícula e turma tinham valores fixos.
 * A escola decide excursão, antitérmico e atendimento médico olhando para esta
 * tela. Consentimento que não existe na tela é consentimento inventado.
 *
 * O QUE ESTE ARQUIVO COBRA
 * ------------------------
 *   1. As regras isoladas (`detalhes/autorizacoes-pais-dados.js`).
 *   2. A tela real (`detalhes/autorizacoes-pais.html` + `.js`) com a API
 *      simulada: resposta ausente vira "Sem resposta", recusa vira "Não
 *      aceita", e aluno sem documento mostra a tabela vazia.
 *   3. Nenhum valor de exemplo sobrou no código da tela.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const DADOS = path.join(RAIZ, 'detalhes', 'autorizacoes-pais-dados.js');
const TELA_JS = path.join(RAIZ, 'detalhes', 'autorizacoes-pais.js');
const TELA_HTML = path.join(RAIZ, 'detalhes', 'autorizacoes-pais.html');

const D = require(DADOS);

describe('regras de exibição (autorizacoes-pais-dados.js)', () => {
    it('resposta ausente é "Sem resposta", nunca "Aceita"', () => {
        for (const valor of [null, undefined, '', 'sim', 0]) {
            expect(D.statusDaAutorizacao(valor).rotulo).toBe('Sem resposta');
        }
        expect(D.statusDaAutorizacao(true).rotulo).toBe('Aceita');
        expect(D.statusDaAutorizacao(false).rotulo).toBe('Não aceita');
    });

    it('autorização sem resposta não tem data, responsável nem observação', () => {
        const linha = D.linhaDaAutorizacao(
            {
                tipo: 'antitermico',
                titulo: 'Autoriza antitérmico',
                aceita: null,
                dataResposta: '2026-09-01',
            },
            'Ana Lima'
        );
        expect(linha.statusLabel).toBe('Sem resposta');
        expect(linha.dataResposta).toBe('—');
        expect(linha.responsavel).toBe('—');
    });

    it('autorização respondida mostra a data real e os detalhes enviados', () => {
        const linha = D.linhaDaAutorizacao(
            {
                titulo: 'Autoriza antitérmico',
                aceita: true,
                dataResposta: '2026-09-01T12:00:00.000Z',
                detalhes: { medicamentoNome: 'Paracetamol', medicamentoDose: '10 gotas' },
            },
            'Ana Lima'
        );
        expect(linha.statusLabel).toBe('Aceita');
        expect(linha.dataResposta).toBe(
            new Date('2026-09-01T12:00:00.000Z').toLocaleDateString('pt-BR')
        );
        expect(linha.responsavel).toBe('Ana Lima');
        expect(linha.observacoes).toBe('Medicamento: Paracetamol · Dose: 10 gotas');
    });

    it.each([
        [{ aceitas: 7, naoAceitas: 0, pendentes: 0 }, 'todas_aceitas', 'Todas aceitas'],
        [{ aceitas: 5, naoAceitas: 2, pendentes: 0 }, 'nao_aceita', '2 não aceitas'],
        [{ aceitas: 6, naoAceitas: 1, pendentes: 0 }, 'nao_aceita', '1 não aceita'],
        [{ aceitas: 4, naoAceitas: 0, pendentes: 3 }, 'pendente', '3 sem resposta'],
        [{ aceitas: 0, naoAceitas: 0, pendentes: 7 }, 'pendente', 'Sem resposta'],
    ])('resumo %o → %s', (contagens, grupo, texto) => {
        const r = D.resumoDoAluno(contagens);
        expect(r.grupo).toBe(grupo);
        expect(r.texto).toBe(texto);
    });

    it('registro sem arquivo não vira documento', () => {
        expect(D.normalizarDocumentos([{ _id: 'x', nomeDocumento: 'Sem arquivo' }, null])).toEqual(
            []
        );
        expect(D.normalizarDocumentos(undefined)).toEqual([]);
    });

    it('documento real aponta para as rotas reais do arquivo', () => {
        const [doc] = D.normalizarDocumentos([
            {
                _id: '65f0000000000000000000aa',
                nomeDocumento: 'Termo assinado',
                tipoDocumento: 'Termo',
                arquivo: {
                    nomeOriginal: 'termo.pdf',
                    mimeType: 'application/pdf',
                    url: '/x',
                    storageId: 's',
                    tamanho: 1,
                },
                dataEnvio: '2026-09-02T10:00:00.000Z',
            },
        ]);
        expect(doc.ext).toBe('PDF');
        expect(doc.urlPreview).toBe(
            '/api/documentos-responsaveis/65f0000000000000000000aa/visualizar'
        );
        expect(doc.urlDownload).toBe(
            '/api/documentos-responsaveis/65f0000000000000000000aa/download'
        );
    });

    it('escapa marcação vinda do banco', () => {
        expect(D.esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    });
});

// ─────────────────────────────────────────────────────────────────────────────

const ALUNO_ID = '65f0000000000000000000a1';

function corpoDaTela() {
    const html = fs.readFileSync(TELA_HTML, 'utf8');
    const corpo = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
    return corpo.replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
}

function resposta(corpo, ok = true) {
    return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(corpo) });
}

async function assentar() {
    for (let i = 0; i < 30; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

/** Sobe a tela real com a API simulada por `rotas` (prefixo → corpo). */
async function abrirTela(rotas) {
    document.body.innerHTML = corpoDaTela();
    sessionStorage.setItem(
        'currentUser',
        JSON.stringify({ nome: 'Diretora Teste', perfil: 'diretor' })
    );
    global.fetch = jest.fn((url) => {
        const chave = Object.keys(rotas).find((prefixo) => String(url).startsWith(prefixo));
        return chave ? resposta(rotas[chave]) : resposta({ success: false }, false);
    });
    window.fetch = global.fetch;
    window.AutorizacoesPaisDados = D;
    jest.isolateModules(() => {
        require(TELA_JS);
    });
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await assentar();
}

function colunaStatus() {
    return Array.from(document.querySelectorAll('#tableAutorizacoesBody tr td:nth-child(3)')).map(
        (td) => td.textContent.trim()
    );
}

const TIPOS = [
    'tratamentoOdontologico',
    'tratamentoMedicoEmergencial',
    'testagemAcuidade',
    'atividadesFisicas',
    'atividadesExtraclasse',
    'conducaoEscolar',
    'antitermico',
];

function detalhe(aceitas) {
    return {
        success: true,
        responsavel: { nome: 'Ana Lima' },
        autorizacoes: TIPOS.map((tipo, i) => ({
            tipo,
            titulo: tipo,
            descricao: '',
            aceita: aceitas[i],
            dataResposta: aceitas[i] === null ? null : '2026-09-01T12:00:00.000Z',
        })),
    };
}

afterEach(() => {
    delete global.fetch;
    delete window.AutorizacoesPaisDados;
    sessionStorage.clear();
});

describe('a tela real, com a API simulada', () => {
    it('responsável que não respondeu nada: sete "Sem resposta" e nenhum documento', async () => {
        await abrirTela({
            '/api/secretaria/autorizacoes/aluno/': detalhe(TIPOS.map(() => null)),
            '/api/secretaria/autorizacoes': {
                success: true,
                alunos: [
                    {
                        id: ALUNO_ID,
                        nome: 'Bruno Alves',
                        turma: '3ºB',
                        matricula: '',
                        responsavel: 'Não informado',
                        aceitas: 0,
                        naoAceitas: 0,
                        pendentes: 7,
                    },
                ],
            },
            '/api/documentos-responsaveis': { success: true, data: [] },
            '/api/alunos': { success: true, data: [] },
            '/api/turmas': { success: true, data: [] },
        });

        expect(colunaStatus()).toEqual(TIPOS.map(() => 'Sem resposta'));
        expect(document.getElementById('tableAutorizacoesBody').textContent).not.toMatch(/Aceita/);

        const docs = document.getElementById('tableDocumentosBody').textContent;
        expect(docs).toMatch(/Nenhum documento enviado pelo responsável/);
        expect(docs).not.toMatch(/Termo de responsabilidade|Comprovante de residência/);

        // Matrícula e responsável ausentes não recebem valor de exemplo.
        const lista = document.getElementById('studentsListContainer').textContent;
        expect(lista).toMatch(/RA: —/);
        expect(lista).toMatch(/Sem resposta/);
    });

    it('respostas reais: aceita, recusa e pendente aparecem como foram dadas', async () => {
        const aceitas = [true, false, null, true, true, false, null];
        await abrirTela({
            '/api/secretaria/autorizacoes/aluno/': detalhe(aceitas),
            '/api/secretaria/autorizacoes': {
                success: true,
                alunos: [
                    {
                        id: ALUNO_ID,
                        nome: 'Carla Dias',
                        turma: '5ºA Manhã',
                        matricula: '123',
                        responsavel: 'Ana Lima',
                        aceitas: 3,
                        naoAceitas: 2,
                        pendentes: 2,
                    },
                ],
            },
            '/api/documentos-responsaveis': {
                success: true,
                data: [
                    {
                        _id: '65f0000000000000000000d1',
                        alunoId: ALUNO_ID,
                        nomeDocumento: 'Declaração assinada',
                        arquivo: {
                            nomeOriginal: 'd.png',
                            mimeType: 'image/png',
                            url: '/x',
                            storageId: 's',
                            tamanho: 1,
                        },
                        dataEnvio: '2026-09-03T10:00:00.000Z',
                    },
                ],
            },
            '/api/alunos': { success: true, data: [] },
            '/api/turmas': { success: true, data: [] },
        });

        expect(colunaStatus()).toEqual([
            'Aceita',
            'Não aceita',
            'Sem resposta',
            'Aceita',
            'Aceita',
            'Não aceita',
            'Sem resposta',
        ]);

        const linhasDocs = document.querySelectorAll('#tableDocumentosBody tr');
        expect(linhasDocs).toHaveLength(1);
        expect(linhasDocs[0].textContent).toMatch(/Declaração assinada/);
        expect(linhasDocs[0].querySelector('a.download').getAttribute('href')).toBe(
            '/api/documentos-responsaveis/65f0000000000000000000d1/download'
        );

        expect(document.getElementById('studentsListContainer').textContent).toMatch(
            /2 não aceitas/
        );
    });
});

describe('o código da tela não guarda dado de exemplo', () => {
    const fonte = fs.readFileSync(TELA_JS, 'utf8');

    it.each([
        ['documento de exemplo', /mock-(preview|download)/],
        ['regra por nome de aluno', /Sophia/],
        ['responsável de exemplo', /Mariana Souza/],
        ['data fixa de resposta', /\d{2}\/\d{2}\/2025/],
        ['campo de imagem inexistente', /lgpdImagem/],
    ])('sem %s', (_nome, padrao) => {
        expect(fonte).not.toMatch(padrao);
    });

    it('lê o status das rotas que consolidam as respostas reais', () => {
        expect(fonte).toMatch(/\/api\/secretaria\/autorizacoes/);
    });
});
