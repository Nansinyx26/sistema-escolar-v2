/**
 * Módulo de Gerenciamento de Notas
 * CRUD de notas e cálculos de médias
 */

import db from './db.js';
import ui from './ui.js';

class NotesManager {
    constructor() {
        this.currentAlunoId = null;
    }

    /**
     * Define o aluno atual
     * @param {number} alunoId - ID do aluno
     */
    setCurrentAluno(alunoId) {
        this.currentAlunoId = alunoId;
    }

    /**
     * Busca todas as notas de um aluno
     * @param {number} alunoId - ID do aluno
     * @returns {Promise<Array>}
     */
    async getByAluno(alunoId) {
        try {
            return await db.getByIndex('notas', 'alunoId', alunoId);
        } catch (error) {
            console.error('Erro ao buscar notas do aluno:', error);
            return [];
        }
    }

    /**
     * Busca notas de um aluno por matéria
     * @param {number} alunoId - ID do aluno
     * @param {string} materiaId - ID da matéria
     * @returns {Promise<Array>}
     */
    async getByAlunoMateria(alunoId, materiaId) {
        try {
            const notas = await this.getByAluno(alunoId);
            return notas.filter(n => n.materiaId === materiaId);
        } catch (error) {
            console.error('Erro ao buscar notas:', error);
            return [];
        }
    }

    /**
     * Busca notas de um aluno por bimestre
     * @param {number} alunoId - ID do aluno
     * @param {number} bimestre - Número do bimestre
     * @returns {Promise<Array>}
     */
    async getByAlunoBimestre(alunoId, bimestre) {
        try {
            const notas = await this.getByAluno(alunoId);
            return notas.filter(n => n.bimestre === bimestre);
        } catch (error) {
            console.error('Erro ao buscar notas do bimestre:', error);
            return [];
        }
    }

    /**
     * Busca notas de uma turma
     * @param {string} turmaId - ID da turma
     * @returns {Promise<Array>}
     */
    async getByTurma(turmaId) {
        try {
            return await db.getByIndex('notas', 'turmaId', turmaId);
        } catch (error) {
            console.error('Erro ao buscar notas da turma:', error);
            return [];
        }
    }

    /**
     * Busca todas as notas
     * @returns {Promise<Array>}
     */
    async getAll() {
        try {
            return await db.getAll('notas');
        } catch (error) {
            console.error('Erro ao buscar todas as notas:', error);
            return [];
        }
    }

    /**
     * Adiciona uma nova nota
     * @param {Object} notaData - Dados da nota
     * @returns {Promise<number>} ID da nota criada
     */
    async add(notaData) {
        try {
            // Validação
            if (!notaData.alunoId || !notaData.turmaId || !notaData.materiaId) {
                throw new Error('Aluno, turma e matéria são obrigatórios');
            }

            if (notaData.nota < 0 || notaData.nota > 10) {
                throw new Error('Nota deve estar entre 0 e 10');
            }

            // Busca nome do aluno para salvar junto
            let nomeAluno = notaData.nomeAluno || '';
            if (!nomeAluno) {
                try {
                    const aluno = await db.get('alunos', notaData.alunoId);
                    nomeAluno = aluno?.nome || '';
                } catch (e) {
                    console.warn('Não conseguiu buscar nome do aluno:', e);
                }
            }

            const nota = {
                alunoId: notaData.alunoId,
                nomeAluno: nomeAluno,
                turmaId: notaData.turmaId,
                materiaId: notaData.materiaId,
                materiaNome: notaData.materiaNome || notaData.materiaId,
                bimestre: notaData.bimestre || 1,
                tipo: notaData.tipo || 'prova',
                descricao: notaData.descricao || '',
                nota: parseFloat(notaData.nota),
                peso: notaData.peso || 1,
                data: notaData.data || new Date().toISOString().split('T')[0],
                createdAt: new Date().toISOString()
            };

            const id = await db.add('notas', nota);
            ui.success('Nota adicionada com sucesso!');
            return id;
        } catch (error) {
            console.error('Erro ao adicionar nota:', error);
            ui.error('Erro ao adicionar nota: ' + error.message);
            throw error;
        }
    }

