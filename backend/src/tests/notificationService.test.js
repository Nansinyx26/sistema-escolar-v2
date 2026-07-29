const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

// O envio real sai por HTTP para o serviço de push do navegador. O mock isola
// o teste da rede e deixa inspecionar o payload que chegaria ao celular.
jest.mock('../services/WebPushService', () => ({
  getPublicKey: () => 'chave-fake',
  sendPushNotification: jest.fn(async () => true)
}));

const NotificationService = require('../services/NotificationService');
const WebPushService = require('../services/WebPushService');
const Notificacao = require('../models/Notificacao');
const Usuario = require('../models/Usuario');

const INSCRICAO = {
  endpoint: 'https://push.exemplo/abc',
  keys: { p256dh: 'p', auth: 'a' }
};

function criarUsuario(extra = {}) {
  return Usuario.create({
    nome: 'Professora Ana',
    email: `ana${Math.random()}@t.com`,
    senha: 'x',
    perfil: 'professor',
    ativo: true,
    cpf: String(Math.random()),
    telefone: 't',
    ...extra
  });
}

beforeAll(async () => {
  await conectarBanco();
});

afterEach(async () => {
  await limparBanco();
});

afterAll(async () => {
  await desconectarBanco();
});

describe('NotificationService', () => {
  it('normaliza categoria e prioridade recebidas do frontend', async () => {
    const notif = await NotificationService.notify({
      tipo: 'informativo',
      categoria: 'Responsáveis',
      prioridade: 'media',
      titulo: 'Comunicado de teste',
      mensagem: 'Mensagem de teste',
      destinatarios: ['todos'],
      criadoPor: 'diretor'
    });

    expect(notif.categoria).toBe('responsaveis');
    expect(notif.prioridade).toBe('normal');

    const saved = await Notificacao.findById(notif._id);
    expect(saved.categoria).toBe('responsaveis');
    expect(saved.prioridade).toBe('normal');
  });
});

describe('NotificationService.pushParaUsuario — notificação no celular', () => {
  beforeEach(() => {
    WebPushService.sendPushNotification.mockClear();
    WebPushService.sendPushNotification.mockResolvedValue(true);
  });

  it('envia para cada dispositivo inscrito com título, prévia e link', async () => {
    const user = await criarUsuario({
      pushSubscriptions: [INSCRICAO, { ...INSCRICAO, endpoint: 'https://push.exemplo/def' }]
    });

    const entregues = await NotificationService.pushParaUsuario(user._id, {
      title: 'Diretor Carlos',
      body: 'Reunião amanhã às 8h',
      url: '/html/dashboard.html?chat=123',
      tag: 'chat-123'
    });

    expect(entregues).toBe(2);
    const [, payload] = WebPushService.sendPushNotification.mock.calls[0];
    expect(payload).toMatchObject({
      title: 'Diretor Carlos',
      body: 'Reunião amanhã às 8h',
      data: { url: '/html/dashboard.html?chat=123', id: 'chat-123' }
    });
  });

  it('respeita quem desligou o push nas preferências', async () => {
    const user = await criarUsuario({
      pushSubscriptions: [INSCRICAO],
      notificacoesPreferencias: { portal: true, push: false, email: true }
    });

    const entregues = await NotificationService.pushParaUsuario(user._id, {
      title: 'Diretor Carlos',
      body: 'Reunião amanhã'
    });

    expect(entregues).toBe(0);
    expect(WebPushService.sendPushNotification).not.toHaveBeenCalled();
  });

  it('remove do banco a inscrição que o serviço de push reportou como expirada', async () => {
    const user = await criarUsuario({ pushSubscriptions: [INSCRICAO] });
    WebPushService.sendPushNotification.mockResolvedValue('expired');

    const entregues = await NotificationService.pushParaUsuario(user._id, {
      title: 'Diretor Carlos',
      body: 'Reunião amanhã'
    });

    expect(entregues).toBe(0);
    const atualizado = await Usuario.findById(user._id).select('pushSubscriptions').lean();
    expect(atualizado.pushSubscriptions).toHaveLength(0);
  });

  it('não quebra quando o usuário não tem dispositivo inscrito', async () => {
    const user = await criarUsuario();

    await expect(
      NotificationService.pushParaUsuario(user._id, { title: 'Oi', body: 'tudo bem?' })
    ).resolves.toBe(0);
    expect(WebPushService.sendPushNotification).not.toHaveBeenCalled();
  });
});
