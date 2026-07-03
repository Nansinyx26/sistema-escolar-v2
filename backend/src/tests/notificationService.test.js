const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const NotificationService = require('../services/NotificationService');
const Notificacao = require('../models/Notificacao');

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
