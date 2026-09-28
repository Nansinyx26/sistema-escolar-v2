/**
 * registroIncidentes.regressao.test.js — Issue #513
 *
 * Registro de incidentes de segurança (Resolução CD/ANPD nº 15/2024):
 *   1. prazo de 3 dias úteis a partir da ciência, pulando fim de semana e
 *      feriado nacional;
 *   2. registro sem TTL e sem exclusão;
 *   3. encerrar exige comunicação (risco relevante) ou justificativa;
 *   4. só admin; AuditLog sem o texto livre.
 */
const request = require('supertest');
const app = require('../app');
const AuditLog = require('../models/AuditLog');
const IncidenteSeguranca = require('../models/IncidenteSeguranca');
const { prazoDeComunicacao } = require('../services/conformidade/prazoIncidente');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

let admin;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

function api(metodo, caminho, corpo, quem = admin) {
    const r = request(app)[metodo](`/api/admin/incidentes${caminho}`).set('Cookie', cookieDe(quem));
    return corpo ? r.send(corpo) : r;
}

const BASE = {
    titulo: 'Planilha de contatos enviada ao destinatário errado',
    cienciaEm: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    descricao: 'Texto livre com a Joana Fixture, que não pode ir ao AuditLog.',
    categoriasDados: ['contato', 'identificacao'],
    categoriasTitulares: ['responsaveis'],
    titularesEstimados: 40,
};

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    admin = await criarUsuario({ email: `admin${Math.random()}@escola.test`, perfil: 'admin' });
});

describe('prazo de 3 dias úteis', () => {
    // Horário de Brasília nas entradas; saída é o fim do 3º dia útil.
    const fimDoDia = (data) => new Date(`${data}T23:59:59.999-03:00`).toISOString();

    it('segunda → quinta', () => {
        expect(prazoDeComunicacao('2026-09-14T10:00:00-03:00').toISOString()).toBe(
            fimDoDia('2026-09-17')
        );
    });

    it('sexta → quarta, pulando o fim de semana', () => {
        expect(prazoDeComunicacao('2026-09-18T16:00:00-03:00').toISOString()).toBe(
            fimDoDia('2026-09-23')
        );
    });

    it('pula feriado nacional (Dia da Consciência Negra, 20/11)', () => {
        // Quarta 18/11/2026: quinta 19, sexta 20 é feriado, segunda 23, terça 24.
        expect(prazoDeComunicacao('2026-11-18T09:00:00-03:00').toISOString()).toBe(
            fimDoDia('2026-11-24')
        );
    });

    it('ciência às 23h de Brasília conta o dia civil de Brasília, não o de UTC', () => {
        // 23h de segunda em Brasília já é terça em UTC.
        expect(prazoDeComunicacao('2026-09-14T23:30:00-03:00').toISOString()).toBe(
            fimDoDia('2026-09-17')
        );
    });
});

describe('registro', () => {
    it('admin registra com protocolo, prazo e histórico; AuditLog sem o texto livre', async () => {
        const res = await api('post', '', BASE);
        expect(res.status).toBe(201);
        expect(res.body.data.protocolo).toMatch(/^INC-\d{4}-[0-9A-F]{8}$/);
        expect(res.body.data.situacao).toBe('aberto');
        expect(new Date(res.body.data.prazoAnpd).getTime()).toBeGreaterThan(Date.now());
        expect(res.body.data.historico[0]).toMatchObject({
            evento: 'registrado',
            por: String(admin._id),
        });

        const log = await AuditLog.findOne({ acao: 'INCIDENTE_REGISTRADO' }).lean();
        expect(log.recursoId).toBe(res.body.data.id);
        expect(JSON.stringify(log)).not.toContain('Joana');
    });

    it('recusa sem título, sem data de ciência, com ciência futura e categoria inválida', async () => {
        const futuro = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
        expect((await api('post', '', { ...BASE, titulo: '  ' })).status).toBe(400);
        expect((await api('post', '', { ...BASE, cienciaEm: undefined })).status).toBe(400);
        expect((await api('post', '', { ...BASE, cienciaEm: futuro })).status).toBe(400);
        expect((await api('post', '', { ...BASE, categoriasDados: ['cpf'] })).status).toBe(400);
        expect(await IncidenteSeguranca.countDocuments()).toBe(0);
    });

    it('prazo vencido aparece quando o risco não foi descartado e não houve comunicação', async () => {
        const antigo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
        const criado = await api('post', '', { ...BASE, cienciaEm: antigo });
        expect(criado.body.data.prazoVencido).toBe(true);

        const lista = await api('get', '');
        expect(lista.body.data[0].prazoVencido).toBe(true);
        // A lista não traz o texto livre.
        expect(lista.body.data[0].descricao).toBeUndefined();

        const descartado = await api('patch', `/${criado.body.data.id}`, {
            risco: 'nao_relevante',
        });
        expect(descartado.body.data.prazoVencido).toBe(false);
    });
});

