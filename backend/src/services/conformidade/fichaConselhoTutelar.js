/**
 * fichaConselhoTutelar.js — a ficha de comunicação de aluno infrequente (FICAI).
 *
 * O QUE ESTE DOCUMENTO RESOLVE
 * ----------------------------
 * O art. 12, VIII da LDB e o art. 56, II do ECA não pedem que a escola "avise"
 * o Conselho Tutelar: pedem uma COMUNICAÇÃO formal, com a relação dos alunos e
 * suas faltas. Sem um documento datado e identificado, o município não tem como
 * provar que cumpriu o dever — e a omissão é infração administrativa (ECA, art.
 * 245), com o processo caindo sobre a direção da escola.
 *
 * A ficha existe em papel na maioria das redes; a secretaria copia à mão nome,
 * endereço, telefone dos responsáveis e a lista de dias faltados. É trabalho
 * burocrático puro, feito exatamente sobre os dados que o sistema já tem, e é
 * onde erram: um dia a menos na lista invalida a contagem que motivou a ficha.
 *
 * POR QUE SÓ A DEFINIÇÃO, SEM RENDERIZAR
 * --------------------------------------
 * O `printer` do pdfmake vive no `RelatorioController` (a resolução das fontes
 * Roboto é frágil e foi centralizada lá de propósito — ver `obterPrinter`). Um
 * service não pode importar controller (contrato de camadas em
 * `.dependency-cruiser.cjs`), e duplicar a resolução de fontes traria de volta
 * o bug que ela conserta. Então aqui se monta a definição do documento — dado
 * puro, testável sem gerar PDF — e o controller a renderiza.
 */

const VERDE = '#10b981';
const ESCURO = '#111827';
const CINZA = '#6b7280';
const BORDA = '#e5e7eb';

const SEM_INFO = 'Não informado';

/** dd/mm/aaaa a partir de Date ou de 'aaaa-mm-dd' — sem depender do fuso do servidor. */
function dataBr(valor) {
    if (!valor) return SEM_INFO;
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) {
        const [ano, mes, dia] = valor.slice(0, 10).split('-');
        return `${dia}/${mes}/${ano}`;
    }
    const d = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(d.getTime())) return SEM_INFO;
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * `Aluno.endereco` é `Mixed`: cadastro manual grava string, importação grava
 * objeto. A ficha vai para o Conselho Tutelar localizar a criança — imprimir
 * "[object Object]" aqui não é feiúra de layout, é uma visita que não acontece.
 */
function enderecoTexto(endereco) {
    if (!endereco) return SEM_INFO;
    if (typeof endereco === 'string') return endereco.trim() || SEM_INFO;
    const partes = [
        [endereco.logradouro || endereco.rua, endereco.numero].filter(Boolean).join(', '),
        endereco.complemento,
        endereco.bairro,
        [endereco.cidade || endereco.municipio, endereco.uf || endereco.estado]
            .filter(Boolean)
            .join('/'),
        endereco.cep ? `CEP ${endereco.cep}` : null,
    ].filter((p) => p && String(p).trim());
    return partes.length > 0 ? partes.join(' — ') : SEM_INFO;
}

/**
 * Normaliza os responsáveis para a ficha. O cadastro tem dois formatos vivos:
 * o array `responsaveis` (ficha completa) e os campos soltos `responsavel` /
 * `telefone` (cadastro antigo e importação de planilha).
 */
function responsaveisDoAluno(aluno = {}) {
    const lista = Array.isArray(aluno.responsaveis) ? aluno.responsaveis : [];
    if (lista.length > 0) {
        return lista.map((r) => ({
            nome: r.nome || SEM_INFO,
            parentesco: r.tipo || r.parentesco || SEM_INFO,
            telefone: r.telefone || r.whatsapp || SEM_INFO,
        }));
    }
    if (aluno.responsavel) {
        return [
            {
                nome: aluno.responsavel,
                parentesco: aluno.guardaLegal || SEM_INFO,
                telefone: aluno.telefone || SEM_INFO,
            },
        ];
    }
    return [];
}

const rotulo = (texto) => ({ text: texto, bold: true, fontSize: 9, color: CINZA });
const valor = (texto) => ({ text: String(texto ?? SEM_INFO), fontSize: 10, color: ESCURO });

function blocoIdentificacao(titulo, linhas) {
    return [
        { text: titulo, style: 'secao' },
        {
            table: { widths: ['auto', '*'], body: linhas.map(([r, v]) => [rotulo(r), valor(v)]) },
            layout: 'noBorders',
            margin: [0, 0, 0, 12],
        },
    ];
}

/**
 * Monta a definição pdfmake da ficha.
 *
 * @param {object} entrada
 * @param {object} entrada.aluno      documento de Aluno (`.lean()`).
 * @param {object} [entrada.escola]   documento de Escola.
 * @param {object} entrada.avaliacao  saída de `monitorEvasao.avaliarAluno`.
 * @param {object} [entrada.emitente] `{ nome, perfil }` de quem gerou — a ficha
 *   é documento oficial e precisa dizer quem a emitiu.
 * @param {Date}   [entrada.emitidoEm=new Date()]
 * @returns {object} docDefinition do pdfmake.
 */
