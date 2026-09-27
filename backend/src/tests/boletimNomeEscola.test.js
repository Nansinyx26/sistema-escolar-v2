/**
 * boletimNomeEscola.test.js — o boletim sai com o nome da escola do aluno.
 *
 * Issue #471: o cabeçalho e o rodapé do boletim em PDF diziam "Escola Jaguari"
 * para qualquer aluno, mas o sistema atende várias escolas. O boletim é
 * documento oficial da escola do aluno; sem escola, sai a marca do sistema.
 */

jest.mock('../models/Escola', () => ({ findById: jest.fn() }));
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const Escola = require('../models/Escola');
const { nomeDaEscolaDoAluno } = require('../controllers/RelatorioController');

/** `Escola.findById(id).select('nome').lean()` resolvendo para `valor`. */
function escolaRetorna(valor) {
    const lean = typeof valor === 'function' ? valor : jest.fn().mockResolvedValue(valor);
    Escola.findById.mockReturnValue({ select: () => ({ lean }) });
}

describe('nome da escola no boletim (Issue #471)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('usa o nome da escola do aluno', async () => {
        escolaRetorna({ nome: 'EMEF Outra Escola' });

        await expect(nomeDaEscolaDoAluno({ escolaId: 'e1' })).resolves.toBe('EMEF Outra Escola');
        expect(Escola.findById).toHaveBeenCalledWith('e1');
    });

    it('aluno sem escola (cadastro legado) sai com a marca do sistema, sem ir ao banco', async () => {
        await expect(nomeDaEscolaDoAluno({})).resolves.toBe('Sistema Escolar');
        expect(Escola.findById).not.toHaveBeenCalled();
    });

    it('escola não encontrada sai com a marca do sistema', async () => {
        escolaRetorna(null);

        await expect(nomeDaEscolaDoAluno({ escolaId: 'sumiu' })).resolves.toBe('Sistema Escolar');
    });

    it('escolaId inválido não derruba o boletim', async () => {
        escolaRetorna(jest.fn().mockRejectedValue(new Error('Cast to ObjectId failed')));

        await expect(nomeDaEscolaDoAluno({ escolaId: 'x' })).resolves.toBe('Sistema Escolar');
    });
});
