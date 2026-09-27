/**
 * controladorDados.test.js — controlador dos dados no termo do portal (#474).
 *
 * O termo do cadastro do responsável dizia a todos que quem trata os dados é
 * a "Escola Jaguari". O controlador é a escola em que o aluno está
 * matriculado: o texto sai de `portal-responsavel/src/utils/controladorDados.ts`
 * com o nome da escola de cada aluno, e fica genérico quando não há nome.
 *
 * Mesmo carregamento de cadastroPortalResponsavel.test.js: o arquivo do
 * portal não tem `import`, o Node tira os tipos e o `vm` executa o resto.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const RAIZ = path.resolve(__dirname, '../../..');
const ARQUIVO = path.join(RAIZ, 'portal-responsavel/src/utils/controladorDados.ts');

function carregar() {
    const js = stripTypeScriptTypes(fs.readFileSync(ARQUIVO, 'utf8')).replace(/^export /gm, '');
    return vm.runInNewContext(`${js}\n;({ textoDoControlador })`, {}, { filename: ARQUIVO });
}

const { textoDoControlador } = carregar();

describe('textoDoControlador', () => {
    it('nomeia a escola do aluno', () => {
        expect({ ...textoDoControlador(['EMEF Paulo Freire']) }).toEqual({
            coleta: 'A escola em que o aluno está matriculado, EMEF Paulo Freire, coleta',
            matriculados: 'matriculados na escola EMEF Paulo Freire',
        });
    });

    it('lista cada escola uma vez quando os filhos estudam em escolas diferentes', () => {
        const texto = textoDoControlador([
            'EMEF Paulo Freire',
            'CIEP Darcy Ribeiro',
            ' EMEF Paulo Freire ',
            'EMEF Vila Nova',
        ]);
        expect(texto.coleta).toBe(
            'As escolas em que os alunos estão matriculados, EMEF Paulo Freire, CIEP Darcy Ribeiro e EMEF Vila Nova, coletam'
        );
        expect(texto.matriculados).toBe(
            'matriculados nas escolas EMEF Paulo Freire, CIEP Darcy Ribeiro e EMEF Vila Nova'
        );
    });

    it.each([
        ['sem aluno carregado', []],
        ['aluno sem nome de escola', [undefined, '  ']],
    ])('fica genérico %s — nunca cita outra escola', (_caso, escolas) => {
        expect({ ...textoDoControlador(escolas) }).toEqual({
            coleta: 'A escola em que o aluno está matriculado coleta',
            matriculados: 'matriculados nas escolas atendidas por este portal',
        });
    });
});

describe('termo do CompletarCadastro', () => {
    const fonte = fs.readFileSync(
        path.join(RAIZ, 'portal-responsavel/src/components/CompletarCadastro.tsx'),
        'utf8'
    );

    it('não fixa a Escola Jaguari como controladora', () => {
        expect(fonte).not.toMatch(/Escola Jaguari/i);
    });

    it('monta as duas frases a partir da escola dos alunos', () => {
        expect(fonte).toContain('{controlador.coleta} dados essenciais');
        expect(fonte).toMatch(/dos alunos\{' '\}\s*\{controlador\.matriculados\}\./);
    });
});
