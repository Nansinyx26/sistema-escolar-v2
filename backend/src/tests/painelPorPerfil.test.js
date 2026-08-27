/**
 * painelPorPerfil.test.js — a tabela "onde cada perfil mora".
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * --------------------------
 * O bug original: o responsável abria `/html/dashboard.html` e recebia a
 * interface do professor. A correção foi transformar "para onde este perfil
 * vai" numa tabela e derivar dela "quem pode abrir este painel"
 * (`perfisComPainel`), consumida por `middleware/protegerPaginas.js`.
 *
 * Uma tabela como esta falha de um jeito silencioso: alguém acrescenta um
 * perfil ao enum de `models/Usuario.js` e esquece de declarar o destino dele
 * aqui. Nada quebra — `painelDoPerfil` devolve a tela de escolha, o gate não
 * inclui o perfil, e a pessoa nova simplesmente não consegue chegar em lugar
 * nenhum. É falha fechada, que é o lado certo do erro, mas ainda é uma conta
 * que não funciona e ninguém avisou.
 *
 * Então o enum é lido do PRÓPRIO schema, e não copiado para cá: uma cópia
 * concordaria com o teste para sempre, inclusive quando estivesse errada.
 */
const fs = require('node:fs');
const path = require('node:path');

const {
    PAINEL_POR_PERFIL,
    painelDoPerfil,
    perfisComPainel,
    PAINEL_DASHBOARD,
    PERFIS_DO_DASHBOARD,
} = require('../utils/painelPorPerfil');

const RAIZ = path.resolve(__dirname, '../../..');
const TELA_DE_ESCOLHA = '/html/escolher-perfil.html';

/** Os perfis que o schema realmente aceita — fonte única. */
function perfisDoSchema() {
    const Usuario = require('../models/Usuario');
    return Usuario.schema.path('perfil').enumValues;
}

describe('todo perfil do sistema tem uma casa', () => {
    it.each(perfisDoSchema())('%s tem destino declarado', (perfil) => {
        // Sem isto, um perfil novo nasce sem painel e sem acesso a nenhum —
        // e o único sintoma é uma pessoa reclamando que "não abre nada".
        expect(Object.keys(PAINEL_POR_PERFIL)).toContain(perfil);
    });

    it('a tabela não inventa perfis que o schema não aceita', () => {
        // O contrário também importa: um perfil sobrando aqui vira uma entrada
        // no gate para alguém que não pode existir.
        expect(Object.keys(PAINEL_POR_PERFIL).sort()).toEqual(perfisDoSchema().slice().sort());
    });
});

describe('os destinos existem de verdade no disco', () => {
    const destinos = [...new Set([...Object.values(PAINEL_POR_PERFIL), TELA_DE_ESCOLHA])];

    it.each(destinos)('%s existe', (destino) => {
        // Um caminho com erro de digitação cai no catch-all do Express e devolve
        // a landing page — o histórico "voltar para a página inicial após login".
        expect(fs.existsSync(path.join(RAIZ, destino))).toBe(true);
    });
});

describe('perfil que a tabela não conhece nunca cai no dashboard', () => {
    it.each([undefined, null, '', '   ', 'coordenador', 'PROFESSOR_NOVO'])(
        'painelDoPerfil(%p) manda para a tela de escolha',
        (valor) => {
            expect(painelDoPerfil(valor)).toBe(TELA_DE_ESCOLHA);
        }
    );

    it('perfil conhecido é resolvido sem depender de caixa ou espaço', () => {
        expect(painelDoPerfil('  Responsavel  ')).toBe(PAINEL_POR_PERFIL.responsavel);
    });
});

describe('perfisComPainel deriva a lista de acesso do próprio destino', () => {
    it('devolve exatamente quem mora naquele painel', () => {
        const esperado = Object.keys(PAINEL_POR_PERFIL).filter(
            (p) => PAINEL_POR_PERFIL[p] === PAINEL_DASHBOARD
        );
        expect(perfisComPainel(PAINEL_DASHBOARD).sort()).toEqual(esperado.sort());
    });

    it('o responsável não está entre eles — o bug que originou tudo isto', () => {
        expect(perfisComPainel(PAINEL_DASHBOARD)).not.toContain('responsavel');
    });

    it('destino que ninguém usa devolve lista vazia, não todo mundo', () => {
        expect(perfisComPainel('/html/pagina-que-nao-e-painel.html')).toEqual([]);
    });
});

/**
 * `PERFIS_DO_DASHBOARD` é declarada à mão, e não derivada, porque "quem pode
 * abrir" é mais amplo que "quem mora" — a secretaria tem painel próprio e
 * mesmo assim alcança o dashboard por um botão. Lista à mão pede as travas
 * que a derivação dava de graça.
 */
describe('a lista de acesso ao dashboard é declarada, mas não é solta', () => {
    it('todo nome nela é um perfil que existe', () => {
        // Um acento a mais ('secretária') trancaria a pessoa para fora sem erro
        // nenhum: o gate simplesmente nunca casaria aquele nome.
        const Usuario = require('../models/Usuario');
        const doEnum = Usuario.schema.path('perfil').enumValues;

        for (const perfil of PERFIS_DO_DASHBOARD) {
            expect(`${perfil} existe: ${doEnum.includes(perfil)}`).toBe(`${perfil} existe: true`);
        }
    });

    it('contém todo mundo que MORA no dashboard', () => {
        for (const morador of perfisComPainel(PAINEL_DASHBOARD)) {
            expect(PERFIS_DO_DASHBOARD).toContain(morador);
        }
    });

    it('não contém o responsável', () => {
        expect(PERFIS_DO_DASHBOARD).not.toContain('responsavel');
    });

    it('não tem nomes repetidos', () => {
        expect([...new Set(PERFIS_DO_DASHBOARD)]).toHaveLength(PERFIS_DO_DASHBOARD.length);
    });
});
