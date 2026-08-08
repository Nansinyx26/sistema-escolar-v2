/**
 * codigosBackup2FA.test.js — códigos de recuperação de uso único
 *
 * Este é o caminho que devolve acesso quando o segundo fator por e-mail está
 * indisponível. Ele precisa funcionar exatamente quando tudo o mais falhou —
 * e, por ser um caminho de exceção, é o tipo de código que ninguém exercita no
 * dia a dia e que apodrece em silêncio. Daí a cobertura.
 */
const request = require('supertest');
const app = require('../app');
const {
    conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE,
} = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const Usuario = require('../models/Usuario');
const backup = require('../utils/codigosBackup');

async function sessaoAdmin() {
    const admin = await criarUsuario({ email: `adm_bk_${Date.now()}@escola.test`, perfil: 'admin' });
    return [`escola_jwt=${assinarTokenSessao(admin)}`];
}

/** Gera um lote para um usuário via rota de admin e devolve os códigos. */
async function gerarPara(usuarioId, cookies) {
    const res = await request(app)
        .post(`/api/admin/2fa/backup-codes/${usuarioId}`)
        .set('Cookie', cookies);
    return res;
}

/** Faz login com senha (para de 2FA) e devolve o cookie de pré-autenticação. */
async function loginAtePreAuth(email) {
    const res = await request(app).post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    const cookies = res.headers['set-cookie'] || [];
    const pre = cookies.find((c) => c.startsWith('escola_preauth'));
    return { res, preCookie: pre ? pre.split(';')[0] : null };
}

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

describe('Geração de códigos de backup', () => {
    it('admin gera 8 codigos e eles voltam UMA vez em texto puro', async () => {
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_gen@escola.test', perfil: 'diretor' });

        const res = await gerarPara(diretor._id, cookies);

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.codigos).toHaveLength(8);
        expect(new Set(res.body.codigos).size).toBe(8); // sem repetidos
        // Somente digitos: o campo de 2FA abre teclado numerico no celular,
        // o mesmo do codigo de 6 digitos que vem por e-mail.
        res.body.codigos.forEach((c) => expect(c).toMatch(/^\d{5}-\d{5}$/));
    });

    it('o banco guarda HASH, nunca o codigo em texto puro', async () => {
        // Um dump do banco nao pode virar um molho de chaves de segundo fator.
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_hash@escola.test', perfil: 'diretor' });

        const res = await gerarPara(diretor._id, cookies);
        const doc = await Usuario.findById(diretor._id).select('+twoFactorBackupCodes').lean();
        const serializado = JSON.stringify(doc.twoFactorBackupCodes);

        res.body.codigos.forEach((c) => {
            expect(serializado).not.toContain(c);
            expect(serializado).not.toContain(c.replace('-', ''));
        });
        expect(doc.twoFactorBackupCodes).toHaveLength(8);
    });

    it('gerar um lote novo INVALIDA o anterior', async () => {
        // Acumular lotes deixaria codigos impressos e esquecidos valendo para
        // sempre.
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_relote@escola.test', perfil: 'diretor' });

        const primeiro = await gerarPara(diretor._id, cookies);
        await gerarPara(diretor._id, cookies);

        const doc = await Usuario.findById(diretor._id).select('+twoFactorBackupCodes').lean();
        const indice = await backup.conferir(primeiro.body.codigos[0], doc.twoFactorBackupCodes);

        expect(indice).toBe(-1);
        expect(doc.twoFactorBackupCodes).toHaveLength(8);
    });

    it('a consulta informa quantos restam e NAO devolve os codigos', async () => {
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_saldo@escola.test', perfil: 'diretor' });
        const gerados = await gerarPara(diretor._id, cookies);

        const res = await request(app)
            .get(`/api/admin/2fa/backup-codes/${diretor._id}`)
            .set('Cookie', cookies);

        expect(res.body.disponiveis).toBe(8);
        expect(res.body.usados).toBe(0);
        gerados.body.codigos.forEach((c) => {
            expect(JSON.stringify(res.body)).not.toContain(c);
        });
    });

    it('so admin gera — diretor nao gera codigo para si mesmo', async () => {
        // Senao o segundo fator seria auto-emitivel por quem ja passou pelo
        // primeiro, o que o anula.
        const diretor = await criarUsuario({ email: 'dir_self@escola.test', perfil: 'diretor' });
        const cookiesDiretor = [`escola_jwt=${assinarTokenSessao(diretor)}`];

        const res = await gerarPara(diretor._id, cookiesDiretor);

        expect(res.status).toBe(403);
    });

    it('anonimo nao gera nada', async () => {
        const diretor = await criarUsuario({ email: 'dir_anon@escola.test', perfil: 'diretor' });
        const res = await request(app).post(`/api/admin/2fa/backup-codes/${diretor._id}`);
        expect(res.status).toBe(401);
    });
});

