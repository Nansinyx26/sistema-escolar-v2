/**
 * Módulo de Gerenciamento de Alunos
 * CRUD de alunos e operações relacionadas
 */

import db from './db.js';
import ui from './ui.js';

class StudentManager {
    constructor() {
        this.currentTurma = null;
        this.currentBimestre = 1;
    }

    /**
     * Define a turma atual
     * @param {string} turmaId - ID da turma
     */
    setCurrentTurma(turmaId) {
        this.currentTurma = turmaId;
    }

    /**
     * Define o bimestre atual
     * @param {number} bimestre - Número do bimestre (1-4)
     */
    setCurrentBimestre(bimestre) {
        this.currentBimestre = bimestre;
    }

    /**
     * Busca todos os alunos de uma turma
     * @param {string} turmaId - ID da turma
     * @returns {Promise<Array>}
     */
    async getByTurma(turmaId) {
        try {
            const alunos = await db.getByIndex('alunos', 'turmaId', turmaId);
            return alunos.filter(a => a.ativo !== false).sort((a, b) =>
                a.nome.localeCompare(b.nome, 'pt-BR')
            );
        } catch (error) {
            console.error('Erro ao buscar alunos:', error);
            return [];
        }
    }

    /**
     * Busca um aluno por ID
     * @param {number} id - ID do aluno
     * @returns {Promise<Object|null>}
     */
    async getById(id) {
        try {
            return await db.get('alunos', id);
        } catch (error) {
            console.error('Erro ao buscar aluno:', error);
            return null;
        }
    }

    /**
     * Busca todos os alunos
     * @returns {Promise<Array>}
     */
    async getAll() {
        try {
            const alunos = await db.getAll('alunos');
            return alunos.filter(a => a.ativo !== false);
        } catch (error) {
            console.error('Erro ao buscar todos alunos:', error);
            return [];
        }
    }

    /**
     * Adiciona um novo aluno
     * @param {Object} alunoData - Dados do aluno
     * @returns {Promise<number>} ID do aluno criado
     */
    async add(alunoData) {
        try {
            // Validação básica
            if (!alunoData.nome || !alunoData.turmaId) {
                throw new Error('Nome e turma são obrigatórios');
            }

            // Gera matrícula se não fornecida
            if (!alunoData.matricula) {
                alunoData.matricula = await this.generateMatricula();
            }

            // Define valores padrão
            const aluno = {
                nome: alunoData.nome.trim(),
                turmaId: alunoData.turmaId,
                matricula: alunoData.matricula,
                dataNascimento: alunoData.dataNascimento || '',
                responsavel: alunoData.responsavel || '',
                telefone: alunoData.telefone || '',
                email: alunoData.email || '',
                endereco: alunoData.endereco || '',
                observacoes: alunoData.observacoes || '',
                deficiencia: alunoData.deficiencia || '',
                foto: alunoData.foto || '',
                ativo: true,
                observacoesBimestre: {},
                nivelBimestre: {},
                faltasBimestre: {},
                createdAt: new Date().toISOString()
            };

            const id = await db.add('alunos', aluno);
            ui.success('Aluno cadastrado com sucesso!');
            return id;
        } catch (error) {
            console.error('Erro ao adicionar aluno:', error);
            ui.error('Erro ao cadastrar aluno: ' + error.message);
            throw error;
        }
    }

    /**
     * Atualiza dados de um aluno
     * @param {Object} alunoData - Dados do aluno (deve incluir id)
     * @returns {Promise<void>}
     */
    async update(alunoData) {
        try {
            const id = alunoData.id || alunoData._id;
            if (!id) {
                throw new Error('ID do aluno é obrigatório');
            }

            // Não precisamos carregar o aluno novamente aqui se já temos os dados,
            // o backend fará o merge/update.
            const aluno = {
                ...alunoData,
                updatedAt: new Date().toISOString()
            };

            const result = await db.update('alunos', aluno);
            if (!result) throw new Error('Falha ao atualizar no banco de dados');

            ui.success('Aluno atualizado com sucesso!');
            return result;
        } catch (error) {
            console.error('Erro ao atualizar aluno:', error);
            ui.error('Erro ao atualizar aluno: ' + error.message);
            throw error;
        }
    }