    /**
     * Atualiza uma nota
     * @param {Object} notaData - Dados da nota (deve incluir id)
     * @returns {Promise<void>}
     */
    async update(notaData) {
        try {
            if (!notaData.id) {
                throw new Error('ID da nota é obrigatório');
            }

            const existing = await db.get('notas', notaData.id);
            if (!existing) {
                throw new Error('Nota não encontrada');
            }

            const nota = {
                ...existing,
                ...notaData,
                updatedAt: new Date().toISOString()
            };

            await db.update('notas', nota);
            ui.success('Nota atualizada com sucesso!');
        } catch (error) {
            console.error('Erro ao atualizar nota:', error);
            ui.error('Erro ao atualizar nota: ' + error.message);
            throw error;
        }
    }

    /**
     * Remove uma nota
     * @param {number} id - ID da nota
     * @returns {Promise<void>}
     */
    async delete(id) {
        try {
            await db.delete('notas', id);
            ui.success('Nota removida com sucesso!');
        } catch (error) {
            console.error('Erro ao remover nota:', error);
            ui.error('Erro ao remover nota: ' + error.message);
            throw error;
        }
    }

    /**
     * Calcula média ponderada de notas
     * @param {Array} notas - Lista de notas
     * @returns {number|null}
     */
    calcularMedia(notas) {
        if (!notas || notas.length === 0) return null;

        let somaPonderada = 0;
        let somaPesos = 0;

        notas.forEach(n => {
            somaPonderada += n.nota * (n.peso || 1);
            somaPesos += (n.peso || 1);
        });

        return somaPesos > 0 ? somaPonderada / somaPesos : null;
    }

    /**
     * Calcula média de um aluno em uma matéria
     * @param {number} alunoId - ID do aluno
     * @param {string} materiaId - ID da matéria
     * @param {number} bimestre - Bimestre (opcional)
     * @returns {Promise<number|null>}
     */
    async getMediaAlunoMateria(alunoId, materiaId, bimestre = null, preloadedNotas = null) {
        let notas = preloadedNotas 
            ? preloadedNotas.filter(n => n.alunoId === alunoId && n.materiaId === materiaId) 
            : await this.getByAlunoMateria(alunoId, materiaId);

        if (bimestre) {
            notas = notas.filter(n => n.bimestre === bimestre);
        }

        return this.calcularMedia(notas);
    }

    /**
     * Calcula média geral de um aluno (Média das Médias por Matéria)
     * @param {number} alunoId - ID do aluno
     * @param {number} bimestre - Bimestre (opcional)
     * @returns {Promise<number|null>}
     */
    async getMediaGeralAluno(alunoId, bimestre = null, preloadedNotas = null) {
        // Implementation based on: (media_sala + media_artes + media_ingles + media_ef + media_sebrae) / count
        try {
            const notas = preloadedNotas ? preloadedNotas.filter(n => n.alunoId === alunoId) : await this.getByAluno(alunoId);
            const materias = db.getMaterias(); // Gets all registered subjects
            let somaMedias = 0;
            let contadorMaterias = 0;

            for (const materia of materias) {
                // Filter notes for this subject and bimestre
                let notasMateria = notas.filter(n => n.materiaId === materia.id);
                if (bimestre) {
                    notasMateria = notasMateria.filter(n => n.bimestre === bimestre);
                }

                const mediaMateria = this.calcularMedia(notasMateria);

                if (mediaMateria !== null) {
                    somaMedias += mediaMateria;
                    contadorMaterias++;
                }
            }

            return contadorMaterias > 0 ? somaMedias / contadorMaterias : null;

        } catch (error) {
            console.error('Erro ao calcular média geral consolidada:', error);
            return null;
        }
    }

    /**
     * Calcula média apenas da Sala Principal (excluindo matérias especiais)
     * @param {number} alunoId - ID do aluno
     * @param {number} bimestre - Bimestre
     * @returns {Promise<number|null>}
     */
    async getMediaSalaPrincipal(alunoId, bimestre = null, preloadedNotas = null) {
        try {
            let notas = preloadedNotas ? preloadedNotas.filter(n => n.alunoId === alunoId) : await this.getByAluno(alunoId);
            const materiasEspeciais = ['Artes', 'Inglês', 'Educação Física', 'SEBRAE', 'Oficina de Leitura'];

            // Filtra notas que NÍO são de matérias especiais
            notas = notas.filter(n => !materiasEspeciais.includes(n.materiaNome) && !materiasEspeciais.includes(n.materiaId)); // Verify property usage

            if (bimestre) {
                notas = notas.filter(n => n.bimestre === bimestre);
            }

            return this.calcularMedia(notas);
        } catch (error) {
            console.error('Erro ao calcular média sala principal:', error);
            return null;
        }
    }