describe('Login com código de backup', () => {
    it('diretor entra com codigo de backup mesmo SEM e-mail entregue', async () => {
        // O cenario que motivou o recurso: provedor bloqueado, nenhum codigo
        // chegou, e a conta precisa entrar assim mesmo.
        const cookiesAdmin = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_login@escola.test', perfil: 'diretor' });
        const { codigos } = (await gerarPara(diretor._id, cookiesAdmin)).body;

        const { res: login, preCookie } = await loginAtePreAuth('dir_login@escola.test');
        expect(login.body.require2FA).toBe(true);

        const res = await request(app)
            .post('/api/auth/2fa/verify')
            .set('Cookie', [preCookie])
            .send({ codigo: codigos[0] });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.usouCodigoBackup).toBe(true);
        expect(res.body.codigosBackupRestantes).toBe(7);

        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some((c) => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('o mesmo codigo NAO funciona duas vezes', async () => {
        const cookiesAdmin = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_reuso@escola.test', perfil: 'diretor' });
        const { codigos } = (await gerarPara(diretor._id, cookiesAdmin)).body;

        const primeira = await loginAtePreAuth('dir_reuso@escola.test');
        const ok = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [primeira.preCookie]).send({ codigo: codigos[0] });
        expect(ok.status).toBe(200);

        const segunda = await loginAtePreAuth('dir_reuso@escola.test');
        const repetido = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [segunda.preCookie]).send({ codigo: codigos[0] });

        expect(repetido.status).toBe(401);
        expect(repetido.body.codigo).toBe('CODIGO_INVALIDO');
    });

    it('aceita o codigo em minusculas e sem hifen', async () => {
        // Vai ser lido de um papel ou ditado por telefone. Recusar por
        // formatacao gastaria uma das 5 tentativas de quem esta certo.
        const cookiesAdmin = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_fmt@escola.test', perfil: 'diretor' });
        const { codigos } = (await gerarPara(diretor._id, cookiesAdmin)).body;

        const { preCookie } = await loginAtePreAuth('dir_fmt@escola.test');
        const bagunçado = ` ${codigos[0].replace('-', '').toLowerCase()} `;

        const res = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [preCookie]).send({ codigo: bagunçado });

        expect(res.status).toBe(200);
        expect(res.body.usouCodigoBackup).toBe(true);
    });

    it('codigo de backup de OUTRA conta nao serve', async () => {
        const cookiesAdmin = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'dir_alvo@escola.test', perfil: 'diretor' });
        const outro = await criarUsuario({ email: 'dir_outro@escola.test', perfil: 'diretor' });
        const { codigos } = (await gerarPara(outro._id, cookiesAdmin)).body;
        await gerarPara(alvo._id, cookiesAdmin);

        const { preCookie } = await loginAtePreAuth('dir_alvo@escola.test');
        const res = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [preCookie]).send({ codigo: codigos[0] });

        expect(res.status).toBe(401);
    });

    it('conta SEM lote gerado nao ganha nenhum atalho', async () => {
        await criarUsuario({ email: 'dir_semlote@escola.test', perfil: 'diretor' });
        const { preCookie } = await loginAtePreAuth('dir_semlote@escola.test');

        const res = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [preCookie]).send({ codigo: 'ABCDE-FGHJK' });

        expect(res.status).toBe(401);
    });

    it('sem pre-autenticacao o codigo de backup nao vale — a senha ainda e obrigatoria', async () => {
        // O codigo de backup e SEGUNDO fator, nao substitui o primeiro.
        const cookiesAdmin = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_sempre@escola.test', perfil: 'diretor' });
        const { codigos } = (await gerarPara(diretor._id, cookiesAdmin)).body;

        const res = await request(app).post('/api/auth/2fa/verify').send({ codigo: codigos[0] });

        expect(res.status).toBe(401);
        expect(res.body.codigo).toBe('PREAUTH_INVALIDO');
    });

    it('o codigo por e-mail continua funcionando junto com o de backup', async () => {
        // O recurso novo nao pode ter quebrado o caminho normal.
        const cookiesAdmin = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_ambos@escola.test', perfil: 'diretor' });
        await gerarPara(diretor._id, cookiesAdmin);

        const { preCookie } = await loginAtePreAuth('dir_ambos@escola.test');

        // Planta um código de e-mail conhecido, como o login faria.
        const crypto = require('crypto');
        const codigoEmail = '246813';
        await Usuario.findByIdAndUpdate(diretor._id, {
            twoFactorPendingToken: crypto.createHash('sha256').update(codigoEmail).digest('hex'),
            twoFactorPendingExpiry: new Date(Date.now() + 5 * 60 * 1000),
            twoFactorAttempts: 0,
        });

        const res = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [preCookie]).send({ codigo: codigoEmail });

        expect(res.status).toBe(200);
        expect(res.body.usouCodigoBackup).toBeUndefined();
    });
});