describe('guarda', () => {
    it('a coleção não tem índice TTL', async () => {
        await api('post', '', BASE);
        const indices = await IncidenteSeguranca.collection.indexes();
        expect(indices.some((i) => i.expireAfterSeconds !== undefined)).toBe(false);
    });

    it('o modelo recusa exclusão e não há rota de exclusão', async () => {
        const criado = await api('post', '', BASE);
        await expect(IncidenteSeguranca.deleteOne({ _id: criado.body.data.id })).rejects.toThrow(
            /não pode ser excluído/
        );
        await expect(IncidenteSeguranca.deleteMany({})).rejects.toThrow(/não pode ser excluído/);
        const res = await api('delete', `/${criado.body.data.id}`);
        expect(res.status).toBe(404);
        expect(await IncidenteSeguranca.countDocuments()).toBe(1);
    });
});

describe('encerramento', () => {
    async function novo() {
        return (await api('post', '', BASE)).body.data.id;
    }

    it('não encerra com risco ainda a avaliar', async () => {
        const id = await novo();
        const res = await api('post', `/${id}/encerrar`);
        expect(res.status).toBe(409);
        expect(res.body.codigo).toBe('INCIDENTE_COM_PENDENCIA');
    });

    it('risco relevante exige comunicação à ANPD e aos titulares', async () => {
        const id = await novo();
        await api('patch', `/${id}`, { risco: 'relevante' });
        expect((await api('post', `/${id}/encerrar`)).body.pendencias).toHaveLength(2);

        await api('patch', `/${id}`, {
            comunicacaoAnpd: { comunicadoEm: new Date().toISOString(), protocolo: 'ANPD-123' },
            comunicacaoTitulares: { comunicadoEm: new Date().toISOString(), meio: 'e-mail' },
        });
        const res = await api('post', `/${id}/encerrar`);
        expect(res.status).toBe(200);
        expect(res.body.data.situacao).toBe('encerrado');
        expect(await AuditLog.countDocuments({ acao: 'INCIDENTE_ENCERRADO' })).toBe(1);
    });

    it('risco não relevante exige justificativa', async () => {
        const id = await novo();
        await api('patch', `/${id}`, {
            risco: 'nao_relevante',
            justificativaNaoComunicacao: 'curta',
        });
        expect((await api('post', `/${id}/encerrar`)).status).toBe(409);
        await api('patch', `/${id}`, {
            justificativaNaoComunicacao:
                'Arquivo cifrado; a chave não foi exposta, sem risco relevante.',
        });
        expect((await api('post', `/${id}/encerrar`)).status).toBe(200);
    });

    it('incidente encerrado não é mais alterado', async () => {
        const id = await novo();
        await api('patch', `/${id}`, {
            risco: 'nao_relevante',
            justificativaNaoComunicacao:
                'Arquivo cifrado; a chave não foi exposta, sem risco relevante.',
        });
        await api('post', `/${id}/encerrar`);
        const res = await api('patch', `/${id}`, { titulo: 'outro' });
        expect(res.status).toBe(409);
        expect(res.body.codigo).toBe('INCIDENTE_ENCERRADO');
    });
});

describe('acesso', () => {
    it('só admin: diretor, secretaria, professor e responsável recebem 403', async () => {
        for (const perfil of ['diretor', 'secretaria', 'professor', 'responsavel']) {
            const u = await criarUsuario({
                email: `${perfil}${Math.random()}@escola.test`,
                perfil,
            });
            const res = await api('get', '', null, u);
            expect({ perfil, status: res.status }).toEqual({ perfil, status: 403 });
        }
    });

    it('id malformado é 404, não 500', async () => {
        expect((await api('get', '/nao-e-um-id')).status).toBe(404);
        expect((await api('patch', '/nao-e-um-id', { titulo: 'x' })).status).toBe(404);
    });
});
