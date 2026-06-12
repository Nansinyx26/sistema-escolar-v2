/**
 * Módulo de Exportação
 * Gera relatórios em DOCX, PDF e CSV
 */

import db from './db.js';
import ui from './ui.js';
import students from './students.js';
import notes from './notes.js';

class ExportManager {
    constructor() {
        this.docxLoaded = false;
    }

    /**
     * Carrega biblioteca docx se necessário
     */
    async loadDocxLibrary() {
        if (this.docxLoaded) return;

        return new Promise((resolve, reject) => {
            if (window.docx) {
                this.docxLoaded = true;
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://unpkg.com/docx@8.4.0/build/index.umd.js';
            script.onload = () => {
                this.docxLoaded = true;
                resolve();
            };
            script.onerror = () => reject(new Error('Falha ao carregar biblioteca DOCX'));
            document.head.appendChild(script);
        });
    }

    /**
     * Exporta lista de alunos para DOCX
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Número do bimestre
     * @returns {Promise<void>}
     */
    async exportarTurmaDOCX(turmaId, bimestre) {
        try {
            ui.loading(true, 'Gerando documento...');

            await this.loadDocxLibrary();

            const turma = db.getTurmaById(turmaId);
            const alunos = await students.getByTurma(turmaId);
            const config = db.getConfig();

            const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, Packer } = window.docx;

            // Criar linhas da tabela
            const tableRows = [
                // Cabeçalho
                new TableRow({
                    children: [
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: 'Nº', bold: true })] })],
                            width: { size: 5, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: 'Nome do Aluno', bold: true })] })],
                            width: { size: 40, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: 'Matrícula', bold: true })] })],
                            width: { size: 15, type: WidthType.PERCENTAGE }
                        }),
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: 'Observações', bold: true })] })],
                            width: { size: 40, type: WidthType.PERCENTAGE }
                        })
                    ],
                    tableHeader: true
                })
            ];

            // Linhas de dados
            alunos.forEach((aluno, index) => {
                tableRows.push(new TableRow({
                    children: [
                        new TableCell({
                            children: [new Paragraph({ text: String(index + 1) })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ text: aluno.nome })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ text: aluno.matricula || '-' })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ text: aluno.observacoes || '' })]
                        })
                    ]
                }));
            });

            const doc = new Document({
                sections: [{
                    children: [
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: config.escola.nome,
                                    bold: true,
                                    size: 32
                                })
                            ],
                            alignment: AlignmentType.CENTER
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: `Turma ${turmaId} - ${bimestre}º Bimestre`,
                                    bold: true,
                                    size: 28
                                })
                            ],
                            alignment: AlignmentType.CENTER
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: `Professor(a): ${turma?.professor || 'Não definido'}`,
                                    size: 24
                                })
                            ],
                            alignment: AlignmentType.CENTER
                        }),
                        new Paragraph({ text: '' }), // Espaço
                        new Table({
                            rows: tableRows,
                            width: { size: 100, type: WidthType.PERCENTAGE }
                        }),
                        new Paragraph({ text: '' }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: `Total de alunos: ${alunos.length}`,
                                    italics: true
                                })
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
                                    italics: true,
                                    size: 20
                                })
                            ]
                        })
                    ]
                }]
            });

            const blob = await Packer.toBlob(doc);
            this.downloadBlob(blob, `turma_${turmaId}_${bimestre}bim.docx`);

            ui.loading(false);
            ui.success('Documento gerado com sucesso!');
        } catch (error) {
            ui.loading(false);
            console.error('Erro ao exportar DOCX:', error);
            ui.error('Erro ao gerar documento: ' + error.message);
        }
    }

    /**
     * Exporta boletim de um aluno
     * @param {number} alunoId - ID do aluno
     * @returns {Promise<void>}
     */
    async exportarBoletimDOCX(alunoId) {
        try {
            ui.loading(true, 'Gerando boletim...');

            await this.loadDocxLibrary();

            const aluno = await students.getById(alunoId);
            const boletim = await notes.getBoletim(alunoId);
            const config = db.getConfig();
            const turma = db.getTurmaById(aluno.turmaId);

            const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, Packer } = window.docx;

            // Criar tabela de notas
            const tableRows = [
                new TableRow({
                    children: [
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: 'Matéria', bold: true })] })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: '1º Bim', bold: true })] })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: '2º Bim', bold: true })] })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: '3º Bim', bold: true })] })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: '4º Bim', bold: true })] })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: 'Média', bold: true })] })]
                        })
                    ],
                    tableHeader: true
                })
            ];

            Object.values(boletim).forEach(materia => {
                tableRows.push(new TableRow({
                    children: [
                        new TableCell({
                            children: [new Paragraph({ text: `${materia.icone} ${materia.nome}` })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ text: this.formatNota(materia.bimestres[1]?.media) })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ text: this.formatNota(materia.bimestres[2]?.media) })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ text: this.formatNota(materia.bimestres[3]?.media) })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ text: this.formatNota(materia.bimestres[4]?.media) })]
                        }),
                        new TableCell({
                            children: [new Paragraph({ text: this.formatNota(materia.mediaAnual) })]
                        })
                    ]
                }));
            });

            const doc = new Document({
                sections: [{
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: config.escola.nome, bold: true, size: 32 })],
                            alignment: AlignmentType.CENTER
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: 'BOLETIM ESCOLAR', bold: true, size: 28 })],
                            alignment: AlignmentType.CENTER
                        }),
                        new Paragraph({ text: '' }),
                        new Paragraph({
                            children: [new TextRun({ text: `Aluno(a): ${aluno.nome}`, size: 24 })]
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: `Turma: ${aluno.turmaId} | Matrícula: ${aluno.matricula}`, size: 24 })]
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: `Professor(a): ${turma?.professor || '-'}`, size: 24 })]
                        }),
                        new Paragraph({ text: '' }),
                        new Table({
                            rows: tableRows,
                            width: { size: 100, type: WidthType.PERCENTAGE }
                        }),
                        new Paragraph({ text: '' }),
                        new Paragraph({
                            children: [new TextRun({ text: `Gerado em: ${new Date().toLocaleString('pt-BR')}`, italics: true, size: 20 })]
                        })
                    ]
                }]
            });

            const blob = await Packer.toBlob(doc);
            this.downloadBlob(blob, `boletim_${aluno.nome.replace(/\s+/g, '_')}.docx`);

            ui.loading(false);
            ui.success('Boletim gerado com sucesso!');
        } catch (error) {
            ui.loading(false);
            console.error('Erro ao exportar boletim:', error);
            ui.error('Erro ao gerar boletim: ' + error.message);
        }
    }

    /**
     * Exporta dados para CSV
     * @param {Array} data - Dados a exportar
     * @param {Array} headers - Cabeçalhos das colunas
     * @param {string} filename - Nome do arquivo
     */
    exportarCSV(data, headers, filename) {
        try {
            const csvContent = [
                headers.join(';'),
                ...data.map(row =>
                    headers.map(header => {
                        const value = row[header] || '';
                        // Escapa aspas duplas e valores com ponto-e-vírgula
                        if (typeof value === 'string' && (value.includes(';') || value.includes('"'))) {
                            return `"${value.replace(/"/g, '""')}"`;
                        }
                        return value;
                    }).join(';')
                )
            ].join('\n');

            // Adiciona BOM para UTF-8
            const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
            this.downloadBlob(blob, filename);

            ui.success('CSV exportado com sucesso!');
        } catch (error) {
            console.error('Erro ao exportar CSV:', error);
            ui.error('Erro ao exportar CSV');
        }
    }

    /**
     * Exporta alunos de uma turma para CSV
     * @param {string} turmaId - ID da turma
     */
    async exportarAlunosCSV(turmaId) {
        const alunos = await students.getByTurma(turmaId);
        const headers = ['nome', 'matricula', 'dataNascimento', 'responsavel', 'telefone', 'email', 'deficiencia', 'observacoes'];

        this.exportarCSV(alunos, headers, `alunos_${turmaId}.csv`);
    }

    /**
     * Exporta notas para CSV
     * @param {string} turmaId - ID da turma (opcional)
     */
    async exportarNotasCSV(turmaId = null) {
        let todasNotas = turmaId
            ? await notes.getByTurma(turmaId)
            : await notes.getAll();

        // Enriquecer com nome do aluno
        const alunosMap = new Map();
        const alunos = await students.getAll();
        alunos.forEach(a => alunosMap.set(a.id, a.nome));

        const data = todasNotas.map(nota => ({
            aluno: alunosMap.get(nota.alunoId) || 'Desconhecido',
            turma: nota.turmaId,
            materia: nota.materiaId,
            bimestre: nota.bimestre,
            tipo: nota.tipo,
            descricao: nota.descricao,
            nota: nota.nota,
            peso: nota.peso,
            data: nota.data
        }));

        const headers = ['aluno', 'turma', 'materia', 'bimestre', 'tipo', 'descricao', 'nota', 'peso', 'data'];
        const filename = turmaId ? `notas_${turmaId}.csv` : 'notas_todas.csv';

        this.exportarCSV(data, headers, filename);
    }

    /**
     * Exporta relatório geral em TXT
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre
     */
    async exportarRelatorioTXT(turmaId, bimestre) {
        try {
            const turma = db.getTurmaById(turmaId);
            const alunos = await students.getByTurma(turmaId);
            const config = db.getConfig();
            const stats = await notes.getStatsTurma(turmaId, bimestre);

            let relatorio = `
${'='.repeat(60)}
${config.escola.nome}
${'='.repeat(60)}

RELATÓRIO DA TURMA ${turmaId} - ${bimestre}º BIMESTRE
Professor(a): ${turma?.professor || 'Não definido'}
Data: ${new Date().toLocaleString('pt-BR')}

${'─'.repeat(60)}
ESTATÍSTICAS GERAIS
${'─'.repeat(60)}
Total de Alunos: ${alunos.length}
Total de Avaliações: ${stats.totalNotas}
Média Geral: ${this.formatNota(stats.media)}
Maior Nota: ${stats.maior || '-'}
Menor Nota: ${stats.menor || '-'}
Aprovados (>=6): ${stats.aprovados}
Reprovados (<6): ${stats.reprovados}

${'─'.repeat(60)}
LISTA DE ALUNOS
${'─'.repeat(60)}
`;

            alunos.forEach((aluno, index) => {
                relatorio += `${String(index + 1).padStart(2, '0')}. ${aluno.nome}`;
                if (aluno.deficiencia) {
                    relatorio += ` [${aluno.deficiencia}]`;
                }
                relatorio += '\n';
            });

            relatorio += `
${'='.repeat(60)}
Sistema de Cadastro Escolar v2.0
${'='.repeat(60)}
`;

            const blob = new Blob([relatorio], { type: 'text/plain;charset=utf-8;' });
            this.downloadBlob(blob, `relatorio_${turmaId}_${bimestre}bim.txt`);

            ui.success('Relatório exportado com sucesso!');
        } catch (error) {
            console.error('Erro ao exportar relatório:', error);
            ui.error('Erro ao exportar relatório');
        }
    }

    /**
     * Formata nota para exibição
     * @param {number} nota - Valor da nota
     * @returns {string}
     */
    formatNota(nota) {
        if (nota === null || nota === undefined) return '-';
        return nota.toFixed(1).replace('.', ',');
    }

    /**
     * Faz download de um blob
     * @param {Blob} blob - Blob para download
     * @param {string} filename - Nome do arquivo
     */
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}

// Exporta instância única
const exportManager = new ExportManager();
export default exportManager;