describe('Unidade: utils/codigosBackup', () => {
    it('conferir devolve -1 para codigo ja usado', async () => {
        const { codigos, registros } = await backup.gerarLote(3);
        registros[1].usadoEm = new Date();

        expect(await backup.conferir(codigos[0], registros)).toBe(0);
        expect(await backup.conferir(codigos[1], registros)).toBe(-1);
        expect(await backup.conferir(codigos[2], registros)).toBe(2);
    });

    it('gera SOMENTE digitos', async () => {
        // Se voltasse a sair letra, o teclado numerico do celular deixaria de
        // conseguir digitar o codigo — que foi o motivo da troca de alfabeto.
        const { codigos } = await backup.gerarLote(20);
        codigos.forEach((c) => expect(c).toMatch(/^\d{5}-\d{5}$/));
    });

    it('o codigo de backup nao se confunde com o de 6 digitos do e-mail', async () => {
        // Ambos sao numericos agora; o COMPRIMENTO e o que separa os dois, e
        // `pareceCodigoBackup` decide qual caminho o verify vai tentar.
        expect(backup.pareceCodigoBackup('1234567890')).toBe(true);
        expect(backup.pareceCodigoBackup('12345-67890')).toBe(true);
        expect(backup.pareceCodigoBackup('123456')).toBe(false);   // codigo do e-mail
        expect(backup.pareceCodigoBackup('12345678901')).toBe(false);
    });

    it('valor que nao tem cara de codigo de backup e rejeitado sem custo', async () => {
        const { registros } = await backup.gerarLote(2);
        expect(await backup.conferir('123456', registros)).toBe(-1); // 6 digitos: nao e backup
        expect(await backup.conferir('', registros)).toBe(-1);
        expect(await backup.conferir(null, registros)).toBe(-1);
    });
});

