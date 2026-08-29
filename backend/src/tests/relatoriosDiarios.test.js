/**
 * relatoriosDiarios.test.js
 * ============================================================================
 * Diário de classe da aba "Relatórios Diários" da página de turma.
 *
 * A aba existia no front desde sempre, com auto-save e a mensagem
 * "✅ Relatório salvo!" — mas `/api/relatorios` só tinha a rota de boletim.
 * Todo save caía em 404, o front engolia o erro e confirmava o salvamento
 * mesmo assim. O professor escrevia o relatório do dia, via a confirmação, e
 * o texto não existia em lugar nenhum.
 *
 * Estes testes fixam o contrato que faltava, e em especial as três coisas que
 * uma implementação ingênua erra: idempotência do upsert (auto-save e clique
 * em "Salvar" disparam juntos), a chave ser o DIA CIVIL e não um instante, e
 * o isolamento por turma do professor.
 */
const request = require('supertest');
const app = require('../app');
const {
    conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE,
} = require('./helpers');

const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Relatorio = require('../models/Relatorio');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); invalidarCacheEscolas(); });
afterAll(async () => { await desconectarBanco(); });

/** Professor logado, com as turmas que ele leciona. */
async function professorDe(salaPrincipal, salasAdicionais = []) {
    const escola = await Escola.create({ nome: `Escola Rel ${Date.now()}`, tipo: 'EMEF', ativo: true });
    const escolaId = String(escola._id);
    const email = `prof_rel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@escola.test`;

    const user = await criarUsuario({ email, perfil: 'professor', escolaId });
    await Professor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        salaPrincipal,
        salasAdicionais,
        vinculos: [{ escolaId, cargo: 'professor' }],
        ativo: true,
    });
    invalidarCacheEscolas();

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.status).toBe(200);
    return { agent, escolaId, id: String(user._id) };
}

const salvar = (agent, corpo) =>
    agent.put('/api/relatorios/diarios').set('X-CSRF-Token', 'test').send(corpo);

const listar = (agent, query) =>
    agent.get('/api/relatorios/diarios').query(query);

const QUINZENA = { de: '2026-08-15', ate: '2026-08-29' };

describe('Relatórios diários — persistência', () => {
    it('grava o relatório do dia e devolve o mesmo texto na listagem', async () => {
        const { agent } = await professorDe('5A');

        const gravado = await salvar(agent, {
            turma: '5A', materia: 'Matemática', dia: '2026-08-20',
            conteudo: 'Frações equivalentes. Exercícios 1 a 8.',
        });

        expect(gravado.status).toBe(200);
        expect(gravado.body.success).toBe(true);
        expect(gravado.body.data.dia).toBe('2026-08-20');

        const lista = await listar(agent, { turma: '5A', materia: 'Matemática', ...QUINZENA });

        expect(lista.status).toBe(200);
        expect(lista.body.data).toHaveLength(1);
        expect(lista.body.data[0].conteudo).toBe('Frações equivalentes. Exercícios 1 a 8.');
    });

    it('separa relatórios por matéria no mesmo dia e turma', async () => {
        const { agent } = await professorDe('5A');

        await salvar(agent, { turma: '5A', materia: 'Matemática', dia: '2026-08-20', conteudo: 'Frações' });
        await salvar(agent, { turma: '5A', materia: 'História', dia: '2026-08-20', conteudo: 'Império' });

        const mat = await listar(agent, { turma: '5A', materia: 'Matemática', ...QUINZENA });
        const hist = await listar(agent, { turma: '5A', materia: 'História', ...QUINZENA });

        expect(mat.body.data).toHaveLength(1);
        expect(mat.body.data[0].conteudo).toBe('Frações');
        expect(hist.body.data[0].conteudo).toBe('Império');
    });

    it('devolve só os dias dentro da janela pedida', async () => {
        const { agent } = await professorDe('5A');

        await salvar(agent, { turma: '5A', materia: 'Matemática', dia: '2026-08-14', conteudo: 'Antes' });
        await salvar(agent, { turma: '5A', materia: 'Matemática', dia: '2026-08-20', conteudo: 'Dentro' });
        await salvar(agent, { turma: '5A', materia: 'Matemática', dia: '2026-08-30', conteudo: 'Depois' });

        const lista = await listar(agent, { turma: '5A', materia: 'Matemática', ...QUINZENA });

        expect(lista.body.data.map(r => r.conteudo)).toEqual(['Dentro']);
    });

    // O front chama a rota sem `materia` quando a turma não tem matéria
    // escolhida na URL. Os dois lados precisam concordar no mesmo padrão, ou
    // o relatório é gravado num balde e lido de outro.
    it('usa a mesma matéria padrão ao gravar e ao listar sem informar matéria', async () => {
        const { agent } = await professorDe('5A');

        await salvar(agent, { turma: '5A', dia: '2026-08-20', conteudo: 'Sala principal' });
        const lista = await listar(agent, { turma: '5A', ...QUINZENA });

        expect(lista.body.data).toHaveLength(1);
        expect(lista.body.data[0].conteudo).toBe('Sala principal');
    });
});

