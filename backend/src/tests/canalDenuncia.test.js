/**
 * canalDenuncia.test.js — o canal de denúncia exigido pelo ECA Digital.
 *
 * O QUE ESTÁ EM JOGO
 * ------------------
 * O canal precisa existir, ser visível e ser USÁVEL. Três decisões o tornam
 * usável, e as três têm teste aqui:
 *
 *   1. denúncia SEM mensagem vinculada. O bullying que a criança quer relatar
 *      aconteceu no pátio, não no chat — exigir um `mensagemId` fecharia o
 *      canal para o caso mais comum;
 *   2. categoria de risco entra como GRAVE e escalona. Violência, assédio e
 *      automutilação envolvem integridade física; esperar as 24h da fila normal
 *      pode ser tarde;
 *   3. nada é bloqueado, ninguém é notificado. Denúncia que suspende conta
 *      transforma o botão em arma contra desafeto (R7 da spec de moderação).
 *
 * Os testes trocam o `create` do model por um dublê: o que se quer verificar é
 * a DECISÃO, e ela é tomada antes de qualquer ida ao banco.
 */
const ModeracaoOcorrencia = require('../models/ModeracaoOcorrencia');
const ModeracaoService = require('../services/moderacao/ModeracaoService');

let criado;

beforeEach(() => {
    criado = null;
    jest.spyOn(ModeracaoOcorrencia, 'create').mockImplementation(async (doc) => {
        criado = doc;
        return { _id: 'ocorrencia-1', ...doc };
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

const denunciar = (categoria, relato = 'Estão me xingando todos os dias no recreio.') =>
    ModeracaoService.registrarDenunciaAberta({
        categoria,
        relato,
        contexto: { escolaId: 'escola-1', remetenteId: 'user-1', remetentePerfil: 'responsavel' },
    });

describe('gravidade por categoria', () => {
    it('violência entra como grave, com prioridade alta e escalonamento', async () => {
        const veredito = await denunciar('violencia');
        expect(veredito).toMatchObject({
            severidade: 'grave',
            prioridade: 'alta',
            escalonar: true,
            fila: true,
        });
    });

    it('assédio e automutilação também', async () => {
        expect((await denunciar('assedio')).severidade).toBe('grave');
        expect((await denunciar('automutilacao')).severidade).toBe('grave');
    });

    it('bullying e discriminação entram como moderadas — quem denuncia não classifica', async () => {
        expect((await denunciar('bullying')).severidade).toBe('moderada');
        expect((await denunciar('discriminacao')).prioridade).toBe('normal');
    });
});

describe('o que é gravado', () => {
    it('guarda o relato e a categoria, e nasce pendente na fila da escola', async () => {
        await denunciar('bullying', 'Meu filho está sendo excluído das atividades pela turma.');
        expect(criado).toMatchObject({
            camada: 'denuncia',
            categoriaDenuncia: 'bullying',
            relato: 'Meu filho está sendo excluído das atividades pela turma.',
            statusAtual: 'pendente',
            escolaId: 'escola-1',
        });
    });

    it('não aponta para mensagem nenhuma — é o canal aberto', async () => {
        await denunciar('bullying');
        expect(criado.mensagemId).toBeNull();
        expect(criado.gridfsId).toBeNull();
    });

    it('não bloqueia nada: a denúncia gera apuração, não punição', async () => {
        const veredito = await denunciar('violencia');
        expect(veredito.entrega).toBe(true);
        expect(veredito.decisao).toBe('em_revisao');
    });
});

describe('validação da rota', () => {
    const ModeracaoController = require('../controllers/ModeracaoController');

    /** Dublê mínimo de `res` — só o suficiente para ler status e corpo. */
    function resposta() {
        const r = {};
        r.status = (codigo) => {
            r.codigo = codigo;
            return r;
        };
        r.json = (corpo) => {
            r.corpo = corpo;
            return r;
        };
        return r;
    }

    const requisicao = (body) => ({ body, user: { id: 'u1', perfil: 'responsavel' } });

    it('recusa categoria fora da lista, dizendo quais valem', async () => {
        const res = resposta();
        await ModeracaoController.denunciar(requisicao({ categoria: 'qualquer' }), res);
        expect(res.codigo).toBe(400);
        expect(res.corpo.error).toContain('bullying');
    });

    it('recusa relato vazio — clique acidental não vira item de fila', async () => {
        const res = resposta();
        await ModeracaoController.denunciar(
            requisicao({ categoria: 'bullying', relato: 'oi' }),
            res
        );
        expect(res.codigo).toBe(400);
    });

    it('devolve protocolo, para a pessoa poder cobrar retorno depois', async () => {
        const res = resposta();
        await ModeracaoController.denunciar(
            requisicao({ categoria: 'bullying', relato: 'Estão xingando meu filho no recreio.' }),
            res
        );
        expect(res.codigo).toBe(201);
        expect(res.corpo).toMatchObject({ success: true, data: { protocolo: 'ocorrencia-1' } });
    });
});
