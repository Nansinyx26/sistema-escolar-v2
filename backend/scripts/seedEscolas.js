/**
 * Seed das escolas municipais de Americana/SP.
 *
 * - Idempotente: busca por nome antes de inserir (nunca duplica).
 * - Todas nascem com ativo:false (cadeado no modal), EXCETO a escola
 *   Jaguari (CIEP Profª Maria Nilde Mascellani), que é a escola já em
 *   operação — apenas garantimos ativo:true, sem recriar dados.
 * - Cada escola recebe um codigoSecreto próprio (cadastro por escola).
 *
 * Uso: node scripts/seedEscolas.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI não definida no .env — abortando.');
    process.exit(1);
}

const Escola = require('../src/models/Escola');

// Nome oficial da escola já em operação ("Escola Jaguari")
const ESCOLA_JAGUARI = 'CIEP Profª Maria Nilde Mascellani';

const ESCOLAS = [
    // EMEFs
    { nome: 'EMEF Darcy Ribeiro', tipo: 'EMEF', endereco: 'Rua da Igualdade, 65', bairro: 'Jardim da Paz' },
    { nome: 'EMEF Profª Florestan Fernandes', tipo: 'EMEF', endereco: 'Rua Japão, 701', bairro: 'Morada do Sol' },
    { nome: 'EMEF Profº Jonas Corrêa de Arruda Filho', tipo: 'EMEF', endereco: 'Rua João Bernestein, 601', bairro: 'Vila Margarida' },
    { nome: 'EMEF Paulo Freire', tipo: 'EMEF', endereco: 'Rua Jales, 61', bairro: 'Parque Novo Mundo' },
    // CIEPs
    { nome: 'CIEP Prof. Octávio Cesar Borghi', tipo: 'CIEP', endereco: '', bairro: 'Cidade Jardim' },
    { nome: 'CIEP Profª Oniva de Moura Brizola', tipo: 'CIEP', endereco: '', bairro: 'Antônio Zanaga' },
    { nome: ESCOLA_JAGUARI, tipo: 'CIEP', endereco: '', bairro: 'Residencial Jaguari' },
    { nome: 'CIEP Prof. Anísio Spínola Teixeira', tipo: 'CIEP', endereco: '', bairro: 'Parque São Jerônimo' },
    { nome: 'CIEP Profª Philomena Magaly Makluf Rossetti', tipo: 'CIEP', endereco: '', bairro: 'Americana/SP' },
];

function gerarCodigo(length = 10) {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    for (let i = 0; i < length; i++) code += charset[crypto.randomInt(charset.length)];
    return code;
}

async function main() {
    await mongoose.connect(MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || undefined });
    console.log('✅ Conectado ao MongoDB');

    let criadas = 0, existentes = 0;

    for (const dados of ESCOLAS) {
        const isJaguari = dados.nome === ESCOLA_JAGUARI;
        const existente = await Escola.findOne({ nome: dados.nome }).select('+codigoSecreto');

        if (existente) {
            existentes++;
            // Jaguari: garante ativo:true sem tocar no resto
            if (isJaguari && !existente.ativo) {
                existente.ativo = true;
                await existente.save();
                console.log(`🔓 "${dados.nome}" marcada como ativa.`);
            } else {
                console.log(`⏭️  "${dados.nome}" já existe — ignorada.`);
            }
            continue;
        }

        await Escola.create({
            ...dados,
            municipio: 'Americana',
            codigoSecreto: gerarCodigo(),
            ativo: isJaguari // só a Jaguari nasce desbloqueada
        });
        criadas++;
        console.log(`✨ Criada: ${dados.nome} (${dados.tipo})${isJaguari ? ' [ATIVA]' : ' [bloqueada]'}`);
    }

    console.log(`\n📊 Resumo: ${criadas} criada(s), ${existentes} já existente(s), total esperado ${ESCOLAS.length}.`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('❌ Erro no seed:', err);
    process.exit(1);
});