    /**
     * Remove um aluno permanentemente
     * @param {string} id - ID do aluno
     * @returns {Promise<void>}
     */
    async delete(id) {
        try {
            const aluno = await this.getById(id);
            if (!aluno) {
                throw new Error('Aluno não encontrado');
            }

            // Hard delete - remove permanentemente do banco
            await db.delete('alunos', id);
            console.log('✅ Aluno removido do banco:', id);

        } catch (error) {
            console.error('Erro ao remover aluno:', error);
            throw error;
        }
    }

    /**
     * Gera matrícula única
     * @returns {Promise<string>}
     */
    async generateMatricula() {
        const ano = new Date().getFullYear();
        const alunos = await db.getAll('alunos');
        const maxNum = alunos.reduce((max, a) => {
            const num = parseInt(a.matricula?.slice(-3) || '0');
            return num > max ? num : max;
        }, 0);

        return `${ano}${String(maxNum + 1).padStart(3, '0')}`;
    }

    /**
     * Transfere aluno para outra turma
     * @param {number} alunoId - ID do aluno
     * @param {string} novaTurmaId - ID da nova turma
     * @returns {Promise<void>}
     */
    async transferir(alunoId, novaTurmaId) {
        try {
            const aluno = await this.getById(alunoId);
            if (!aluno) {
                throw new Error('Aluno não encontrado');
            }

            aluno.turmaId = novaTurmaId;
            aluno.transferidoEm = new Date().toISOString();

            await db.update('alunos', aluno);
            ui.success('Aluno transferido com sucesso!');
        } catch (error) {
            console.error('Erro ao transferir aluno:', error);
            ui.error('Erro ao transferir aluno: ' + error.message);
            throw error;
        }
    }

    /**
     * Atualiza foto do aluno
     * @param {number} alunoId - ID do aluno
     * @param {string} fotoBase64 - Foto em base64
     * @returns {Promise<void>}
     */
    async updateFoto(alunoId, fotoBase64) {
        try {
            const aluno = await this.getById(alunoId);
            if (!aluno) {
                throw new Error('Aluno não encontrado');
            }

            aluno.foto = fotoBase64;
            await db.update('alunos', aluno);
        } catch (error) {
            console.error('Erro ao atualizar foto:', error);
            throw error;
        }
    }

    /**
     * Busca alunos com filtro
     * @param {Object} filters - Filtros de busca
     * @returns {Promise<Array>}
     */
    async search(filters = {}) {
        try {
            let alunos = await this.getAll();

            if (filters.nome) {
                const termo = filters.nome.toLowerCase();
                alunos = alunos.filter(a =>
                    a.nome.toLowerCase().includes(termo)
                );
            }

            if (filters.turmaId) {
                alunos = alunos.filter(a => a.turmaId === filters.turmaId);
            }

            if (filters.deficiencia) {
                alunos = alunos.filter(a =>
                    a.deficiencia && a.deficiencia.toLowerCase().includes(filters.deficiencia.toLowerCase())
                );
            }

            return alunos;
        } catch (error) {
            console.error('Erro na busca:', error);
            return [];
        }
    }

    /**
     * Conta alunos por turma
     * @returns {Promise<Object>}
     */
    async countByTurma() {
        try {
            const alunos = await this.getAll();
            const count = {};

            alunos.forEach(aluno => {
                if (!count[aluno.turmaId]) {
                    count[aluno.turmaId] = 0;
                }
                count[aluno.turmaId]++;
            });

            return count;
        } catch (error) {
            console.error('Erro ao contar alunos:', error);
            return {};
        }
    }

    /**
     * Retorna estatísticas gerais
     * @returns {Promise<Object>}
     */
    async getStats() {
        try {
            const alunos = await this.getAll();
            const countByTurma = await this.countByTurma();

            return {
                total: alunos.length,
                porTurma: countByTurma,
                comDeficiencia: alunos.filter(a => a.deficiencia).length,
                turmasAtivas: Object.keys(countByTurma).length
            };
        } catch (error) {
            console.error('Erro ao obter estatísticas:', error);
            return { total: 0, porTurma: {}, comDeficiencia: 0, turmasAtivas: 0 };
        }
    }
}

// Exporta instância única
const students = new StudentManager();
export default students;
