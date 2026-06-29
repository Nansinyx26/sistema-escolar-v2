/**
 * Grade Service
 * Gerencia a grade horária fixa dos professores e validações
 * (Mock Data temporário)
 */

class GradeService {
    constructor() {
        // Mock Data: Horários fixos por professor
        // Formato: professorId -> { diaSemana (0-6) -> [ { inicio, fim, turma, materia } ] }
        this.gradeFixa = {
            // Exemplo: João Professor (prof001)
            // Segunda: 1A (07:00-08:40), 1B (08:40-10:20)
            'prof001': {
                1: [ // Segunda
                    { inicio: '07:00', fim: '08:40', turma: '1A', materia: 'Sala Principal' },
                    { inicio: '08:40', fim: '10:20', turma: '1B', materia: 'Sala Principal' }
                ],
                2: [ // Terça
                    { inicio: '07:00', fim: '08:40', turma: '1A', materia: 'Sala Principal' },
                    { inicio: '10:40', fim: '12:20', turma: '1B', materia: 'Sala Principal' }
                ],
                3: [ // Quarta
                    { inicio: '07:00', fim: '12:00', turma: '1A', materia: 'Sala Principal' }
                ],
                4: [ // Quinta
                    { inicio: '07:00', fim: '12:00', turma: '1B', materia: 'Sala Principal' }
                ],
                5: [ // Sexta
                    { inicio: '07:00', fim: '12:00', turma: '1A', materia: 'Sala Principal' }
                ]
            },
            // Exemplo: Ana Inglês (prof002)
            'prof002': {
                1: [{ inicio: '10:40', fim: '12:20', turma: '1A', materia: 'Inglês' }],
                3: [{ inicio: '08:40', fim: '10:20', turma: '1B', materia: 'Inglês' }]
            }
        };
    }

    /**
     * Retorna a grade de um professor
     */
    getGradeProfessor(professorId) {
        return this.gradeFixa[professorId] || {};
    }

    /**
     * Retorna a grade de um professor para um dia específico
     * @param {string} professorId 
     * @param {number} diaSemana (0=Dom, 1=Seg, ..., 6=Sab)
     */
    getGradeDia(professorId, diaSemana) {
        const grade = this.getGradeProfessor(professorId);
        return grade[diaSemana] || [];
    }

    /**
     * Valida se um registro é permitido
     * @param {string} professorId - ID do usuario ou professor
     * @param {string} turmaId - Turma alvo
     * @param {string} data - Data do lançamento (YYYY-MM-DD)
     * @param {string} materia - Matéria (opcional para filtro)
     */
    validateRegistro(professorId, turmaId, data, materia = null) {
        // Converte data para dia da semana
        // Note: new Date('2024-12-16') might be UTC. Use strings correctly or force timezone.
        // Simple approach: split and create date
        const parts = data.split('-');
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        const diaSemana = dateObj.getDay();

        if (diaSemana === 0 || diaSemana === 6) {
            return { allowed: false, reason: 'Fim de semana' };
        }

        // Tenta encontrar o ID do professor normalizado (se vier _id do mongo ou id numérico)
        // No mock, estamos usando chaves como 'prof001'.
        // Na app real, precisamos mapear o ID do usuário para a chave da grade.
        // Para este protótipo, vamos assumir que professorId bate com o da grade ou mapear simples.
        
        let profKey = professorId;
        // Mock mapping for demo purposes (assuming user is logged in as 'admin' or mapped user)
        if (!this.gradeFixa[profKey]) {
            // Tenta achar primeiro prof se for teste
            if (professorId === 'admin' || !professorId) profKey = 'prof001'; 
        }

        const gradeDia = this.getGradeDia(profKey, diaSemana);
        
        if (!gradeDia || gradeDia.length === 0) {
            return { allowed: false, level: 'error', reason: 'Nenhuma aula agendada para este dia.' };
        }

        // Verifica se tem aula nessa turma
        const aulaTurma = gradeDia.find(a => 
            this.normalizeTurma(a.turma) === this.normalizeTurma(turmaId) &&
            (!materia || a.materia === materia)
        );

        if (aulaTurma) {
            return { allowed: true, level: 'success', message: `Horário Confirmado: ${aulaTurma.inicio} - ${aulaTurma.fim} (${aulaTurma.materia})` };
        }

        return { allowed: false, level: 'error', reason: `Você não tem aula na turma ${turmaId} nesta data.` };
    }

    normalizeTurma(t) {
        return t.replace('º', '').replace(' ', '').trim();
    }
}

export const gradeService = new GradeService();