describe('Código fixo de 2FA — guardado como hash', () => {
    const crypto = require('crypto');

    it('login com codigo fixo funciona e o valor NAO fica legivel no banco', async () => {
        const diretor = await criarUsuario({ email: 'dir_fixo@escola.test', perfil: 'diretor' });
        const CODIGO = '135791';
        await Usuario.findByIdAndUpdate(diretor._id, {
            twoFactorFixedCode: await backup.hashSegredo(CODIGO),
            twoFactorEnabled: true,
        });

        const doc = await Usuario.findById(diretor._id).select('+twoFactorFixedCode').lean();
        expect(doc.twoFactorFixedCode).not.toContain(CODIGO);

        const { preCookie } = await loginAtePreAuth('dir_fixo@escola.test');
        const res = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [preCookie]).send({ codigo: CODIGO });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('o login NAO grava mais o codigo em twoFactorPendingToken', async () => {
        // Antes, o login lia o codigo fixo em texto puro e reconstruia um
        // SHA-256 em PendingToken. Com o valor hasheado isso deixou de ser
        // possivel — e nem deve ser: SHA-256 sobre 6 digitos cai em
        // milissegundos de forca bruta.
        const diretor = await criarUsuario({ email: 'dir_fixo2@escola.test', perfil: 'diretor' });
        await Usuario.findByIdAndUpdate(diretor._id, {
            twoFactorFixedCode: await backup.hashSegredo('246802'),
            twoFactorEnabled: true,
        });

        await loginAtePreAuth('dir_fixo2@escola.test');

        const doc = await Usuario.findById(diretor._id)
            .select('+twoFactorPendingToken +twoFactorPendingExpiry').lean();
        expect(doc.twoFactorPendingToken).toBeNull();
        // A janela de 5 minutos continua valendo.
        expect(doc.twoFactorPendingExpiry).toBeTruthy();
    });

    it('codigo fixo ERRADO e recusado', async () => {
        const diretor = await criarUsuario({ email: 'dir_fixo3@escola.test', perfil: 'diretor' });
        await Usuario.findByIdAndUpdate(diretor._id, {
            twoFactorFixedCode: await backup.hashSegredo('111222'),
            twoFactorEnabled: true,
        });

        const { preCookie } = await loginAtePreAuth('dir_fixo3@escola.test');
        const res = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [preCookie]).send({ codigo: '999888' });

        expect(res.status).toBe(401);
        expect(res.body.codigo).toBe('CODIGO_INVALIDO');
    });

    it('valor LEGADO em texto puro e RECUSADO', async () => {
        // O unico valor legado conhecido esteve versionado em repositorio
        // publico. Aceitar o formato antigo manteria vivo o problema.
        const diretor = await criarUsuario({ email: 'dir_legado@escola.test', perfil: 'diretor' });
        await Usuario.findByIdAndUpdate(diretor._id, {
            // Formato antigo (texto puro). Valor sintetico de proposito: repetir
            // o codigo real que vazou o reintroduziria num arquivo novo e
            // voltaria a disparar o scanner de segredos.
            twoFactorFixedCode: '007007',
            twoFactorEnabled: true,
        });

        const { preCookie } = await loginAtePreAuth('dir_legado@escola.test');
        const res = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [preCookie]).send({ codigo: '007007' });

        expect(res.status).toBe(401);
    });

    it('hashSegredo/conferirSegredo: casa o certo, recusa o errado', async () => {
        const h = await backup.hashSegredo('654321');
        expect(await backup.conferirSegredo('654321', h)).toBe(true);
        expect(await backup.conferirSegredo('654320', h)).toBe(false);
        expect(await backup.conferirSegredo('654321', '654321')).toBe(false); // legado
        expect(backup.ehFormatoLegado('654321')).toBe(true);
        expect(backup.ehFormatoLegado(h)).toBe(false);
    });
});

