'use strict';

/**
 * gerarRelatorioPDF — produz um relatório em PDF e devolve o link de download.
 *
 * POR QUE É UMA AÇÃO COM CONFIRMAÇÃO
 * ----------------------------------
 * Gerar não destrói nada, mas MATERIALIZA um arquivo durável com dados
 * agregados de alunos, que fica no GridFS e pode ser baixado depois. Confirmar
 * antes dá à pessoa a chance de conferir o escopo (tipo e período) antes de o
 * arquivo existir.
 *
 * ISOLAMENTO
 * ----------
 * Todas as agregações passam por `filtroDaEscola`. O arquivo é gravado com
 * `metadata.escolaId` e `metadata.usuarioId`, que é o que o `FileController`
 * usa para autorizar o download — um relatório da escola A nunca é baixável
 * por alguém operando a escola B.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const Nota = require('../../../models/Nota');
const Falta = require('../../../models/Falta');
const Aluno = require('../../../models/Aluno');
const { obterPrinter } = require('../../../controllers/RelatorioController');
const { filtroDaEscola, ErroPermissao } = require('../PermissionGuard');

const TIPOS = ['desempenho', 'frequencia'];

// Paleta do design system (verde institucional), a mesma do relatório BI.
const VERDE = '#10b981';
const ESCURO = '#111827';
const CINZA = '#6b7280';
const BORDA = '#e5e7eb';

const cabecalho = (texto) => ({
    text: texto, bold: true, fontSize: 9, color: '#ffffff',
    fillColor: ESCURO, margin: [4, 5, 4, 5]
});

const celula = (texto) => ({
    text: String(texto), fontSize: 9, color: ESCURO, margin: [4, 4, 4, 4]
});

/** Renderiza o documento pdfmake para um Buffer. */
function renderizarPdf(printer, docDefinition) {
    return new Promise((resolve, reject) => {
        try {
            const doc = printer.createPdfKitDocument(docDefinition);
            const partes = [];
            doc.on('data', (p) => partes.push(p));
            doc.on('end', () => resolve(Buffer.concat(partes)));
            doc.on('error', reject);
            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

/** Grava o PDF no GridFS com os metadados que autorizam o download. */
function guardarNoGridFS(buffer, { nomeArquivo, usuarioId, escolaId }) {
    return new Promise((resolve, reject) => {
        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });

        const stream = bucket.openUploadStream(nomeArquivo, {
            contentType: 'application/pdf',
            // É este metadata que o FileController.autorizarArquivo consulta:
            // `escolaId` barra outro tenant; `usuarioId` libera o autor e a gestão.
            metadata: {
                usuarioId: String(usuarioId),
                escolaId: escolaId ? String(escolaId) : undefined,
                type: 'relatorio_ia'
            }
        });

        stream.on('error', reject);
        stream.on('finish', () => resolve(String(stream.id)));
        stream.end(buffer);
    });
}

/** Média por matéria × turma, escopada à escola. */
async function dadosDesempenho(ctx) {
    const escopo = filtroDaEscola(ctx);

    const linhas = await Nota.aggregate([
        { $match: escopo },
        // `$toDouble` estoura em lançamento conceitual ("Satisfatório"), que
        // existe na base por herança. `$convert` com onError descarta em vez de
        // derrubar a agregação inteira.
        { $addFields: { notaNum: { $convert: { input: '$nota', to: 'double', onError: null, onNull: null } } } },
        { $match: { notaNum: { $ne: null } } },
        {
            $group: {
                _id: { materia: '$materiaId', turma: '$turmaId' },
                media: { $avg: '$notaNum' },
                lancamentos: { $sum: 1 }
            }
        },
        { $sort: { '_id.turma': 1, '_id.materia': 1 } }
    ]);

    return linhas;
}

/** Faltas por turma, escopadas à escola. */
async function dadosFrequencia(ctx, desde) {
    const escopo = filtroDaEscola(ctx);

    return Falta.aggregate([
        { $match: { ...escopo, data: { $gte: desde } } },
        {
            $group: {
                _id: '$turma',
                registros: { $sum: 1 },
                faltas: { $sum: { $cond: [{ $eq: ['$presente', false] }, 1, 0] } }
            }
        },
        { $sort: { _id: 1 } }
    ]);
}

module.exports = {
    name: 'gerarRelatorioPDF',
    description: 'Gera um relatório em PDF da escola (desempenho por turma/matéria ou frequência) e devolve o link para baixar. Use quando pedirem um relatório, um PDF ou algo "para imprimir". Exige confirmação antes de ser gerado.',

    schema: {
        type: 'object',
        properties: {
            tipo: {
                type: 'string',
                enum: TIPOS,
                description: 'Tipo de relatório: "desempenho" (médias por turma e matéria) ou "frequencia" (faltas por turma).'
            },
            dias: {
                type: 'number',
                description: 'Somente para o tipo "frequencia": janela em dias a analisar. Padrão: 60.'
            }
        },
        required: ['tipo']
    },

    cargosPermitidos: ['diretor', 'secretaria'],
    mutates: true,

    /** PREVIEW — confere o escopo e se há dados. Não gera arquivo nenhum. */
    async handler({ tipo, dias }, ctx) {
        const tipoLimpo = String(tipo || '').toLowerCase().trim();
        if (!TIPOS.includes(tipoLimpo)) {
            throw new ErroPermissao(`Tipo de relatório inválido. Os aceitos são: ${TIPOS.join(' e ')}.`);
        }

        if (!obterPrinter()) {
            throw new ErroPermissao('A geração de PDF não está disponível neste servidor. Avise a pessoa e sugira falar com o suporte.');
        }

        const janela = Number(dias) || 60;

        // Checar aqui evita a frustração de confirmar e receber "sem dados".
        if (tipoLimpo === 'desempenho') {
            const linhas = await dadosDesempenho(ctx);
            if (linhas.length === 0) {
                throw new ErroPermissao('Não há notas lançadas nesta escola para montar o relatório de desempenho.');
            }
            return {
                resumo: `Gerar relatório de desempenho em PDF — ${linhas.length} combinações de turma e matéria`,
                parametros: { tipo: tipoLimpo }
            };
        }

        const desde = new Date();
        desde.setDate(desde.getDate() - janela);
        const linhas = await dadosFrequencia(ctx, desde);
        if (linhas.length === 0) {
            throw new ErroPermissao(`Não há registros de frequência nos últimos ${janela} dias nesta escola.`);
        }

        return {
            resumo: `Gerar relatório de frequência em PDF — ${linhas.length} turmas, últimos ${janela} dias`,
            parametros: { tipo: tipoLimpo, dias: janela }
        };
    },

    /** EXECUÇÃO — só após confirmação válida. */
    async confirmar(parametros, ctx) {
        const printer = obterPrinter();
        if (!printer) {
            throw new ErroPermissao('A geração de PDF não está disponível neste servidor.');
        }

        const agora = new Date();
        const carimbo = agora.toLocaleString('pt-BR');
        let corpo;
        let titulo;

        if (parametros.tipo === 'desempenho') {
            titulo = 'Relatório de Desempenho';
            const linhas = await dadosDesempenho(ctx);

            const turmas = [...new Set(linhas.map(l => l._id.turma).filter(Boolean))].sort();
            const materias = [...new Set(linhas.map(l => l._id.materia).filter(Boolean))].sort();

            const tabela = [[cabecalho('Matéria / Turma'), ...turmas.map(t => cabecalho(t))]];
            for (const materia of materias) {
                const linha = [{ text: materia, bold: true, fontSize: 9, color: ESCURO, margin: [4, 4, 4, 4] }];
                for (const turma of turmas) {
                    const item = linhas.find(l => l._id.materia === materia && l._id.turma === turma);
                    linha.push(celula(item && item.media != null ? item.media.toFixed(1) : '—'));
                }
                tabela.push(linha);
            }

            corpo = {
                table: { headerRows: 1, widths: [110, ...turmas.map(() => '*')], body: tabela },
                layout: { hLineColor: () => BORDA, vLineColor: () => BORDA }
            };
        } else {
            titulo = `Relatório de Frequência — últimos ${parametros.dias} dias`;
            const desde = new Date();
            desde.setDate(desde.getDate() - parametros.dias);

            const linhas = await dadosFrequencia(ctx, desde);
            const matriculados = await Aluno.aggregate([
                { $match: { ...filtroDaEscola(ctx), ativo: { $ne: false } } },
                { $group: { _id: '$turma', total: { $sum: 1 } } }
            ]);
            const porTurma = new Map(matriculados.map(m => [m._id, m.total]));

            const tabela = [[
                cabecalho('Turma'), cabecalho('Alunos'), cabecalho('Registros'),
                cabecalho('Faltas'), cabecalho('Presença')
            ]];
            for (const l of linhas) {
                const presenca = l.registros > 0
                    ? (((l.registros - l.faltas) / l.registros) * 100).toFixed(1) + '%'
                    : '—';
                tabela.push([
                    celula(l._id || '—'),
                    celula(porTurma.get(l._id) ?? '—'),
                    celula(l.registros),
                    celula(l.faltas),
                    celula(presenca)
                ]);
            }

            corpo = {
                table: { headerRows: 1, widths: ['*', 60, 70, 60, 70], body: tabela },
                layout: { hLineColor: () => BORDA, vLineColor: () => BORDA }
            };
        }

        const buffer = await renderizarPdf(printer, {
            pageSize: 'A4',
            pageOrientation: parametros.tipo === 'desempenho' ? 'landscape' : 'portrait',
            content: [
                { text: titulo.toUpperCase(), fontSize: 15, bold: true, color: VERDE, margin: [0, 0, 0, 6] },
                { text: `Gerado em ${carimbo} por ${ctx.nome || 'usuário'}`, fontSize: 8, color: CINZA, margin: [0, 0, 0, 16] },
                corpo
            ],
            defaultStyle: { font: 'Roboto' }
        });

        // Nome aleatório no armazenamento (o rótulo amigável vai na resposta).
        const nomeArquivo = crypto.randomBytes(12).toString('hex') + '.pdf';
        const arquivoId = await guardarNoGridFS(buffer, {
            nomeArquivo,
            usuarioId: ctx.usuarioId,
            escolaId: ctx.escolaId
        });

        return {
            recursoId: arquivoId,
            mensagem: `${titulo} gerado. O download está disponível no link abaixo.`,
            // Rota já existente, que aplica authJWT + filtrarPorEscola e a
            // autorização por metadata do FileController.
            link: `/api/upload/documento/${arquivoId}`,
            arquivo: {
                tipo: parametros.tipo,
                tamanhoKB: Math.round(buffer.length / 1024),
                geradoEm: agora
            }
        };
    }
};
