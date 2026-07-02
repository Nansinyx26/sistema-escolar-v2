/**
 * chatbotService.fetchComunicados.test.js
 *
 * Unit tests for ChatbotService.fetchComunicados()
 * Requirements: 3.5, 10.1, 10.2, 10.3, 10.4
 */

const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const Comunicado = require('../models/Comunicado');
const { fetchComunicados } = require('../services/ChatbotService');

beforeAll(async () => {
    await conectarBanco();
});

afterEach(async () => {
    await limparBanco();
});

afterAll(async () => {
    await desconectarBanco();
});

// Helper to create a Comunicado document
async function criarComunicado(overrides = {}) {
    const defaults = {
        titulo: 'Comunicado Teste',
        conteudo: 'Conteúdo do comunicado',
        diretorId: 'dir001',
        diretorNome: 'Diretor Teste',
        destinatarios: ['todos'],
        ativo: true,
        dataCriacao: new Date(),
    };
    return Comunicado.create({ ...defaults, ...overrides });
}

describe('fetchComunicados', () => {

    // Requisito 10.1 / 10.4: nenhum comunicado ativo → retornar array vazio
    it('retorna array vazio quando não há comunicados ativos', async () => {
        await criarComunicado({ ativo: false });

        const result = await fetchComunicados({ perfil: 'diretor', turmaAluno: null });

        expect(result).toEqual([]);
    });

    // Requisito 10.1: sempre filtra por ativo: true
    it('não retorna comunicados inativos (ativo: false)', async () => {
        await criarComunicado({ destinatarios: ['todos'], ativo: true });
        await criarComunicado({ destinatarios: ['todos'], ativo: false });

        const result = await fetchComunicados({ perfil: 'diretor', turmaAluno: null });

        expect(result).toHaveLength(1);
        result.forEach(c => expect(c.ativo).toBe(true));
    });

    // Requisito 10.2: limitar a 5 registros mais recentes
    it('limita o retorno a 5 comunicados', async () => {
        for (let i = 0; i < 8; i++) {
            await criarComunicado({
                titulo: `Comunicado ${i}`,
                destinatarios: ['todos'],
                dataCriacao: new Date(Date.now() + i * 1000),
            });
        }

        const result = await fetchComunicados({ perfil: 'admin', turmaAluno: null });

        expect(result).toHaveLength(5);
    });

    // Requisito 10.2: ordenar por dataCriacao decrescente
    it('retorna os comunicados ordenados por dataCriacao decrescente', async () => {
        const agora = Date.now();
        await criarComunicado({ titulo: 'Antigo', destinatarios: ['todos'], dataCriacao: new Date(agora - 2000) });
        await criarComunicado({ titulo: 'Recente', destinatarios: ['todos'], dataCriacao: new Date(agora) });
        await criarComunicado({ titulo: 'Meio', destinatarios: ['todos'], dataCriacao: new Date(agora - 1000) });

        const result = await fetchComunicados({ perfil: 'diretor', turmaAluno: null });

        expect(result[0].titulo).toBe('Recente');
        expect(result[1].titulo).toBe('Meio');
        expect(result[2].titulo).toBe('Antigo');
    });

    // Requisito 3.5 / 10.1: perfil responsavel filtra destinatários por ['todos', 'responsaveis', turmaAluno]
    it('perfil responsavel recebe comunicados destinados a "todos"', async () => {
        await criarComunicado({ destinatarios: ['todos'] });
        await criarComunicado({ destinatarios: ['professores'] }); // não deve aparecer

        const result = await fetchComunicados({ perfil: 'responsavel', turmaAluno: '3A' });

        expect(result).toHaveLength(1);
        expect(result[0].destinatarios).toContain('todos');
    });

    it('perfil responsavel recebe comunicados destinados a "responsaveis"', async () => {
        await criarComunicado({ destinatarios: ['responsaveis'] });
        await criarComunicado({ destinatarios: ['professores'] }); // não deve aparecer

        const result = await fetchComunicados({ perfil: 'responsavel', turmaAluno: '3A' });

        expect(result).toHaveLength(1);
        expect(result[0].destinatarios).toContain('responsaveis');
    });

    it('perfil responsavel recebe comunicados destinados à turma do aluno', async () => {
        await criarComunicado({ destinatarios: ['3A'] });
        await criarComunicado({ destinatarios: ['5B'] }); // outra turma, não deve aparecer

        const result = await fetchComunicados({ perfil: 'responsavel', turmaAluno: '3A' });

        expect(result).toHaveLength(1);
        expect(result[0].destinatarios).toContain('3A');
    });

    it('perfil responsavel sem turmaAluno não quebra o filtro (filter(Boolean) remove null)', async () => {
        await criarComunicado({ destinatarios: ['todos'] });
        await criarComunicado({ destinatarios: ['responsaveis'] });

        // turmaAluno é null → filter(Boolean) remove, sem $in com null
        const result = await fetchComunicados({ perfil: 'responsavel', turmaAluno: null });

        expect(result).toHaveLength(2);
    });

    // Perfil professor filtra por ['todos', 'professores']
    it('perfil professor recebe comunicados destinados a "todos"', async () => {
        await criarComunicado({ destinatarios: ['todos'] });
        await criarComunicado({ destinatarios: ['responsaveis'] }); // não deve aparecer

        const result = await fetchComunicados({ perfil: 'professor', turmaAluno: null });

        expect(result).toHaveLength(1);
        expect(result[0].destinatarios).toContain('todos');
    });

    it('perfil professor recebe comunicados destinados a "professores"', async () => {
        await criarComunicado({ destinatarios: ['professores'] });
        await criarComunicado({ destinatarios: ['responsaveis'] }); // não deve aparecer

        const result = await fetchComunicados({ perfil: 'professor', turmaAluno: null });

        expect(result).toHaveLength(1);
        expect(result[0].destinatarios).toContain('professores');
    });

    it('perfil professor não recebe comunicados exclusivos de responsaveis ou turmas', async () => {
        await criarComunicado({ destinatarios: ['responsaveis'] });
        await criarComunicado({ destinatarios: ['3A'] });

        const result = await fetchComunicados({ perfil: 'professor', turmaAluno: null });

        expect(result).toHaveLength(0);
    });

    // Perfis admin, diretor, coordenador, secretaria: sem filtro de destinatários
    it.each(['admin', 'diretor', 'coordenador', 'secretaria'])(
        'perfil %s retorna todos os comunicados ativos sem filtrar destinatários',
        async (perfil) => {
            await criarComunicado({ destinatarios: ['todos'] });
            await criarComunicado({ destinatarios: ['professores'] });
            await criarComunicado({ destinatarios: ['responsaveis'] });
            await criarComunicado({ destinatarios: ['3A'] });

            const result = await fetchComunicados({ perfil, turmaAluno: null });

            expect(result).toHaveLength(4);
        }
    );

    // Retorna array (lean) — não instâncias Mongoose
    it('retorna objetos plain (lean) e não instâncias do Mongoose', async () => {
        await criarComunicado({ destinatarios: ['todos'] });

        const result = await fetchComunicados({ perfil: 'admin', turmaAluno: null });

        expect(result[0]).not.toBeInstanceOf(Comunicado);
        expect(result[0].titulo).toBe('Comunicado Teste');
    });
});