describe('Código fixo pela rota de admin', () => {
    const rota = (id) => `/api/admin/2fa/codigo-fixo/${id}`;

    it('gera um codigo aleatorio de 6 digitos e o devolve UMA vez', async () => {
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_fx_gen@escola.test', perfil: 'diretor' });

        const res = await request(app).post(rota(diretor._id)).set('Cookie', cookies).send({});

        expect(res.status).toBe(200);
        expect(res.body.codigo).toMatch(/^\d{6}$/);

        // No banco fica so o hash.
        const doc = await Usuario.findById(diretor._id).select('+twoFactorFixedCode').lean();
        expect(doc.twoFactorFixedCode).not.toContain(res.body.codigo);
        expect(doc.twoFactorFixedCode).toContain(':');   // formato salt:hash
    });

    it('aceita um codigo escolhido pelo administrador', async () => {
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_fx_esc@escola.test', perfil: 'diretor' });

        const res = await request(app).post(rota(diretor._id)).set('Cookie', cookies).send({ codigo: '246813' });

        expect(res.body.codigo).toBe('246813');

        // E ele funciona de verdade no login.
        const { preCookie } = await loginAtePreAuth('dir_fx_esc@escola.test');
        const login = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [preCookie]).send({ codigo: '246813' });
        expect(login.status).toBe(200);
    });

    it('recusa codigo com tamanho errado', async () => {
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_fx_ruim@escola.test', perfil: 'diretor' });

        for (const ruim of ['12345', '1234567', 'abcdef']) {
            const res = await request(app).post(rota(diretor._id)).set('Cookie', cookies).send({ codigo: ruim });
            expect(`${ruim}:${res.status}`).toBe(`${ruim}:400`);
        }
    });

    it('a consulta diz se existe, sem revelar o valor', async () => {
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_fx_stat@escola.test', perfil: 'diretor' });

        const antes = await request(app).get(rota(diretor._id)).set('Cookie', cookies);
        expect(antes.body.definido).toBe(false);

        const criado = await request(app).post(rota(diretor._id)).set('Cookie', cookies).send({});
        const depois = await request(app).get(rota(diretor._id)).set('Cookie', cookies);

        expect(depois.body.definido).toBe(true);
        expect(JSON.stringify(depois.body)).not.toContain(criado.body.codigo);
    });

    it('sinaliza o formato LEGADO, que o login recusa', async () => {
        // Sem esta sinalizacao a conta parece protegida e simplesmente nao entra.
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_fx_leg@escola.test', perfil: 'diretor' });
        await Usuario.findByIdAndUpdate(diretor._id, { twoFactorFixedCode: '007007' });

        const res = await request(app).get(rota(diretor._id)).set('Cookie', cookies);

        expect(res.body.definido).toBe(true);
        expect(res.body.legado).toBe(true);
    });

    it('remover apaga o codigo fixo', async () => {
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'dir_fx_del@escola.test', perfil: 'diretor' });
        await request(app).post(rota(diretor._id)).set('Cookie', cookies).send({});

        const res = await request(app).delete(rota(diretor._id)).set('Cookie', cookies);
        expect(res.body.ok).toBe(true);

        const doc = await Usuario.findById(diretor._id).select('+twoFactorFixedCode').lean();
        expect(doc.twoFactorFixedCode).toBeUndefined();
    });

    it('so admin mexe no codigo fixo', async () => {
        // Se o diretor pudesse definir o proprio, o segundo fator seria
        // auto-emitivel por quem ja passou pelo primeiro.
        const diretor = await criarUsuario({ email: 'dir_fx_self@escola.test', perfil: 'diretor' });
        const cookiesDiretor = [`escola_jwt=${assinarTokenSessao(diretor)}`];

        const post = await request(app).post(rota(diretor._id)).set('Cookie', cookiesDiretor).send({});
        const del = await request(app).delete(rota(diretor._id)).set('Cookie', cookiesDiretor);

        expect(post.status).toBe(403);
        expect(del.status).toBe(403);
    });
});

