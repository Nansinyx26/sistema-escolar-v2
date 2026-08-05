/**
 * authorizeEstrito.test.js
 *
 * `authorize` libera `admin` antes de qualquer outra checagem. Isso é adequado
 * para quase toda rota, mas não para as que servem CONTEÚDO de conversa: ali o
 * atalho vira acesso a mensagem de responsável e de aluno de qualquer escola da
 * base, sem que ninguém tenha escolhido um tenant.
 *
 * `authorize.estrito` mantém o mesmo RBAC e só acrescenta uma exigência: o admin
 * precisa dizer de qual escola está falando. Não é barreira de segurança forte —
 * ele pode informar qualquer uma —, é barreira de INTENÇÃO, para que o acesso
 * seja um ato deliberado e registrável em vez de efeito colateral do perfil.
 *
 * Sem rota consumidora ainda (ver docs/moderacao/ESPEC-MODERACAO-CHAT.md §7.2),
 * então o teste exercita o middleware direto.
 */
const authorize = require('../middleware/authorize');

/** Duplas de req/res mínimas para rodar um middleware isolado. */
function fakeRes() {
    return {
        statusCode: null,
        body: null,
        status(codigo) { this.statusCode = codigo; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

function rodar(middleware, req) {
    const res = fakeRes();
    let passou = false;
    middleware(req, res, () => { passou = true; });
    return { passou, res };
}

describe('authorize (comportamento atual, não deve mudar)', () => {
    it('deixa o admin passar sem nenhum contexto de escola', () => {
        const { passou } = rodar(authorize('diretor'), { user: { perfil: 'admin' } });
        expect(passou).toBe(true);
    });

    it('deixa passar o perfil listado', () => {
        const { passou } = rodar(authorize('diretor', 'coordenacao'), { user: { perfil: 'coordenacao' } });
        expect(passou).toBe(true);
    });

    it('barra o perfil não listado com 403', () => {
        const { passou, res } = rodar(authorize('diretor'), { user: { perfil: 'professor' } });
        expect(passou).toBe(false);
        expect(res.statusCode).toBe(403);
    });

    it('barra quem não está autenticado com 401', () => {
        const { passou, res } = rodar(authorize('diretor'), {});
        expect(passou).toBe(false);
        expect(res.statusCode).toBe(401);
    });
});

describe('authorize.estrito', () => {
    it('barra o admin que não informou escola alguma', () => {
        const { passou, res } = rodar(authorize.estrito('diretor'), { user: { perfil: 'admin' } });

        expect(passou).toBe(false);
        expect(res.statusCode).toBe(400);
        expect(res.body.codigo).toBe('ESCOLA_NAO_INFORMADA');
    });

    it('deixa o admin passar quando o tenant já foi resolvido (req.escolaId)', () => {
        const { passou } = rodar(authorize.estrito('diretor'), {
            user: { perfil: 'admin' },
            escolaId: 'escola-123'
        });
        expect(passou).toBe(true);
    });

    it('aceita a escola vinda da query ou do body', () => {
        const porQuery = rodar(authorize.estrito('diretor'), {
            user: { perfil: 'admin' }, query: { escolaId: 'escola-123' }
        });
        expect(porQuery.passou).toBe(true);

        const porBody = rodar(authorize.estrito('diretor'), {
            user: { perfil: 'admin' }, body: { escolaId: 'escola-123' }
        });
        expect(porBody.passou).toBe(true);
    });

    it('não pede escola a quem não é admin — esses já vêm presos ao próprio tenant', () => {
        const { passou } = rodar(authorize.estrito('diretor'), { user: { perfil: 'diretor' } });
        expect(passou).toBe(true);
    });

    it('mantém o 403 do RBAC para perfil não listado, mesmo com escola informada', () => {
        const { passou, res } = rodar(authorize.estrito('diretor'), {
            user: { perfil: 'professor' }, escolaId: 'escola-123'
        });
        expect(passou).toBe(false);
        expect(res.statusCode).toBe(403);
    });

    it('mantém o 401 para quem não está autenticado', () => {
        const { passou, res } = rodar(authorize.estrito('diretor'), {});
        expect(passou).toBe(false);
        expect(res.statusCode).toBe(401);
    });
});