function montarFicha({ aluno = {}, escola = {}, avaliacao = {}, emitente = {}, emitidoEm } = {}) {
    const agora = emitidoEm instanceof Date ? emitidoEm : new Date();
    const responsaveis = responsaveisDoAluno(aluno);
    const datas = Array.isArray(avaliacao.datasDeFalta) ? avaliacao.datasDeFalta : [];

    // 6 colunas de datas por linha: a lista pode passar de 50 dias e uma coluna
    // única jogaria a assinatura para a terceira página.
    const COLUNAS = 6;
    const linhasDatas = [];
    for (let i = 0; i < datas.length; i += COLUNAS) {
        const fatia = datas.slice(i, i + COLUNAS);
        while (fatia.length < COLUNAS) fatia.push(null);
        linhasDatas.push(
            fatia.map((d) =>
                d
                    ? {
                          text: `${dataBr(d.data)}${d.justificada ? ' (J)' : ''}`,
                          fontSize: 9,
                          margin: [2, 3, 2, 3],
                      }
                    : { text: '', margin: [2, 3, 2, 3] }
            )
        );
    }

    return {
        pageSize: 'A4',
        pageMargins: [40, 40, 40, 50],
        defaultStyle: { font: 'Roboto', fontSize: 10, color: ESCURO },
        styles: {
            titulo: { fontSize: 15, bold: true, alignment: 'center', margin: [0, 0, 0, 2] },
            subtitulo: { fontSize: 9, alignment: 'center', color: CINZA, margin: [0, 0, 0, 14] },
            secao: {
                fontSize: 11,
                bold: true,
                color: VERDE,
                margin: [0, 8, 0, 6],
            },
            legal: { fontSize: 8, color: CINZA, italics: true },
        },
        footer: (pagina, total) => ({
            text: `Página ${pagina} de ${total} — documento gerado eletronicamente em ${dataBr(agora)}`,
            fontSize: 7,
            color: CINZA,
            alignment: 'center',
            margin: [0, 12, 0, 0],
        }),
        content: [
            { text: 'FICHA DE COMUNICAÇÃO DE ALUNO INFREQUENTE', style: 'titulo' },
            {
                text: `${escola.nome || 'Unidade escolar'} — ${escola.municipio || ''}`.trim(),
                style: 'subtitulo',
            },

            ...blocoIdentificacao('1. Identificação do estudante', [
                ['Nome', avaliacao.nome || aluno.nome],
                ['RA / Matrícula', aluno.matricula || avaliacao.ra],
                ['Data de nascimento', dataBr(aluno.nascimento)],
                ['Turma', avaliacao.turma || aluno.turma],
                ['Endereço', enderecoTexto(aluno.endereco)],
            ]),

            { text: '2. Responsáveis legais', style: 'secao' },
            responsaveis.length > 0
                ? {
                      table: {
                          widths: ['*', 'auto', 'auto'],
                          body: [
                              [rotulo('Nome'), rotulo('Parentesco'), rotulo('Telefone')],
                              ...responsaveis.map((r) => [
                                  valor(r.nome),
                                  valor(r.parentesco),
                                  valor(r.telefone),
                              ]),
                          ],
                      },
                      layout: { hLineColor: () => BORDA, vLineColor: () => BORDA },
                      margin: [0, 0, 0, 12],
                  }
                : { text: SEM_INFO, margin: [0, 0, 0, 12] },

            ...blocoIdentificacao('3. Frequência apurada', [
                ['Ano letivo', avaliacao.anoLetivo],
                ['Dias letivos com chamada', avaliacao.diasLetivosRealizados],
                ['Dias de falta', avaliacao.faltas],
                ['Faltas justificadas', avaliacao.justificadas],
                [
                    'Frequência atual',
                    avaliacao.frequenciaPct === null || avaliacao.frequenciaPct === undefined
                        ? SEM_INFO
                        : `${avaliacao.frequenciaPct}%`,
                ],
                [
                    'Limite legal de faltas',
                    `${avaliacao.limiteFaltas} dia(s) — 25% de ${avaliacao.diasLetivosPrevistos} dias letivos`,
                ],
                ['Situação', avaliacao.rotulo],
            ]),

            { text: '4. Dias de ausência registrados', style: 'secao' },
            linhasDatas.length > 0
                ? {
                      table: { widths: Array(COLUNAS).fill('*'), body: linhasDatas },
                      layout: { hLineColor: () => BORDA, vLineColor: () => BORDA },
                      margin: [0, 0, 0, 4],
                  }
                : { text: 'Nenhuma ausência integral registrada no período.' },
            { text: '(J) = falta com justificativa registrada pela escola.', style: 'legal' },

            { text: '5. Fundamento legal', style: 'secao' },
            {
                text:
                    avaliacao.baseLegal ||
                    'LDB, art. 12, VIII e ECA, art. 56, II — dever da escola de comunicar a infrequência.',
                fontSize: 9,
            },
            {
                text:
                    'A comunicação ao Conselho Tutelar não substitui as providências pedagógicas ' +
                    'de busca ativa do estudante, que devem ser registradas pela unidade escolar.',
                style: 'legal',
                margin: [0, 4, 0, 16],
            },

            {
                columns: [
                    {
                        stack: [
                            { text: '_'.repeat(38), margin: [0, 24, 0, 2] },
                            { text: emitente.nome || 'Responsável pela emissão', fontSize: 9 },
                            {
                                text: emitente.perfil || 'Secretaria escolar',
                                fontSize: 8,
                                color: CINZA,
                            },
                        ],
                    },
                    {
                        stack: [
                            { text: '_'.repeat(38), margin: [0, 24, 0, 2] },
                            { text: 'Direção da unidade escolar', fontSize: 9 },
                            { text: escola.nome || '', fontSize: 8, color: CINZA },
                        ],
                    },
                ],
                columnGap: 24,
            },
        ],
    };
}

module.exports = { montarFicha, enderecoTexto, responsaveisDoAluno, dataBr };