describe('Recuperação de senha — hash e não vazamento', () => {
    const RecuperacaoSenha = require('../models/RecuperacaoSenha');
    const fs = require('fs');
    const path = require('path');

    it('o codigo vai HASHEADO para o banco, nunca em texto puro', async () => {
        // Antes ia em texto puro: um dump da colecao entregava, para cada
        // pedido em aberto, uma redefinicao de senha pronta para usar.
        const u = await criarUsuario({ email: 'rec_hash@escola.test' });

        await request(app).post('/api/auth/forgot-password').send({ email: 'rec_hash@escola.test' });

        const reg = await RecuperacaoSenha.findOne({ usuarioId: u._id, status: 'ativo' }).lean();
        expect(reg).toBeTruthy();
        expect(reg.codigo).toContain(':');            // formato salt:hash
        expect(reg.codigo).not.toMatch(/^\d{6}$/);    // não é o código cru
    });

    it('NAO escreve o codigo em latest_code.txt', async () => {
        // O arquivo era gravado a cada pedido, sem guarda de ambiente — ou
        // seja, tambem em producao, com um codigo valido em texto puro.
        const alvo = path.join(__dirname, '../../latest_code.txt');
        try { fs.unlinkSync(alvo); } catch (e) { /* ja nao existia */ }

        await criarUsuario({ email: 'rec_file@escola.test' });
        await request(app).post('/api/auth/forgot-password').send({ email: 'rec_file@escola.test' });

        expect(fs.existsSync(alvo)).toBe(false);
    });

    it('a resposta nunca traz o codigo, nem com NODE_ENV=development', async () => {
        // Havia um `code_debug` condicionado so a NODE_ENV: uma variavel mal
        // configurada num deploy virava oraculo de tomada de conta.
        const original = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        try {
            await criarUsuario({ email: 'rec_debug@escola.test' });
            const res = await request(app).post('/api/auth/forgot-password').send({ email: 'rec_debug@escola.test' });

            expect(res.body.code_debug).toBeUndefined();
            expect(JSON.stringify(res.body)).not.toMatch(/\d{6}/);
        } finally {
            process.env.NODE_ENV = original;
        }
    });

    it('e-mail inexistente devolve a MESMA resposta — sem enumeracao', async () => {
        await criarUsuario({ email: 'rec_existe@escola.test' });

        const existe = await request(app).post('/api/auth/forgot-password').send({ email: 'rec_existe@escola.test' });
        const naoExiste = await request(app).post('/api/auth/forgot-password').send({ email: 'nunca@escola.test' });

        expect(existe.body).toEqual(naoExiste.body);
    });

    it('admin dispara a recuperacao e o codigo NAO volta na resposta', async () => {
        const cookies = await sessaoAdmin();
        const diretor = await criarUsuario({ email: 'rec_admin@escola.test', perfil: 'diretor' });

        const res = await request(app)
            .post(`/api/admin/recuperacao-senha/${diretor._id}`)
            .set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.destinatario).toBe('re***@escola.test');
        expect(JSON.stringify(res.body)).not.toMatch(/\d{6}/);

        // E o pedido existe de verdade no banco.
        const reg = await RecuperacaoSenha.findOne({ usuarioId: diretor._id, status: 'ativo' }).lean();
        expect(reg).toBeTruthy();
    });

    it('admin nao dispara para conta sem e-mail valido', async () => {
        const cookies = await sessaoAdmin();
        const u = await criarUsuario({ email: 'rec_semmail@escola.test' });
        await Usuario.updateOne({ _id: u._id }, { $set: { email: 'sem-arroba' } });

        const res = await request(app)
            .post(`/api/admin/recuperacao-senha/${u._id}`)
            .set('Cookie', cookies);

        expect(res.status).toBe(422);
    });

    it('so admin dispara a recuperacao pela rota administrativa', async () => {
        const diretor = await criarUsuario({ email: 'rec_self@escola.test', perfil: 'diretor' });
        const cookiesDiretor = [`escola_jwt=${assinarTokenSessao(diretor)}`];

        const res = await request(app)
            .post(`/api/admin/recuperacao-senha/${diretor._id}`)
            .set('Cookie', cookiesDiretor);

        expect(res.status).toBe(403);
    });
});
