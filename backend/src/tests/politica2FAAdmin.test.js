/**
 * politica2FAAdmin.test.js — aviso de boot para admin sem segundo fator (Issue #467)
 *
 * O padrão da política deixa o admin fora da exigência por perfil, para que o
 * rollout seja feito conta a conta (docs/2FA-OBRIGATORIO.md). O aviso existe
 * para que "ainda não ativei" não vire "esqueci": ele só fica calado quando o
 * perfil está coberto ou quando nenhuma conta admin entra só com senha.
 *
 * Função pura, sem banco: a contagem chega pronta do boot.
 */
const politica = require('../utils/politica2FA');

const ORIGINAL_PERFIS = process.env.PERFIS_2FA_OBRIGATORIO;
const ORIGINAL_DISPENSA = process.env.DISPENSAR_2FA_EMAIL;

afterEach(() => {
    if (ORIGINAL_PERFIS === undefined) delete process.env.PERFIS_2FA_OBRIGATORIO;
    else process.env.PERFIS_2FA_OBRIGATORIO = ORIGINAL_PERFIS;
    if (ORIGINAL_DISPENSA === undefined) delete process.env.DISPENSAR_2FA_EMAIL;
    else process.env.DISPENSAR_2FA_EMAIL = ORIGINAL_DISPENSA;
});

describe('adminCobertoPelaPolitica', () => {
    it('no padrão, o admin não está coberto', () => {
        delete process.env.PERFIS_2FA_OBRIGATORIO;
        delete process.env.DISPENSAR_2FA_EMAIL;
        expect(politica.adminCobertoPelaPolitica()).toBe(false);
    });

    it('com admin na variável, está coberto', () => {
        process.env.PERFIS_2FA_OBRIGATORIO = 'diretor,secretaria,admin';
        delete process.env.DISPENSAR_2FA_EMAIL;
        expect(politica.adminCobertoPelaPolitica()).toBe(true);
    });

    it('a dispensa do admin descobre o perfil mesmo com ele na variável', () => {
        process.env.PERFIS_2FA_OBRIGATORIO = 'diretor,secretaria,admin';
        process.env.DISPENSAR_2FA_EMAIL = 'admin';
        expect(politica.adminCobertoPelaPolitica()).toBe(false);
    });
});

describe('filtroAdminSemSegundoFator', () => {
    it('sem dispensa, conta só quem não ligou o segundo fator na conta', () => {
        delete process.env.DISPENSAR_2FA_EMAIL;
        expect(politica.filtroAdminSemSegundoFator()).toEqual({
            perfil: 'admin',
            ativo: { $ne: false },
            twoFactorEnabled: { $ne: true },
        });
    });

    it('com o admin dispensado, conta toda conta admin ativa', () => {
        // A dispensa vence o twoFactorEnabled da conta: todas entram só com senha.
        process.env.DISPENSAR_2FA_EMAIL = 'admin';
        expect(politica.filtroAdminSemSegundoFator()).toEqual({
            perfil: 'admin',
            ativo: { $ne: false },
        });
    });
});

describe('avisoAdminSemSegundoFator', () => {
    it('cala quando o admin está coberto, qualquer que seja a contagem', () => {
        process.env.PERFIS_2FA_OBRIGATORIO = 'admin';
        delete process.env.DISPENSAR_2FA_EMAIL;
        expect(politica.avisoAdminSemSegundoFator(3)).toBeNull();
    });

    it('cala quando nenhuma conta admin entra só com senha', () => {
        delete process.env.PERFIS_2FA_OBRIGATORIO;
        expect(politica.avisoAdminSemSegundoFator(0)).toBeNull();
        expect(politica.avisoAdminSemSegundoFator(undefined)).toBeNull();
    });

    it('avisa com a quantidade e o caminho para resolver', () => {
        delete process.env.PERFIS_2FA_OBRIGATORIO;
        const aviso = politica.avisoAdminSemSegundoFator(2);
        expect(aviso).toContain('2 contas admin ativas');
        expect(aviso).toContain('docs/2FA-OBRIGATORIO.md');
        expect(aviso).toContain('PERFIS_2FA_OBRIGATORIO');
    });

    it('concorda no singular', () => {
        delete process.env.PERFIS_2FA_OBRIGATORIO;
        expect(politica.avisoAdminSemSegundoFator(1)).toContain('1 conta admin ativa entra');
    });

    it('avisa também quando o admin está dispensado', () => {
        process.env.PERFIS_2FA_OBRIGATORIO = 'admin';
        process.env.DISPENSAR_2FA_EMAIL = 'admin';
        expect(politica.avisoAdminSemSegundoFator(1)).not.toBeNull();
    });
});
