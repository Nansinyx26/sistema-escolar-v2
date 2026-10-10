/**
 * professoresComConta.test.js — Issue #735
 *
 * O assistente só cita professor que tem conta de verdade, e acha a turma em
 * qualquer grafia. Teste de unidade, sem banco: o `Usuario` é um dublê que
 * devolve as contas conforme a consulta pedida.
 */

jest.mock('../models/Usuario', () => ({ find: jest.fn() }));

const Usuario = require('../models/Usuario');
const { soComConta, chaveDaTurma } = require('../services/professoresComConta');

const ID = (n) => String(n).padStart(24, 'a');

/** Simula `Usuario.find(filtro).select().lean()` aplicando o filtro de verdade. */
function contasNoBanco(contas) {
    Usuario.find.mockImplementation((filtro) => {
        const ids = filtro._id.$in;
        const achadas = contas.filter(
            (c) =>
                ids.includes(c._id) &&
                c.perfil === filtro.perfil &&
                (filtro.ativo?.$ne === undefined || c.ativo !== filtro.ativo.$ne)
        );
        return { select: () => ({ lean: async () => achadas }) };
    });
}

describe('chaveDaTurma', () => {
    it('iguala as grafias da mesma turma', () => {
        for (const t of ['1B', '1ºB', '1° B', '1º ano B', 'sala 1b', 'Turma 1-B', '1ª série B']) {
            expect(chaveDaTurma(t)).toBe('1B');
        }
    });

    it('não confunde turmas diferentes', () => {
        expect(chaveDaTurma('1B')).not.toBe(chaveDaTurma('1C'));
        expect(chaveDaTurma('5A')).not.toBe(chaveDaTurma('15A'));
    });

    it('aceita vazio sem quebrar', () => {
        expect(chaveDaTurma(null)).toBe('');
        expect(chaveDaTurma(undefined)).toBe('');
    });
});

describe('soComConta', () => {
    beforeEach(() => Usuario.find.mockReset());

    it('fica só com quem tem conta de professor ativa e confirmada', async () => {
        contasNoBanco([
            { _id: ID(1), perfil: 'professor', ativo: true },
            { _id: ID(2), perfil: 'professor', ativo: false },
            {
                _id: ID(3),
                perfil: 'professor',
                ativo: true,
                confirmacaoEmailObrigatoria: true,
                emailVerificado: false,
            },
            { _id: ID(4), perfil: 'responsavel', ativo: true },
            {
                _id: ID(5),
                perfil: 'professor',
                ativo: true,
                confirmacaoEmailObrigatoria: true,
                emailVerificado: true,
            },
        ]);

        const professores = [
            { nome: 'Real', idUsuario: ID(1) },
            { nome: 'Desligado', idUsuario: ID(2) },
            { nome: 'Pendente', idUsuario: ID(3) },
            { nome: 'Responsavel', idUsuario: ID(4) },
            { nome: 'Confirmado', idUsuario: ID(5) },
            { nome: 'Conta apagada', idUsuario: ID(6) },
            { nome: 'Sem conta' },
            { nome: 'Id lixo', idUsuario: 'nao-e-id' },
        ];

        const nomes = (await soComConta(professores)).map((p) => p.nome);
        expect(nomes).toEqual(['Real', 'Confirmado']);
    });

    it('sem nenhum id válido nem consulta o banco', async () => {
        expect(await soComConta([{ nome: 'Sem conta' }])).toEqual([]);
        expect(await soComConta(null)).toEqual([]);
        expect(Usuario.find).not.toHaveBeenCalled();
    });
});
