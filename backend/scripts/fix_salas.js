/**
 * fix_salas.js - Corrige o formato das salas no banco 'test'
 * Remove o caractere 'º' dos campos salaPrincipal para alinhar com os IDs das turmas
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
    const uri = process.env.MONGODB_URI;
    console.log('Conectando ao banco:', uri.includes('/test?') ? 'test ✅' : uri);
    await mongoose.connect(uri);
    const db = mongoose.connection.db;

    // Busca todos os professores com salaPrincipal contendo 'º'
    const profs = await db.collection('professores').find({
        salaPrincipal: { $regex: 'º', $options: 'i' }
    }).toArray();

    console.log(`\nEncontrados ${profs.length} professor(es) com 'º' na sala principal:`);

    for (const prof of profs) {
        const novoNome = prof.salaPrincipal.replace(/º/g, '').trim();
        console.log(`  ${prof.nome}: "${prof.salaPrincipal}" → "${novoNome}"`);
        await db.collection('professores').updateOne(
            { _id: prof._id },
            { $set: { salaPrincipal: novoNome } }
        );
    }

    // Também corrige salasAdicionais
    const profsAdic = await db.collection('professores').find({
        salasAdicionais: { $elemMatch: { $regex: 'º' } }
    }).toArray();

    for (const prof of profsAdic) {
        const novasAdic = prof.salasAdicionais.map(s => s.replace(/º/g, '').trim());
        console.log(`  ${prof.nome} adicionais: ${JSON.stringify(prof.salasAdicionais)} → ${JSON.stringify(novasAdic)}`);
        await db.collection('professores').updateOne(
            { _id: prof._id },
            { $set: { salasAdicionais: novasAdic } }
        );
    }

    // Verifica resultado final
    console.log('\n✅ Resultado final (professores):');
    const todos = await db.collection('professores').find({}).toArray();
    todos.forEach(p => console.log(`  ${p.nome}: sala="${p.salaPrincipal}"`));

    await mongoose.disconnect();
    console.log('\n🎉 Correção concluída!');
}

run().catch(err => { console.error('❌ Erro:', err); process.exit(1); });
