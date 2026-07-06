const path = require('path');
const fs = require('fs');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const logger = require('../utils/logger');

// ── Resolução robusta das fontes pdfmake ──────────────────────────────────────
// Tenta múltiplos caminhos para funcionar tanto em dev quanto no Render
function resolveFontPath(filename) {
    const candidates = [
        path.join(__dirname, '../../node_modules/pdfmake/fonts/Roboto', filename),
        path.join(process.cwd(), 'node_modules/pdfmake/fonts/Roboto', filename),
        path.join(__dirname, '../../../node_modules/pdfmake/fonts/Roboto', filename),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    // fallback: retorna o primeiro (vai falhar com mensagem clara)
    logger.warn(`[PDF] Fonte não encontrada: ${filename}. Usando fallback.`);
    return candidates[0];
}

// ── Inicialização do PdfPrinter (pdfmake 0.2.x) ───────────────────────────────
let printer;
try {
    const PdfPrinter = require('pdfmake');
    const fonts = {
        Roboto: {
            normal:      resolveFontPath('Roboto-Regular.ttf'),
            bold:        resolveFontPath('Roboto-Medium.ttf'),
            italics:     resolveFontPath('Roboto-Italic.ttf'),
            bolditalics: resolveFontPath('Roboto-MediumItalic.ttf'),
        }
    };
    printer = new PdfPrinter(fonts);
    logger.info('[PDF] PdfPrinter inicializado com sucesso.');
} catch (e) {
    logger.error(`[PDF] Falha ao inicializar PdfPrinter: ${e.message}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Paleta alinhada ao design system do portal: fundo escuro + acento emerald #10b981.
const CYAN   = '#10b981'; // acento primário (emerald) — antes ciano #00d4ff
const PURPLE = '#059669'; // acento secundário (emerald escuro) p/ cabeçalhos — antes roxo
const DARK   = '#0f172a';
const DARK2  = '#1e293b';
const WHITE  = '#ffffff';
const GRAY   = '#94a3b8';
const GREEN  = '#10b981';
const YELLOW = '#f59e0b';
const RED    = '#ef4444';
const BORDER = '#334155';

function notaColor(v) {
    if (v === '-' || v == null) return GRAY;
    const n = Number(v);
    if (n >= 7) return GREEN;
    if (n >= 5) return YELLOW;
    return RED;
}

function notaCell(v) {
    const display = (v == null || v === '' || v === undefined) ? '-' : String(v);
    return {
        text: display,
        alignment: 'center',
        bold: display !== '-',
        color: notaColor(display === '-' ? '-' : display),
        fillColor: DARK2,
        margin: [0, 4, 0, 4],
    };
}

function headerCell(text) {
    return {
        text,
        bold: true,
        color: WHITE,
        fillColor: PURPLE,
        alignment: 'center',
        margin: [0, 6, 0, 6],
        fontSize: 9,
    };
}

exports.gerarBoletim = async (req, res) => {
    if (!printer) {
        return res.status(503).json({ success: false, error: 'Serviço de PDF não disponível no momento.' });
    }

    try {
        const { alunoId } = req.params;

        // 1. Dados do aluno
        const aluno = await Aluno.findById(alunoId).lean();
        if (!aluno) return res.status(404).json({ success: false, error: 'Aluno não encontrado' });

        // 2. Notas
        const notas = await Nota.find({ alunoId }).lean();

        // 3. Frequência
        const faltas = await Falta.find({ aluno: alunoId }).lean();
        const totalAulas = faltas.length;
        const totalPresencas = faltas.filter(f => f.presente).length;
        const freqNum = totalAulas > 0 ? (totalPresencas / totalAulas) * 100 : 100;
        const freqStr = freqNum.toFixed(1) + '%';
        const freqColor = freqNum >= 75 ? GREEN : freqNum >= 60 ? YELLOW : RED;

        // 4. Organiza notas por matéria
        const boletimMap = {};
        notas.forEach(n => {
            if (!boletimMap[n.materiaId]) {
                boletimMap[n.materiaId] = { nome: n.materiaId, b1: '-', b2: '-', b3: '-', b4: '-' };
            }
            boletimMap[n.materiaId][`b${n.bimestre}`] = n.nota != null ? n.nota : '-';
        });

        // 5. Linhas da tabela
        const tableRows = Object.values(boletimMap).map(m => {
            const vals = [m.b1, m.b2, m.b3, m.b4];
            const nums = vals.filter(v => v !== '-').map(Number);
            const media = nums.length > 0 ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : '-';
            return [
                { text: m.nome, bold: false, color: WHITE, fillColor: DARK2, margin: [6, 4, 0, 4], fontSize: 9 },
                notaCell(m.b1), notaCell(m.b2), notaCell(m.b3), notaCell(m.b4),
                {
                    text: media,
                    bold: true,
                    color: notaColor(media),
                    fillColor: '#0f172a',
                    alignment: 'center',
                    margin: [0, 4, 0, 4],
                    fontSize: 10,
                }
            ];
        });

        if (tableRows.length === 0) {
            tableRows.push([
                { text: 'Nenhuma nota lançada ainda.', colSpan: 6, alignment: 'center', color: GRAY, fillColor: DARK2, margin: [0, 8, 0, 8] },
                {}, {}, {}, {}, {}
            ]);
        }

        const nomeCompleto = `${aluno.nome} ${aluno.sobrenome || ''}`.trim();
        const ano = new Date().getFullYear();

        // 6. Definição do documento
        const docDefinition = {
            pageSize: 'A4',
            pageMargins: [40, 40, 40, 50],
            background: [{ canvas: [{ type: 'rect', x: 0, y: 0, w: 595, h: 842, color: DARK }] }],
            defaultStyle: { font: 'Roboto', color: WHITE, fontSize: 10 },

            content: [
                // ── Cabeçalho ──
                {
                    columns: [
                        {
                            stack: [
                                { text: 'ESCOLA JAGUARI', fontSize: 18, bold: true, color: CYAN, letterSpacing: 2 },
                                { text: 'SISTEMA ESCOLAR — BOLETIM OFICIAL', fontSize: 8, color: GRAY, margin: [0, 2, 0, 0] },
                            ]
                        },
                        {
                            stack: [
                                { text: `Ano Letivo ${ano}`, fontSize: 11, bold: true, color: WHITE, alignment: 'right' },
                                { text: `Gerado em ${new Date().toLocaleDateString('pt-BR')}`, fontSize: 8, color: GRAY, alignment: 'right' },
                            ]
                        }
                    ],
                    margin: [0, 0, 0, 12],
                },
                // linha separadora gradiente simulada
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: PURPLE }], margin: [0, 0, 0, 16] },

                // ── Info do aluno ──
                {
                    table: {
                        widths: ['*', '*', '*'],
                        body: [[
                            {
                                stack: [
                                    { text: 'ALUNO', fontSize: 7, color: GRAY, bold: true, margin: [0, 0, 0, 2] },
                                    { text: nomeCompleto, fontSize: 13, bold: true, color: WHITE }
                                ],
                                fillColor: DARK2, border: [false, false, false, false], margin: [12, 10, 0, 10]
                            },
                            {
                                stack: [
                                    { text: 'TURMA', fontSize: 7, color: GRAY, bold: true, margin: [0, 0, 0, 2] },
                                    { text: aluno.turma || 'N/A', fontSize: 13, bold: true, color: CYAN }
                                ],
                                fillColor: DARK2, border: [false, false, false, false], margin: [12, 10, 0, 10]
                            },
                            {
                                stack: [
                                    { text: 'FREQUÊNCIA', fontSize: 7, color: GRAY, bold: true, margin: [0, 0, 0, 2] },
                                    { text: freqStr, fontSize: 13, bold: true, color: freqColor }
                                ],
                                fillColor: DARK2, border: [false, false, false, false], margin: [12, 10, 12, 10]
                            }
                        ]]
                    },
                    layout: { defaultBorder: false },
                    margin: [0, 0, 0, 16],
                },

                // ── Tabela de notas ──
                { text: 'NOTAS POR DISCIPLINA', fontSize: 9, bold: true, color: GRAY, letterSpacing: 1, margin: [0, 0, 0, 6] },
                {
                    table: {
                        headerRows: 1,
                        widths: ['*', 50, 50, 50, 50, 55],
                        body: [
                            [
                                headerCell('DISCIPLINA'),
                                headerCell('1º BIM'),
                                headerCell('2º BIM'),
                                headerCell('3º BIM'),
                                headerCell('4º BIM'),
                                { ...headerCell('MÉDIA'), fillColor: '#064e3b' }
                            ],
                            ...tableRows
                        ]
                    },
                    layout: {
                        hLineWidth: () => 1,
                        vLineWidth: () => 0,
                        hLineColor: () => BORDER,
                        paddingLeft: () => 0,
                        paddingRight: () => 0,
                    },
                    margin: [0, 0, 0, 20],
                },

                // ── Legenda ──
                {
                    columns: [
                        { text: '● Aprovado: ≥ 7.0', color: GREEN, fontSize: 8, bold: true },
                        { text: '● Em recuperação: 5.0–6.9', color: YELLOW, fontSize: 8, bold: true },
                        { text: '● Reprovado: < 5.0', color: RED, fontSize: 8, bold: true },
                        { text: '● Frequência mínima: 75%', color: CYAN, fontSize: 8, bold: true },
                    ],
                    margin: [0, 0, 0, 24],
                },
            ],

            footer: (currentPage, pageCount) => ({
                columns: [
                    { text: `Escola Jaguari — Documento gerado automaticamente`, fontSize: 7, color: GRAY, margin: [40, 0, 0, 0] },
                    { text: `Página ${currentPage} de ${pageCount}`, fontSize: 7, color: GRAY, alignment: 'right', margin: [0, 0, 40, 0] }
                ]
            }),
        };

        const pdfDoc = printer.createPdfKitDocument(docDefinition);

        if (!pdfDoc || typeof pdfDoc.pipe !== 'function') {
            throw new Error('pdfmake não retornou um documento válido. Verifique as fontes.');
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Boletim_${aluno.nome.replace(/\s+/g, '_')}.pdf`);
        pdfDoc.pipe(res);
        pdfDoc.end();

    } catch (error) {
        logger.error(`Erro ao gerar boletim: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Erro ao gerar o PDF do boletim.' });
        }
    }
};
exports.gerarRelatorioBI = async (req, res) => {
    if (!printer) {
        return res.status(503).json({ success: false, error: 'Serviço de PDF não disponível.' });
    }

    try {
        // 1. Coleta dados agregados (Mapa de Calor)
        const pipeline = [
            { $addFields: { notaNum: { $toDouble: "$nota" } } },
            { 
                $group: { 
                    _id: { materia: "$materiaId", turma: "$turmaId" }, 
                    media: { $avg: "$notaNum" },
                    total: { $sum: 1 }
                } 
            },
            { $sort: { "_id.turma": 1, "_id.materia": 1 } }
        ];
        const data = await Nota.aggregate(pipeline);

        if (data.length === 0) {
            return res.status(404).json({ success: false, error: 'Não há dados suficientes para gerar o relatório.' });
        }

        // 2. Transforma em matriz para a tabela do PDF
        const turmas = [...new Set(data.map(d => d._id.turma))].sort();
        const materias = [...new Set(data.map(d => d._id.materia))].sort();

        const tableBody = [
            [headerCell('Matéria / Turma'), ...turmas.map(t => headerCell(t))]
        ];

        materias.forEach(m => {
            const row = [{ text: m, bold: true, color: WHITE, fillColor: DARK2, fontSize: 8, margin: [4, 4, 4, 4] }];
            turmas.forEach(t => {
                const entry = data.find(d => d._id.materia === m && d._id.turma === t);
                const media = (entry && entry.media != null) ? entry.media.toFixed(1) : '-';
                row.push(notaCell(media));
            });
            tableBody.push(row);
        });

        const docDefinition = {
            pageSize: 'A4',
            pageOrientation: 'landscape',
            background: [{ canvas: [{ type: 'rect', x: 0, y: 0, w: 842, h: 595, color: DARK }] }],
            content: [
                { text: 'RELATÓRIO DE DESEMPENHO PEDAGÓGICO (BI)', fontSize: 16, bold: true, color: CYAN, margin: [0, 0, 0, 10] },
                { text: `Gerado em: ${new Date().toLocaleString('pt-BR')}`, fontSize: 9, color: GRAY, margin: [0, 0, 0, 20] },
                {
                    table: {
                        headerRows: 1,
                        widths: [100, ...turmas.map(() => '*')],
                        body: tableBody
                    },
                    layout: { hLineColor: () => BORDER, vLineColor: () => BORDER }
                }
            ],
            defaultStyle: { font: 'Roboto' }
        };

        const pdfDoc = printer.createPdfKitDocument(docDefinition);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=Relatorio_BI_Pedagogico.pdf');
        pdfDoc.pipe(res);
        pdfDoc.end();

    } catch (error) {
        logger.error(`Erro ao gerar relatório BI: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro interno ao gerar relatório.' });
    }
};
