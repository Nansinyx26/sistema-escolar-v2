/**
 * anonimizacaoAluno.test.js — o direito ao esquecimento, campo a campo.
 *
 * O DEFEITO QUE ESTES TESTES EXISTEM PARA PEGAR
 * --------------------------------------------
 * Um campo esquecido na lista de identificadores é dado pessoal de criança que
 * sobrevive à anonimização — e o defeito é invisível: a operação responde
 * "sucesso", a tela mostra o pseudônimo, e o CPF continua no documento. Não há
 * sintoma até alguém abrir o banco.
 *
 * Por isso os testes verificam a LISTA, e não só o efeito: cada categoria de
 * dado (identificação, contato, saúde, texto livre) tem um caso próprio, e a
 * chave de busca por nome tem o dela — foi o furo mais fácil de deixar passar,
 * porque `nome` vira pseudônimo enquanto `nomeNormalizado` continuaria
 * encontrando a criança por digitação.
 */
const {
    podeAnonimizar,
    planoDeAnonimizacao,
    pseudonimo,
    CAMPOS_PRESERVADOS,
} = require('../services/conformidade/anonimizacaoAluno');

const alunoTransferido = (extras = {}) => ({
    _id: 'aluno-77',
    nome: 'Ana',
    sobrenome: 'Souza',
    nomeNormalizado: 'ana souza',
    matricula: '2026001',
    cpfAluno: '12345678901',
    nascimento: new Date('2015-04-10T00:00:00Z'),
    endereco: 'Rua das Acácias, 120',
    telefone: '(19) 99999-0000',
    responsaveis: [{ nome: 'Marta Souza', cpf: '98765432100' }],
    alergiasAlimentos: 'Amendoim',
    planoSaude: 'Convênio X',
    deficiencia: 'Baixa visão',
    observacoes: 'Mora com a avó na mesma rua da escola',
    foto: 'gridfs-id-123',
    turma: '3A',
    notas: [{ materia: 'Matemática', valor: 8 }],
    faltas: [{ data: new Date(), presente: false }],
    pcd: true,
    etnia: 'Parda',
    situacao: 'transferido',
    ...extras,
});

describe('quando a anonimização é permitida', () => {
    it('aluno transferido pode ser anonimizado', () => {
        expect(podeAnonimizar(alunoTransferido())).toEqual({ permitido: true });
    });

    it('aluno ATIVO não pode — a escola ainda tem dever de guarda sobre ele', () => {
        const { permitido, motivo } = podeAnonimizar(alunoTransferido({ situacao: 'ativo' }));
        expect(permitido).toBe(false);
        expect(motivo).toMatch(/situação/i);
    });

    it('remanejado não pode: movimentação dentro da rede não encerra o vínculo', () => {
        expect(podeAnonimizar(alunoTransferido({ situacao: 'remanejado' })).permitido).toBe(false);
    });

    it('cadastro já anonimizado não é anonimizado de novo', () => {
        const { permitido, motivo } = podeAnonimizar(
            alunoTransferido({ anonimizadoEm: new Date() })
        );
        expect(permitido).toBe(false);
        expect(motivo).toMatch(/já foi anonimizado/i);
    });
});

describe('o que sai do cadastro', () => {
    const plano = planoDeAnonimizacao(alunoTransferido(), { executadoPor: 'Secretária Teste' });
    const removidos = plano.camposRemovidos;

    it('remove a identificação direta', () => {
        expect(removidos).toEqual(
            expect.arrayContaining(['sobrenome', 'matricula', 'cpfAluno', 'nascimento', 'foto'])
        );
    });

    it('remove contato e localização — o que permite chegar até a pessoa', () => {
        expect(removidos).toEqual(expect.arrayContaining(['endereco', 'telefone', 'responsaveis']));
    });

    it('remove dado sensível de saúde (LGPD, art. 11)', () => {
        expect(removidos).toEqual(
            expect.arrayContaining(['alergiasAlimentos', 'planoSaude', 'deficiencia'])
        );
    });

    it('remove texto livre, onde nome e endereço reaparecem por escrito', () => {
        expect(removidos).toContain('observacoes');
    });

    it('troca também a CHAVE DE BUSCA, não só o nome exibido', () => {
        // Sem isto, a secretaria digitaria "Ana Souza" no autocomplete e
        // encontraria a criança que acabou de ser "anonimizada".
        expect(plano.$set.nome).toBe(plano.pseudonimo);
        expect(plano.$set.nomeNormalizado).not.toContain('ana');
        expect(plano.$set.nomeNormalizado).toBe(plano.pseudonimo.toLowerCase());
    });

    it('marca quem executou e quando — a operação é irreversível', () => {
        expect(plano.$set.anonimizadoPor).toBe('Secretária Teste');
        expect(plano.$set.anonimizadoEm).toBeInstanceOf(Date);
        expect(plano.$set.ativo).toBe(false);
    });

    it('não tenta remover campo que o cadastro não tem', () => {
        // `$unset` de campo ausente polui a atualização e mascara a lista real
        // do que efetivamente saiu — que é o que vai para o log de auditoria.
        const magro = planoDeAnonimizacao({ _id: 'x', nome: 'Bruno', situacao: 'abandono' });
        expect(magro.camposRemovidos).toEqual([]);
    });
});

describe('o que fica', () => {
    const plano = planoDeAnonimizacao(alunoTransferido());

    it('preserva a vida escolar exigida pela LDB e pela estatística', () => {
        for (const campo of ['notas', 'faltas', 'turma', 'situacao', 'pcd', 'etnia']) {
            expect(plano.camposRemovidos).not.toContain(campo);
            expect(CAMPOS_PRESERVADOS).toContain(campo);
        }
    });

    it('preserva a CONTAGEM de deficiência, mas não a descrição da condição', () => {
        // `pcd` é indicador obrigatório do Censo; `deficiencia` descreve uma
        // pessoa específica e é dado sensível.
        expect(plano.camposRemovidos).toContain('deficiencia');
        expect(plano.camposRemovidos).not.toContain('pcd');
    });
});

describe('pseudônimo', () => {
    it('é estável para o mesmo aluno e diferente entre alunos', () => {
        expect(pseudonimo('aluno-77')).toBe(pseudonimo('aluno-77'));
        expect(pseudonimo('aluno-77')).not.toBe(pseudonimo('aluno-78'));
    });

    it('não carrega nenhum pedaço do nome original', () => {
        expect(pseudonimo('aluno-77')).toMatch(/^Aluno anonimizado [0-9A-F]{6}$/);
    });
});
