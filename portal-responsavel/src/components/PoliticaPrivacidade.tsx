/**
 * PoliticaPrivacidade.tsx
 * Página da Política de Privacidade dentro do Portal do Responsável.
 *
 * O rodapé do portal apontava para `/politica-privacidade.html`, um caminho que
 * o servidor não serve na raiz (o arquivo vive em `html/`, ver
 * `staticDirectories` em backend/src/app.js) — o botão dava 404. Além disso,
 * mandar um responsável já autenticado para uma página solta do site vanilla
 * significa sair do portal e voltar pelo login.
 *
 * Esta aba resolve os dois problemas: o mesmo texto legal, dentro da sessão,
 * com caminho de volta para o painel.
 *
 * O conteúdo é espelho de `html/politica-privacidade.html`. Ao revisar a
 * política, atualize OS DOIS arquivos e a data em `ULTIMA_ATUALIZACAO`.
 */
import { useEffect } from 'react';
import styles from '../styles/portal.module.scss';
import Icon from './ui/Icon';

const ULTIMA_ATUALIZACAO = '08 de maio de 2026';
const EMAIL_DPO = 'dpo@escola.edu.br';

interface PoliticaPrivacidadeProps {
  /** Volta para o painel. */
  onBack: () => void;
  /** Abre a aba de perfil, onde ficam os consentimentos e o termo LGPD. */
  onOpenConsents: () => void;
}

export default function PoliticaPrivacidade({ onBack, onOpenConsents }: PoliticaPrivacidadeProps) {
  // O acesso mais comum é pelo link do rodapé, ou seja, com a página já rolada
  // até o fim. Sem isto a política abriria no meio do texto.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className={styles.policyWrapper}>
      <div className={styles.pageHeader}>
        <span className={styles.pageEyebrow}>
          <Icon name="shield-lock" aria-hidden="true" /> Privacidade
        </span>
        <h1 className={styles.pageTitle}>Política de Privacidade</h1>
        <p className={styles.pageSubtitle}>
          Como a escola coleta, usa e protege os dados do seu filho(a) e os seus.
        </p>
      </div>

      <div className={styles.policyMeta}>
        <span className={styles.policyBadge}>
          <Icon name="circle-check" aria-hidden="true" /> Em conformidade com a LGPD (Lei
          13.709/2018)
        </span>
        <span className={styles.policyDate}>Última atualização: {ULTIMA_ATUALIZACAO}</span>
      </div>

      <article className={styles.policyCard}>
        <p className={styles.policyIntro}>
          Esta política descreve como o <strong>Sistema Escolar</strong> trata os dados pessoais de
          alunos e responsáveis. Ela vale para tudo o que você acessa por este portal — notas,
          frequência, ficha do aluno, comunicados e notificações.
        </p>

        <section className={styles.policySection}>
          <h2>
            <Icon name="clipboard-list" aria-hidden="true" /> 1. Dados que coletamos
          </h2>
          <p>Coletamos apenas o necessário para o funcionamento pedagógico e administrativo:</p>
          <ul>
            <li>
              <strong>Do responsável:</strong> nome, CPF, telefone, e-mail e vínculo de parentesco.
            </li>
            <li>
              <strong>Do aluno:</strong> nome, data de nascimento, RA/matrícula, CPF (se houver),
              foto (opcional), dados de saúde e registros acadêmicos.
            </li>
            <li>
              <strong>De acesso:</strong> registros de login e de ações no portal, para auditoria.
            </li>
          </ul>
        </section>

        <section className={styles.policySection}>
          <h2>
            <Icon name="school" aria-hidden="true" /> 2. Para que usamos
          </h2>
          <ul>
            <li>
              <strong>Gestão acadêmica:</strong> notas, frequência, horários e histórico escolar.
            </li>
            <li>
              <strong>Segurança e acesso:</strong> autenticação e controle de permissões.
            </li>
            <li>
              <strong>Saúde escolar:</strong> atendimento em emergências ou necessidades específicas
              (Art. 11 da LGPD).
            </li>
            <li>
              <strong>Obrigações legais:</strong> envio de dados obrigatórios ao MEC/INEP e aos
              conselhos de educação.
            </li>
          </ul>
        </section>

        <section className={styles.policySection}>
          <h2>
            <Icon name="lock" aria-hidden="true" /> 3. Dados sensíveis
          </h2>
          <p>
            Dados de saúde, deficiência (PCD), cor/etnia e religião são{' '}
            <strong>dados sensíveis</strong> pelo Art. 11 da LGPD. Eles recebem camadas extras de
            proteção e são acessados apenas por profissionais autorizados — equipe pedagógica e de
            saúde escolar — com finalidade específica.
          </p>
        </section>

        <section className={styles.policySection}>
          <h2>
            <Icon name="affiliate" aria-hidden="true" /> 4. Compartilhamento
          </h2>
          <p>
            A escola <strong>não vende nem comercializa</strong> dados pessoais. O compartilhamento
            acontece somente para:
          </p>
          <ul>
            <li>cumprir ordem judicial ou obrigação legal;</li>
            <li>operar serviços essenciais, como armazenamento em nuvem seguro;</li>
            <li>proteger a vida ou a integridade física do titular.</li>
          </ul>
        </section>

        <section className={styles.policySection}>
          <h2>
            <Icon name="clock" aria-hidden="true" /> 5. Por quanto tempo guardamos
          </h2>
          <p>
            Mantemos os dados pelo tempo necessário às finalidades acima, respeitando os prazos
            legais de guarda de documentos escolares (LDB e resoluções do conselho):
          </p>
          <ul>
            <li>
              <strong>Dados acadêmicos:</strong> no mínimo 5 anos após o desligamento.
            </li>
            <li>
              <strong>Logs de auditoria:</strong> mantidos para rastrear acessos e alterações.
            </li>
          </ul>
        </section>

        <section className={styles.policySection}>
          <h2>
            <Icon name="user-check" aria-hidden="true" /> 6. Seus direitos (Art. 18 da LGPD)
          </h2>
          <p>Como titular — ou responsável legal pelo titular — você pode:</p>
          <ul>
            <li>confirmar que existe tratamento dos dados;</li>
            <li>acessar os dados que temos;</li>
            <li>corrigir dados incompletos ou incorretos;</li>
            <li>pedir anonimização ou bloqueio de dados desnecessários;</li>
            <li>revogar o consentimento, quando ele for a base do tratamento.</li>
          </ul>
          <p>
            As preferências de consentimento — uso de imagem, canais de comunicação e uso pedagógico
            — ficam na sua conta e podem ser alteradas a qualquer momento.
          </p>
          <button type="button" className={styles.policyInlineBtn} onClick={onOpenConsents}>
            <Icon name="settings" aria-hidden="true" /> Gerenciar meus consentimentos
          </button>
        </section>

        <section className={styles.policySection}>
          <h2>
            <Icon name="mail" aria-hidden="true" /> 7. Falar com o encarregado (DPO)
          </h2>
          <p>
            Para tirar dúvidas sobre o tratamento dos dados ou exercer qualquer um dos direitos
            acima, escreva para o nosso Encarregado de Proteção de Dados:
          </p>
          <p>
            <a className={styles.policyLink} href={`mailto:${EMAIL_DPO}`}>
              {EMAIL_DPO}
            </a>
          </p>
        </section>
      </article>

      <div className={styles.policyFooter}>
        <button type="button" className={styles.policyBackBtn} onClick={onBack}>
          <Icon name="arrow-left" aria-hidden="true" /> Voltar para o painel
        </button>
      </div>
    </div>
  );
}