    /**
     * Obtém boletim completo de um aluno
     * @param {number} alunoId - ID do aluno
     * @returns {Promise<Object>}
     */
    async getBoletim(alunoId) {
        try {
            const notas = await this.getByAluno(alunoId);
            const materias = db.getMaterias();
            const bimestres = [1, 2, 3, 4];

            const boletim = {};

            materias.forEach(materia => {
                boletim[materia.id] = {
                    nome: materia.nome,
                    icone: materia.icone,
                    bimestres: {}
                };

                bimestres.forEach(bim => {
                    const notasBim = notas.filter(
                        n => n.materiaId === materia.id && n.bimestre === bim
                    );

                    boletim[materia.id].bimestres[bim] = {
                        notas: notasBim,
                        media: this.calcularMedia(notasBim)
                    };
                });

                // Média anual
                const todasNotas = notas.filter(n => n.materiaId === materia.id);
                boletim[materia.id].mediaAnual = this.calcularMedia(todasNotas);
            });

            return boletim;
        } catch (error) {
            console.error('Erro ao gerar boletim:', error);
            return {};
        }
    }

    /**
     * Obtém estatísticas de uma turma
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre (opcional)
     * @returns {Promise<Object>}
     */
    async getStatsTurma(turmaId, bimestre = null) {
        try {
            let notas = await this.getByTurma(turmaId);

            if (bimestre) {
                notas = notas.filter(n => n.bimestre === bimestre);
            }

            if (notas.length === 0) {
                return {
                    totalNotas: 0,
                    media: null,
                    maior: null,
                    menor: null,
                    aprovados: 0,
                    reprovados: 0
                };
            }

            const valores = notas.map(n => n.nota);

            return {
                totalNotas: notas.length,
                media: this.calcularMedia(notas),
                maior: Math.max(...valores),
                menor: Math.min(...valores),
                aprovados: notas.filter(n => n.nota >= 6).length,
                reprovados: notas.filter(n => n.nota < 6).length
            };
        } catch (error) {
            console.error('Erro ao obter estatísticas da turma:', error);
            return { totalNotas: 0, media: null };
        }
    }

    /**
     * Obtém ranking de alunos de uma turma
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre (opcional)
     * @returns {Promise<Array>}
     */
    async getRankingTurma(turmaId, bimestre = null) {
        try {
            const notas = await this.getByTurma(turmaId);
            const alunosNotas = {};

            notas.forEach(nota => {
                if (bimestre && nota.bimestre !== bimestre) return;

                if (!alunosNotas[nota.alunoId]) {
                    alunosNotas[nota.alunoId] = [];
                }
                alunosNotas[nota.alunoId].push(nota);
            });

            const ranking = Object.entries(alunosNotas).map(([alunoId, notasAluno]) => ({
                alunoId: parseInt(alunoId),
                media: this.calcularMedia(notasAluno),
                totalNotas: notasAluno.length
            }));

            return ranking.sort((a, b) => (b.media || 0) - (a.media || 0));
        } catch (error) {
            console.error('Erro ao gerar ranking:', error);
            return [];
        }
    }

    /**
     * Obtém notas agrupadas por matéria
     * @param {number} alunoId - ID do aluno
     * @returns {Promise<Object>}
     */
    async getNotasAgrupadasPorMateria(alunoId) {
        try {
            const notas = await this.getByAluno(alunoId);
            const materias = db.getMaterias();
            const agrupadas = {};

            materias.forEach(materia => {
                const notasMateria = notas.filter(n => n.materiaId === materia.id);
                agrupadas[materia.id] = {
                    materia: materia,
                    notas: notasMateria,
                    media: this.calcularMedia(notasMateria)
                };
            });

            return agrupadas;
        } catch (error) {
            console.error('Erro ao agrupar notas:', error);
            return {};
        }
    }
}

// Exporta instância única
const notes = new NotesManager();
export default notes;
