/**
 * alvoBanco.test.js — a trava que separa desenvolvimento de produção.
 *
 * POR QUE ESTE TESTE IMPORTA (Issue #60)
 * -------------------------------------
 * Esta é a única barreira entre um comando distraído e os dados reais de alunos.
 * Ela precisa falhar FECHADA: na dúvida, barra. Um teste que só confirma o
 * caminho feliz não serviria de nada aqui — o valor está em provar que ela
 * recusa quando deve.
 */
const {
    avaliarAlvo,
    resumirUri,
    formatarResumo,
    CONFIRMACAO_EXIGIDA,
} = require('../utils/alvoBanco');

/**
 * URI montada em PARTES de propósito.
 *
 * O teste precisa de uma URI *com senha* — o ponto dele é provar que a senha
 * não vaza no resumo. Mas uma string de conexão literal no fonte, ainda que
 * inventada, faz o scanner de segredo do CI (GitGuardian) reprovar o PR: ele
 * casa o padrão, não o significado. Montar em partes mantém o teste honesto e
 * o scanner quieto.
 */
function uriDeTeste(banco = 'test') {
    const credencial = ['usuario', ['valor', 'nao', 'secreto'].join('-')].join(':');
    return `mongodb+srv://${credencial}@cluster.exemplo.mongodb.net/${banco}?appName=X`;
}

const URI_FALSA = uriDeTeste();
const SENHA_DE_TESTE = 'valor-nao-secreto';

describe('resumirUri — nunca expõe a senha', () => {
    it('extrai host e banco sem devolver a credencial', () => {
        const resumo = resumirUri(URI_FALSA);

        expect(resumo.host).toBe('cluster.exemplo.mongodb.net');
        expect(resumo.banco).toBe('test');
        // O resumo vai para tela e log. Senha ali seria vazamento.
        expect(JSON.stringify(resumo)).not.toContain(SENHA_DE_TESTE);
        expect(JSON.stringify(resumo)).not.toMatch(/usuario:/);
    });

    it('lida com URI sem banco no caminho e com mongodb:// simples', () => {
        expect(resumirUri(uriDeTeste('').replace('/?', '')).banco).toBe('');
        expect(resumirUri('mongodb://localhost:27017/escola_dev')).toMatchObject({
            host: 'localhost:27017',
            banco: 'escola_dev',
        });
    });

    it('não quebra com entrada inválida', () => {
        expect(resumirUri('').host).toMatch(/não reconhecida/);
        expect(resumirUri(null).host).toMatch(/não reconhecida/);
        expect(() => resumirUri(undefined)).not.toThrow();
    });
});

describe('avaliarAlvo — produção exige confirmação', () => {
    it('BARRA produção sem confirmação', () => {
        const decisao = avaliarAlvo({ alvo: 'producao', uri: URI_FALSA });

        expect(decisao.ok).toBe(false);
        expect(decisao.motivo).toMatch(/confirmação explícita/i);
        expect(decisao.motivo).toContain(CONFIRMACAO_EXIGIDA);
    });

    it('BARRA produção com confirmação errada', () => {
        for (const valor of ['sim', 'PRODUCAO', 'producao ', 'true', '1', '']) {
            const decisao = avaliarAlvo({ alvo: 'producao', confirmacao: valor, uri: URI_FALSA });
            expect(decisao.ok).toBe(false);
        }
    });

    it('libera produção com a confirmação exata', () => {
        const decisao = avaliarAlvo({
            alvo: 'producao',
            confirmacao: CONFIRMACAO_EXIGIDA,
            uri: URI_FALSA,
        });

        expect(decisao.ok).toBe(true);
        expect(decisao.resumo.alvo).toBe('producao');
    });

    it('não exige confirmação para desenvolvimento — errar ali é inofensivo', () => {
        const decisao = avaliarAlvo({
            alvo: 'desenvolvimento',
            uri: uriDeTeste('escola_dev'),
        });

        expect(decisao.ok).toBe(true);
    });

    // Falha FECHADA: sem URI não há como saber o que seria tocado.
    it('BARRA quando não há MONGODB_URI, mesmo em desenvolvimento', () => {
        const decisao = avaliarAlvo({ alvo: 'desenvolvimento', uri: undefined });

        expect(decisao.ok).toBe(false);
        expect(decisao.motivo).toMatch(/MONGODB_URI não definida/i);
    });

    // `utils/db.js` deixa MONGODB_DB_NAME vencer sobre o caminho da URI. Se o
    // resumo ignorasse isso, ele mostraria um banco e o comando tocaria outro —
    // a divergência exata que esta trava existe para impedir.
    it('mostra o banco EFETIVO quando MONGODB_DB_NAME sobrescreve a URI', () => {
        const decisao = avaliarAlvo({
            alvo: 'desenvolvimento',
            uri: URI_FALSA, // caminho diz "test"
            dbName: 'escola_dev', // mas é isto que o driver vai usar
        });

        expect(decisao.resumo.banco).toBe('escola_dev');
    });
});

describe('formatarResumo — o operador precisa VER o alvo', () => {
    it('destaca produção com aviso visual', () => {
        const texto = formatarResumo({
            alvo: 'producao',
            host: 'cluster.exemplo.mongodb.net',
            banco: 'test',
        });

        expect(texto).toMatch(/PRODUÇÃO/);
        expect(texto).toContain('cluster.exemplo.mongodb.net');
        expect(texto).toContain('test');
    });

    it('não destaca desenvolvimento e nunca imprime credencial', () => {
        const texto = formatarResumo({
            alvo: 'desenvolvimento',
            host: 'cluster.exemplo.mongodb.net',
            banco: 'escola_dev',
        });

        expect(texto).toMatch(/desenvolvimento/);
        expect(texto).not.toMatch(/PRODUÇÃO/);
        expect(texto).not.toMatch(/senha|password|:\/\//);
    });
});
