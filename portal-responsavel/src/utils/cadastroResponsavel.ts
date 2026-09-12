/**
 * cadastroResponsavel.ts — o corpo que o "Criar Conta" do portal envia a
 * `POST /api/auth/register-responsavel` (Issue #288).
 *
 * O formulário tinha só nome, e-mail e senha, e mandava o próprio estado da
 * tela ao servidor. O backend exige também telefone e o código secreto do
 * aluno, então TODO envio voltava 400: o botão existia, mas nunca criou uma
 * conta.
 *
 * A montagem mora aqui, separada da tela e sem nenhum `import`, de propósito:
 * `backend/src/tests/cadastroPortalResponsavel.test.js` executa esta função e
 * manda o resultado pelo controller de verdade. Se o backend passar a exigir um
 * campo que o portal não manda, aquele teste reprova — foi a falta dele que
 * deixou o formulário quebrado sem ninguém ver.
 */

/** Mesma versão de `backend/src/utils/consentimentoLgpd.js` e do CompletarCadastro. */
export const VERSAO_POLITICA_PRIVACIDADE = '2.0';

export interface FormularioCadastro {
  nome: string;
  email: string;
  senha: string;
  telefone: string;
  codigoSecreto: string;
  /** Caixa da Política de Privacidade: nasce desmarcada e é opcional. */
  aceitePolitica: boolean;
}

export interface CorpoCadastroResponsavel {
  nome: string;
  email: string;
  senha: string;
  telefone: string;
  codigoSecreto: string;
  consentimentoLgpd?: { aceito: true; versao: string };
}

/** Máscara `(00) 00000-0000` enquanto a pessoa digita — a mesma do EditarPerfil. */
export function mascaraTelefone(valor: string): string {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  if (digitos.length > 10) return digitos.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (digitos.length > 6) return digitos.replace(/^(\d{2})(\d{4})(\d{1,4})$/, '($1) $2-$3');
  if (digitos.length > 2) return digitos.replace(/^(\d{2})(\d{1,4})$/, '($1) $2');
  return digitos;
}

export function montarCorpoCadastro(formulario: FormularioCadastro): CorpoCadastroResponsavel {
  const corpo: CorpoCadastroResponsavel = {
    nome: formulario.nome.trim(),
    email: formulario.email.trim(),
    senha: formulario.senha,
    telefone: formulario.telefone.trim(),
    codigoSecreto: formulario.codigoSecreto.trim().toUpperCase(),
  };

  // Só vai consentimento quando a pessoa marcou a caixa. Criar a conta não é
  // consentir (Issue #236): sem a marcação, o aceite fica para o
  // CompletarCadastro, como no cadastro pela página HTML.
  if (formulario.aceitePolitica) {
    corpo.consentimentoLgpd = { aceito: true, versao: VERSAO_POLITICA_PRIVACIDADE };
  }

  return corpo;
}
