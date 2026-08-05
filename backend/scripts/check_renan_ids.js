
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

// Schemas simplificados para leitura
const UserSchema = new mongoose.Schema({}, { strict: false });
const TeacherSchema = new mongoose.Schema({}, { strict: false, collection: 'perfil_professores' });

const User = mongoose.model('User', UserSchema);
const Teacher = mongoose.model('Teacher', TeacherSchema);

async function checkIds() {
    try {
        console.log('Conectando ao MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Conectado.');

        const emailAlvo = 'renanprof@escola.com';

        console.log(`\n--- Buscando Usuário (Login) para: ${emailAlvo} ---`);
        const user = await User.findOne({ email: emailAlvo });
        if (user) {
            console.log('USUÁRIO ENCONTRADO:');
            console.log(`_id: ${user._id}`);
            console.log(`nome: ${user.nome}`);
            console.log(`email: ${user.email}`);
            console.log(`perfil: ${user.perfil}`);
        } else {
            console.log('USUÁRIO NÍO ENCONTRADO.');
        }

        console.log(`\n--- Buscando Professor (Perfil) para: ${emailAlvo} ---`);
        // Busca por email ou nome similar
        const teacherByEmail = await Teacher.findOne({ email: emailAlvo });

        if (teacherByEmail) {
            console.log('PROFESSOR ENCONTRADO (por email):');
            console.log(`_id: ${teacherByEmail._id}`);
            console.log(`nome: ${teacherByEmail.nome}`);
            console.log(`idUsuario (se houver): ${teacherByEmail.idUsuario}`);
        } else {
            console.log('PROFESSOR NÍO ENCONTRADO por email.');
        }

        // Tentar buscar por nome se não achou por email
        if (!teacherByEmail && user) {
            const teacherByName = await Teacher.findOne({ nome: user.nome });
            if (teacherByName) {
                console.log('PROFESSOR ENCONTRADO (por nome):');
                console.log(`_id: ${teacherByName._id}`);
                console.log(`nome: ${teacherByName.nome}`);
                console.log(`email: ${teacherByName.email}`);
            }
        }

        console.log('\n-----------------------------------');
        if (user && teacherByEmail) {
            if (user._id.toString() !== teacherByEmail._id.toString()) {
                console.log('⚠️ ATENÇÍO: Os IDs de Usuário e Professor SÍO DIFERENTES.');
                console.log(`User ID:    ${user._id}`);
                console.log(`Teacher ID: ${teacherByEmail._id}`);
                console.log('A Grade Horária deve ser salva usando o TEACHER ID.');
            } else {
                console.log('✅ Os IDs são iguais.');
            }
        }

    } catch (error) {
        console.error('Erro:', error);
    } finally {
        await mongoose.connection.close();
        process.exit();
    }
}

checkIds();
