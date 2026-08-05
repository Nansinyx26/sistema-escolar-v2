const mongoose = require('mongoose');
const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');
const Falta = require('../models/Falta');
const Relatorio = require('../models/Relatorio');
const Usuario = require('../models/Usuario');
const Nota = require('../models/Nota');
const Config = require('../models/Config');


class MigrationService {
    async migrateData(data) {
        const results = {};

        // Mapeamento: chave do JSON -> Model Mongoose
        const mappings = {
            alunos: Aluno,
            professores: Professor,
            turmas: Turma,
            faltas: Falta,
            relatorios: Relatorio,
            usuarios: Usuario,
            notas: Nota,
            config: Config
        };

        for (const [key, items] of Object.entries(data)) {
            if (!mappings[key]) {
                console.warn(`Skipping unknown collection: ${key}`);
                continue;
            }

            const Model = mappings[key];
            let count = 0;
            let updated = 0;

            // Se items for objeto único (não array), encapsula em array
            const itemsToProcess = Array.isArray(items) ? items : [items];

            for (const item of itemsToProcess) {

                // Tenta encontrar e atualizar ou criar
                // Critério de unicidade: id (legacy) ou _id
                const criteria = [];
                if (item.id) criteria.push({ id: item.id });
                if (item._id) criteria.push({ _id: item._id });
                if (item.matricula && key === 'alunos') criteria.push({ matricula: item.matricula });

                let result;
                if (criteria.length > 0) {
                    // Usar $or pode ser perigoso se diferentes critérios baterem em diferentes docs.
                    // Melhor priorizar: _id > id > unique_field
                    let query = null;
                    if (item._id && await Model.exists({ _id: item._id })) query = { _id: item._id };
                    else if (item.id && await Model.exists({ id: item.id })) query = { id: item.id };
                    else if (item.matricula && key === 'alunos') query = { matricula: item.matricula };

                    if (query) {
                        await Model.updateOne(query, item);
                        updated++;
                        continue; // proximo
                    }
                }

                // Se chego aqui, é insert
                try {
                    await Model.create(item);
                    count++;
                } catch (e) {
                    console.error(`Erro importando ${key} item ${item.id || '?'}: ${e.message}`);
                }
            }
            results[key] = { inserted: count, updated };
        }

        return results;
    }
}

module.exports = new MigrationService();
