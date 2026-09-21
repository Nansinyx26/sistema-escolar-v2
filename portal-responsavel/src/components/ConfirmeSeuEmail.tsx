import { useState } from 'react';
import { reenviarVerificacaoEmail } from '../services/apiService';
import styles from '../styles/portal.module.scss';
import Icon from './ui/Icon';

interface ConfirmeSeuEmailProps {
  /** E-mail da conta, para a pessoa saber onde procurar. */
  email?: string;
  /** Chamado depois de confirmar, para recarregar a lista de alunos. */
  onTentarNovamente: () => void;
}

/**
 * Tela mostrada quando o servidor responde `EMAIL_NAO_VERIFICADO` (Issue #412).
 *
 * O e-mail do cadastro é a chave que liga a conta à ficha do aluno na escola.
 * Enquanto a posse dele não for confirmada, o portal não mostra dado de
 * criança — e esta tela explica isso sem jargão, com o caminho para resolver.
 */
export default function ConfirmeSeuEmail({ email, onTentarNovamente }: ConfirmeSeuEmailProps) {
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');

  const reenviar = async () => {
    setEnviando(true);
    setAviso('');
    try {
      await reenviarVerificacaoEmail();
      setAviso('Link enviado. Confira sua caixa de entrada e o spam.');
    } catch {
      setAviso('Não foi possível enviar agora. Tente de novo em alguns minutos.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={styles.emptyState} role="status">
      <Icon name="mail" size={40} />
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Confirme seu e-mail</h2>
      <p style={{ maxWidth: 420 }}>
        Enviamos um link de confirmação para <strong>{email || 'o e-mail do seu cadastro'}</strong>.
        É ele que liga a sua conta à ficha do seu filho na escola, então os dados só aparecem depois
        que você confirmar.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" onClick={reenviar} disabled={enviando}>
          {enviando ? 'Enviando…' : 'Reenviar link'}
        </button>
        <button type="button" onClick={onTentarNovamente}>
          Já confirmei
        </button>
      </div>
      {aviso && <p>{aviso}</p>}
      <p style={{ fontSize: '0.8rem' }}>
        Não recebeu? Procure a secretaria da escola para conferir o endereço cadastrado.
      </p>
    </div>
  );
}
