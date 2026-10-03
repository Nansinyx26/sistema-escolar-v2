/**
 * TrocarEmail.tsx — "Trocar e-mail" no perfil do responsável (Issue #610).
 *
 * O pedido leva o e-mail novo e a senha atual; o servidor manda o link de
 * confirmação só para o endereço novo, e a troca só vale quando a pessoa abre o
 * link com esta conta conectada (Issue #609). Por isso, depois de enviar, a
 * tela não diz "e-mail trocado": diz para onde foi o link e quanto tempo vale.
 *
 * Conta criada pelo Google não troca: o login dela acha a conta pelo e-mail, e
 * o endereço novo criaria outra conta, sem os filhos.
 */
import type React from 'react';
import { useEffect, useId, useState } from 'react';
import { ApiError, solicitarTrocaEmail } from '../services/apiService';
import styles from '../styles/portal.module.scss';
import type { AuthUser } from '../types';
import Dialog from './ui/Dialog';
import Icon from './ui/Icon';

const VALIDADE_HORAS = 2;

type Etapa = 'formulario' | 'enviando' | 'enviado';

export default function TrocarEmail({ user }: { user: AuthUser }) {
  const [aberto, setAberto] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>('formulario');
  const [novoEmail, setNovoEmail] = useState('');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [erro, setErro] = useState('');
  const idEmail = useId();
  const idSenha = useId();
  const idErro = useId();

  // Fechar descarta o que foi digitado: a senha não fica na memória da tela.
  useEffect(() => {
    if (!aberto) {
      setEtapa('formulario');
      setNovoEmail('');
      setSenhaAtual('');
      setErro('');
    }
  }, [aberto]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = novoEmail.trim();
    if (!email || !senhaAtual) {
      setErro('Preencha o e-mail novo e a sua senha atual.');
      return;
    }
    if (email.toLowerCase() === String(user.email || '').toLowerCase()) {
      setErro('Este já é o e-mail da conta.');
      return;
    }
    setEtapa('enviando');
    setErro('');
    try {
      await solicitarTrocaEmail(email, senhaAtual);
      setSenhaAtual('');
      setEtapa('enviado');
    } catch (err) {
      setErro(
        err instanceof ApiError ? err.message : 'Não foi possível enviar agora. Tente de novo.'
      );
      setEtapa('formulario');
    }
  };

  return (
    <section
      className={styles.profileFormSection}
      aria-labelledby="trocar-email-titulo"
      style={{ marginTop: '32px' }}
    >
      <h3 id="trocar-email-titulo" className={styles.profileSectionTitle}>
        <Icon name="mail" /> E-mail da conta
      </h3>
      <p style={{ margin: '0 0 12px', fontWeight: 600, overflowWrap: 'anywhere' }}>{user.email}</p>

      {user.loginGoogle ? (
        <p
          style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: '0.85rem',
            lineHeight: 1.5,
          }}
        >
          Sua conta entra pelo Google, que reconhece você pelo e-mail. Trocar o endereço criaria
          outra conta no próximo login. Para mudar, procure a secretaria da escola.
        </p>
      ) : (
        <Dialog
          open={aberto}
          onOpenChange={setAberto}
          icon={<Icon name="mail" />}
          title="Trocar e-mail"
          description={`Enviaremos um link de confirmação para o endereço novo. A troca só acontece quando você abrir o link com esta conta conectada, em até ${VALIDADE_HORAS} horas.`}
          trigger={
            <button type="button" className={styles.actionBtn}>
              <Icon name="mail" /> Trocar e-mail
            </button>
          }
        >
          {etapa === 'enviado' ? (
            <div role="status" style={{ display: 'grid', gap: '12px' }}>
              <p style={{ margin: 0, lineHeight: 1.5 }}>
                Se <strong style={{ overflowWrap: 'anywhere' }}>{novoEmail.trim()}</strong> puder
                ser usado, o link de confirmação chega nele em instantes. Abra o link neste
                aparelho, com esta conta conectada, em até {VALIDADE_HORAS} horas.
              </p>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Até lá, nada muda: você continua entrando com {user.email}.
              </p>
              <button type="button" className={styles.submitBtn} onClick={() => setAberto(false)}>
                Entendi
              </button>
            </div>
          ) : (
            <form onSubmit={enviar} noValidate aria-describedby={erro ? idErro : undefined}>
              {erro && (
                <div
                  id={idErro}
                  className={styles.sidebarError}
                  role="alert"
                  style={{ marginBottom: '16px' }}
                >
                  <Icon name="alert-circle" /> <span>{erro}</span>
                </div>
              )}
              <div className={styles.formGroup} style={{ marginBottom: '16px' }}>
                <label className={styles.formLabel} htmlFor={idEmail}>
                  E-mail novo
                </label>
                <div className={styles.inputWrapper}>
                  <Icon name="mail" />
                  <input
                    id={idEmail}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    className={styles.formInput}
                    value={novoEmail}
                    onChange={(e) => setNovoEmail(e.target.value)}
                    placeholder="nome@exemplo.com"
                    required
                  />
                </div>
              </div>
              <div className={styles.formGroup} style={{ marginBottom: '20px' }}>
                <label className={styles.formLabel} htmlFor={idSenha}>
                  Senha atual
                </label>
                <div className={styles.inputWrapper}>
                  <Icon name="lock" />
                  <input
                    id={idSenha}
                    type="password"
                    autoComplete="current-password"
                    className={styles.formInput}
                    value={senhaAtual}
                    onChange={(e) => setSenhaAtual(e.target.value)}
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                className={styles.submitBtn}
                disabled={etapa === 'enviando'}
                aria-busy={etapa === 'enviando'}
              >
                {etapa === 'enviando' ? 'Enviando…' : 'Enviar link de confirmação'}
              </button>
            </form>
          )}
        </Dialog>
      )}
    </section>
  );
}
