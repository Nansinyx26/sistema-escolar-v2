/**
 * fichaConselhoTutelar.test.js — o documento que o município precisa provar.
 *
 * POR QUE TESTAR UM PDF
 * ---------------------
 * A ficha é a prova de que a escola cumpriu o art. 12, VIII da LDB. Ela vai
 * para o Conselho Tutelar localizar uma criança que parou de aparecer — e sai
 * assinada pela direção. Dois defeitos aqui não são estéticos:
 *
 *   • endereço impresso como "[object Object]" (o campo é `Mixed`: cadastro
 *     manual grava string, importação grava objeto) é uma visita que não
 *     acontece; e
 *   • responsável ausente porque o aluno veio de planilha antiga, que grava
 *     `responsavel`/`telefone` soltos em vez do array `responsaveis`, é um
 *     telefonema que ninguém faz.
 *
 * Os testes leem a definição do documento (dado puro) em vez dos bytes do PDF:
 * o que precisa estar certo é o conteúdo, e ele é verificável sem renderizar.
 */
const {
    montarFicha,
    enderecoTexto,
    responsaveisDoAluno,
} = require('../services/conformidade/fichaConselhoTutelar');

/** Todos os textos da definição, em qualquer profundidade. */
function textos(no, acc = []) {
    if (no === null || no === undefined) return acc;
    if (Array.isArray(no)) {
        for (const item of no) textos(item, acc);
        return acc;
    }
    if (typeof no === 'object') {
        if (typeof no.text === 'string') acc.push(no.text);
        for (const v of Object.values(no)) {
            if (v && typeof v === 'object') textos(v, acc);
        }
        return acc;
    }
    return acc;
}

const avaliacaoBase = {
    nome: 'Ana Souza',
    anoLetivo: 2026,
    turma: '3A',
    faltas: 16,
    justificadas: 1,
    diasLetivosRealizados: 90,
    diasLetivosPrevistos: 200,
    frequenciaPct: 82.2,
    limiteFaltas: 50,
    rotulo: 'Comunicação obrigatória ao Conselho Tutelar',
    baseLegal: 'LDB, art. 12, VIII (Lei 13.803/2019)...',
    datasDeFalta: [
        { data: '2026-03-02', justificada: false },
        { data: '2026-03-03', justificada: true },
    ],
};

describe('endereço, que é o que leva o Conselho até a criança', () => {
    it('imprime o endereço em texto quando o cadastro gravou string', () => {
        expect(enderecoTexto('Rua das Acácias, 120 — Centro')).toBe(
            'Rua das Acácias, 120 — Centro'
        );
    });

    it('monta o endereço legível quando o cadastro gravou objeto', () => {
        const texto = enderecoTexto({
            logradouro: 'Rua das Acácias',
            numero: '120',
            bairro: 'Centro',
            cidade: 'Americana',
            uf: 'SP',
            cep: '13465-000',
        });
        expect(texto).toContain('Rua das Acácias, 120');
        expect(texto).toContain('Americana/SP');
        expect(texto).not.toContain('[object');
    });

    it('endereço vazio vira "Não informado", nunca string vazia no documento', () => {
        expect(enderecoTexto(null)).toBe('Não informado');
        expect(enderecoTexto({})).toBe('Não informado');
    });
});

describe('responsáveis legais', () => {
    it('usa o array `responsaveis` quando ele existe', () => {
        const lista = responsaveisDoAluno({
            responsaveis: [{ nome: 'Marta Souza', tipo: 'Mãe', telefone: '(19) 99999-0000' }],
        });
        expect(lista).toEqual([
            { nome: 'Marta Souza', parentesco: 'Mãe', telefone: '(19) 99999-0000' },
        ]);
    });

    it('cai para os campos soltos do cadastro antigo em vez de deixar em branco', () => {
        // Aluno importado de planilha não tem o array — e é justamente o
        // cadastro mais provável de estar em situação de infrequência.
        const lista = responsaveisDoAluno({
            responsavel: 'João Souza',
            telefone: '(19) 98888-1111',
        });
        expect(lista[0]).toMatchObject({ nome: 'João Souza', telefone: '(19) 98888-1111' });
    });
});

describe('conteúdo da ficha', () => {
    const ficha = montarFicha({
        aluno: {
            nome: 'Ana',
            sobrenome: 'Souza',
            matricula: '2026001',
            nascimento: new Date('2015-04-10T12:00:00Z'),
            endereco: 'Rua das Acácias, 120',
            responsaveis: [{ nome: 'Marta Souza', tipo: 'Mãe', telefone: '(19) 99999-0000' }],
        },
        escola: { nome: 'EMEF Jaguari', municipio: 'Americana' },
        avaliacao: avaliacaoBase,
        emitente: { nome: 'Secretária Teste', perfil: 'secretaria' },
    });
    const conteudo = textos(ficha.content).join(' | ');

    it('identifica aluno, escola e emitente — documento oficial não é anônimo', () => {
        expect(conteudo).toContain('Ana Souza');
        expect(conteudo).toContain('2026001');
        expect(conteudo).toContain('EMEF Jaguari');
        expect(conteudo).toContain('Secretária Teste');
    });

    it('discrimina os dias de ausência em dd/mm/aaaa e marca os justificados', () => {
        // A data chega como 'aaaa-mm-dd' já resolvida no fuso da escola; formatar
        // via `new Date` sem cuidado devolveria o dia anterior no servidor em UTC.
        expect(conteudo).toContain('02/03/2026');
        expect(conteudo).toContain('03/03/2026 (J)');
    });

    it('traz o fundamento legal e a contagem que motivou a comunicação', () => {
        expect(conteudo).toContain('13.803/2019');
        expect(conteudo).toContain('16');
        expect(conteudo).toContain('82.2%');
    });

    it('não quebra quando não há nenhuma ausência integral registrada', () => {
        const vazia = montarFicha({
            aluno: { nome: 'Bruno' },
            avaliacao: { ...avaliacaoBase, datasDeFalta: [] },
        });
        expect(textos(vazia.content).join(' ')).toContain('Nenhuma ausência integral');
    });
});