describe('Relatórios diários — idempotência', () => {
    // Auto-save (debounce) e clique em "Salvar" disparam para o mesmo dia. Com
    // "buscar, e se não achar criar" no front, os dois viam "não existe".
    it('salvar o mesmo dia duas vezes deixa um único registro', async () => {
        const { agent } = await professorDe('5A');
        const base = { turma: '5A', materia: 'Matemática', dia: '2026-08-20' };

        await salvar(agent, { ...base, conteudo: 'Primeira versão' });
        await salvar(agent, { ...base, conteudo: 'Versão corrigida' });

        expect(await Relatorio.countDocuments({ turma: '5A', dia: '2026-08-20' })).toBe(1);

        const lista = await listar(agent, { turma: '5A', materia: 'Matemática', ...QUINZENA });
        expect(lista.body.data).toHaveLength(1);
        expect(lista.body.data[0].conteudo).toBe('Versão corrigida');
    });

    it('dois saves simultâneos do mesmo dia não duplicam', async () => {
        const { agent } = await professorDe('5A');
        const base = { turma: '5A', materia: 'Matemática', dia: '2026-08-20' };

        const respostas = await Promise.all([
            salvar(agent, { ...base, conteudo: 'A' }),
            salvar(agent, { ...base, conteudo: 'B' }),
        ]);

        respostas.forEach(r => expect(r.status).toBe(200));
        expect(await Relatorio.countDocuments({ turma: '5A', dia: '2026-08-20' })).toBe(1);
    });

    it('esvaziar o texto apaga o registro do dia', async () => {
        const { agent } = await professorDe('5A');
        const base = { turma: '5A', materia: 'Matemática', dia: '2026-08-20' };

        await salvar(agent, { ...base, conteudo: 'Escrito por engano' });
        const apagado = await salvar(agent, { ...base, conteudo: '   ' });

        expect(apagado.status).toBe(200);
        expect(apagado.body.removido).toBe(true);
        expect(await Relatorio.countDocuments({ turma: '5A', dia: '2026-08-20' })).toBe(0);
    });
});

describe('Relatórios diários — dia civil', () => {
    // `data` é um instante; `dia` é a data do calendário da escola. Gravar só
    // o instante fazia o relatório de 29/08 escrito às 21h de Brasília ser
    // lido como 30/08 em UTC.
    it('guarda o dia como AAAA-MM-DD, independente de fuso', async () => {
        const { agent } = await professorDe('5A');

        await salvar(agent, { turma: '5A', materia: 'Matemática', dia: '2026-08-29', conteudo: 'Revisão' });

        const doc = await Relatorio.findOne({ turma: '5A' }).lean();
        expect(doc.dia).toBe('2026-08-29');
        // O instante de apoio cai no mesmo dia do calendário em qualquer fuso do Brasil.
        expect(doc.data.toISOString().slice(0, 10)).toBe('2026-08-29');
    });

    it('recusa dia fora do formato ou inexistente', async () => {
        const { agent } = await professorDe('5A');
        const base = { turma: '5A', materia: 'Matemática', conteudo: 'x' };

        expect((await salvar(agent, { ...base, dia: '20/08/2026' })).status).toBe(400);
        expect((await salvar(agent, { ...base, dia: '2026-02-31' })).status).toBe(400);
        expect((await salvar(agent, { ...base, dia: '' })).status).toBe(400);
    });

    it('recusa janela invertida ou grande demais na listagem', async () => {
        const { agent } = await professorDe('5A');

        const invertida = await listar(agent, { turma: '5A', de: '2026-08-29', ate: '2026-08-15' });
        const gigante = await listar(agent, { turma: '5A', de: '2020-01-01', ate: '2026-08-15' });

        expect(invertida.status).toBe(400);
        expect(gigante.status).toBe(400);
    });
});

describe('Relatórios diários — isolamento', () => {
    it('professor não lê relatório de turma que não leciona', async () => {
        const { agent } = await professorDe('5A');

        const res = await listar(agent, { turma: '9Z', ...QUINZENA });

        expect(res.status).toBe(403);
    });

    it('professor não grava relatório de turma que não leciona', async () => {
        const { agent } = await professorDe('5A');

        const res = await salvar(agent, {
            turma: '9Z', materia: 'Matemática', dia: '2026-08-20', conteudo: 'Turma alheia',
        });

        expect(res.status).toBe(403);
        expect(await Relatorio.countDocuments({ turma: '9Z' })).toBe(0);
    });

    // O `horizontalFilter` normaliza "1ºC"/"1C"; a autorização precisa aceitar
    // as duas grafias, senão o professor é barrado da própria turma.
    it('aceita a turma com e sem o marcador de ordinal', async () => {
        const { agent } = await professorDe('1ºC');

        const comOrdinal = await salvar(agent, { turma: '1ºC', dia: '2026-08-20', conteudo: 'a' });
        const semOrdinal = await salvar(agent, { turma: '1C', dia: '2026-08-21', conteudo: 'b' });

        expect(comOrdinal.status).toBe(200);
        expect(semOrdinal.status).toBe(200);
    });

    it('não devolve relatório gravado por outra escola', async () => {
        const primeira = await professorDe('5A');
        await salvar(primeira.agent, { turma: '5A', materia: 'Matemática', dia: '2026-08-20', conteudo: 'Escola A' });

        // Mesma turma, mesmo dia, escola diferente.
        const segunda = await professorDe('5A');
        const lista = await listar(segunda.agent, { turma: '5A', materia: 'Matemática', ...QUINZENA });

        expect(lista.status).toBe(200);
        expect(lista.body.data).toHaveLength(0);
    });

    it('exige sessão', async () => {
        const res = await request(app).get('/api/relatorios/diarios').query({ turma: '5A', ...QUINZENA });

        expect([401, 403]).toContain(res.status);
    });
});
