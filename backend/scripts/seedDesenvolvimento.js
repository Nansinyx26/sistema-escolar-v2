#!/usr/bin/env node
/**
 * seedDesenvolvimento.js — popula o banco de DESENVOLVIMENTO com dados falsos.
 *
 * POR QUE NÃO COPIAR PRODUÇÃO
 * ---------------------------
 * O caminho tentador seria clonar o banco real para ter dados "de verdade".
 * Não dá: são nome, RA e data de nascimento de crianças. Copiar isso para um
 * ambiente com menos cuidado multiplica a superfície de exposição de um dado
 * que a LGPD trata como sensível — e o ganho seria só conveniência.
 *
 * Tudo aqui é inventado. Os RAs usam a faixa 90000000xxxx, que não corresponde
 * a nenhuma numeração emitida pela SEDUC.
 *
 * SEGURANÇA: o script RECUSA rodar se detectar que o alvo é o banco de
 * produção. Ele grava e apaga dados — apontá-lo para o lugar errado seria a
 * pior forma possível de descobrir que a configuração estava trocada.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { resumirUri, formatarResumo } = require('../src/utils/alvoBanco');

/**
 * Bancos que este script NUNCA pode tocar.
 *
 * `test` é o nome do banco de produção deste projeto (e, por azar, também o
 * padrão do MongoDB — ver Issue #60). A lista existe porque a consequência de
 * errar aqui é apagar dado real de aluno.
 */
const BANCOS_PROIBIDOS = new Set(['test', 'admin', 'local', 'config']);

const NOMES = [
    'ANA CLARA FICTICIA DE SOUZA', 'BRUNO INVENTADO LIMA', 'CAMILA IMAGINARIA MOISÉS',
    'DANIEL SUPOSTO ARAÚJO', 'ELISA HIPOTETICA RAMOS', 'FABIO SIMULADO NUNES',
    'GABRIELA TESTADA PEREIRA', 'HENRIQUE MODELO CARDOSO', 'ISABELA EXEMPLO VIEIRA',
    'JOAO PEDRO AMOSTRA LOPES', 'KARINA PROTOTIPO DIAS', 'LUCAS RASCUNHO MENDES',
    'MARIA DAS DORES ENSAIO', 'NATALIA ESBOCO TAVARES', 'OTAVIO PLACEBO ROCHA',
    'PAULA REFERENCIA BRAGA', 'QUEZIA SINTETICA MELO', 'RAFAEL DEMONSTRA PINTO',
    'SOFIA VALIDACAO CUNHA', 'THIAGO VINÍCIUS DE ARAÚJO RIBEIRO', 'ULISSES FIGURADO SALES',
    'VANESSA APOCRIFA NEVES', 'WAGNER ARBITRARIO FARIA', 'XENIA POSTICA GOMES',
    'YASMIN ALEGORICA DUARTE', 'ZECA ILUSTRATIVO BORGES', 'ALICE PARADIGMA REIS',
    'BERNARDO ESQUEMA COSTA', 'CECILIA MAQUETE ALVES', 'DIOGO CENARIO BATISTA',
];

const ANO_LETIVO = new Date().getFullYear();

function raSintetico(n) {
    return `90000000${String(n).padStart(4, '0')}`;
}

async function main() {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME;

    if (!uri) {
        console.error('❌ MONGODB_URI não definida. Configure backend/.env.');
        process.exit(2);
    }

    const { host, banco } = resumirUri(uri);
    const alvo = dbName || banco || '';
    console.log(formatarResumo({ alvo: 'desenvolvimento', host, banco: alvo || '(padrão)' }));

    if (BANCOS_PROIBIDOS.has(alvo)) {
        console.error(`❌ Recusando rodar: "${alvo}" é banco de produção ou de sistema.`);
        console.error('   Este script só popula banco de desenvolvimento (ex.: escola_dev).');
        console.error('   Ajuste MONGODB_DB_NAME em backend/.env. Ver Issue #60.\n');
        process.exit(1);
    }

    await mongoose.connect(uri, dbName ? { dbName } : {});

    const Escola = require('../src/models/Escola');
    const Turma = require('../src/models/Turma');
    const Aluno = require('../src/models/Aluno');
    const Matricula = require('../src/models/Matricula');

    // Idempotente: recria só o que este script cria, identificado pelo código.
    const CODIGO = 'DEV-SEED-0001';
    const anterior = await Escola.findOne({ codigoSecreto: CODIGO }).lean();
    if (anterior) {
        const escolaId = String(anterior._id);
        await Matricula.deleteMany({ escolaId });
        await Aluno.deleteMany({ escolaId });
        await Turma.deleteMany({ escolaId });
        await Escola.deleteOne({ _id: anterior._id });
        console.log('  … dados do seed anterior removidos');
    }

    const escola = await Escola.create({
        nome: 'EE Modelo de Desenvolvimento',
        tipo: 'EMEF',
        bairro: 'Centro',
        codigoSecreto: CODIGO,
        ativo: true,
    });
    const escolaId = String(escola._id);

    const turmas = [];
    for (const nome of ['5A', '5B', '9A']) {
        turmas.push(await Turma.create({ id: nome, nome, ano: ANO_LETIVO, escolaId, ativo: true }));
    }

    let criados = 0;
    for (let i = 0; i < NOMES.length; i++) {
        const turma = turmas[i % turmas.length];
        const aluno = new Aluno({
            escolaId,
            nome: NOMES[i],
            matricula: raSintetico(i + 1),
            raDigito: (i + 1) % 3 === 0 ? 'X' : String((i + 1) % 10),
            raUf: 'SP',
            nascimento: new Date(Date.UTC(2014, i % 12, (i % 27) + 1, 12)),
            situacao: 'ativo',
            origemCadastro: 'manual',
            turma: turma.nome,
            turmaId: String(turma._id),
            ativo: true,
        });
        await aluno.save(); // pre-save gera nomeNormalizado e codigoSecreto

        await Matricula.create({
            escolaId,
            alunoId: String(aluno._id),
            turmaId: String(turma._id),
            anoLetivo: ANO_LETIVO,
            numeroChamada: Math.floor(i / turmas.length) + 1,
            serie: turma.nome[0],
            status: 'cursando',
        });
        criados++;
    }

    console.log(`\n✅ Seed concluído em "${alvo}"`);
    console.log(`   escola : ${escola.nome}`);
    console.log(`   turmas : ${turmas.map((t) => t.nome).join(', ')}`);
    console.log(`   alunos : ${criados} (todos fictícios)\n`);

    await mongoose.disconnect();
}

main().catch(async (erro) => {
    console.error('❌ Falha no seed:', erro.message);
    try { await mongoose.disconnect(); } catch { /* já desconectado */ }
    process.exit(1);
});
