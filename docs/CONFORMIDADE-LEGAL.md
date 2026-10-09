# Conformidade legal — o que a lei exige e onde isso vive no código

> Este documento é o **mapa** entre exigência legal e arquivo. Ele serve para
> duas perguntas que aparecem em edital de licitação e em auditoria da
> prefeitura: *"o sistema cumpre?"* e *"me mostre onde"*.
>
> Ele também diz, sem eufemismo, **o que ainda não está pronto**. Um mapa que
> só lista o que funciona é pior que nenhum: ele faz a rede assinar um termo de
> conformidade sobre uma lacuna que ninguém sabia que existia.

Leis consideradas: **LGPD** (13.709/2018) e as resoluções da ANPD (nº 15/2024
incidentes, nº 18/2024 encarregado, nº 19/2024 transferência internacional),
**ECA** (8.069/1990), **ECA Digital** (Lei 15.211/2025, em vigor desde
17/03/2026, regulamentado pelo Decreto 12.880/2026), **Lei Henry Borel**
(14.344/2022), **Política de Prevenção da Automutilação e do Suicídio** (Lei
13.819/2019, com a Lei 15.231/2025), **Programa de Combate à Intimidação Sistemática** (Lei
13.185/2015, com a Lei 14.811/2024), **Marco Civil da Internet** (12.965/2014),
**LBI** (13.146/2015) com a **ABNT NBR 17225:2025**, **LDB** (9.394/1996, com a
Lei 13.803/2019), **LAI** (12.527/2011), **nome social** (Decreto 8.727/2016 e
Resolução CNE/CP nº 1/2018) e as exigências do **Censo Escolar/INEP**. As
normas do **Estado de São Paulo** e do **município de Americana** estão na §9.

> **Revisão de setembro de 2026.** A pesquisa da legislação vigente achou
> lacunas que este mapa não listava, numeradas de 7 a 17 na §7 e na §9. Os
> deveres de lei que pediam código — nome social, comunicação de violência ao
> Conselho Tutelar, relatório de bullying e registro de incidentes — foram
> entregues nas Issues #510 a #513. Resposta curta à pergunta *"o sistema está
> 100% em conformidade?"*: **ainda não** — seguem abertos deveres
> institucionais, dois deles vencidos (encarregado publicado e cláusulas-padrão
> de transferência internacional), além dos laudos e conferências da §7.

---

## Como ler a coluna Situação

| Símbolo | Significa |
|---|---|
| **Pronto** | implementado, com teste automatizado apontado na linha |
| **Parcial** | o mecanismo existe, mas falta cobertura ou uma ponta (tela, política, campo) |
| **Pendente** | não existe no código — está aqui para não ser esquecido |
| **Infra** | não é código deste repositório; é decisão de hospedagem/contrato |

---

## 1. Privacidade e proteção de dados (LGPD e ECA)

| Exigência | Situação | Onde |
|---|---|---|
| Consentimento do responsável, auditável | **Pronto** | [`utils/consentimentoLgpd.js`](../backend/src/utils/consentimentoLgpd.js), histórico em `Usuario.lgpdHistory` (termo, versão, data, IP, navegador) |
| Consentimento colhido no cadastro, **nunca presumido** | **Pronto** | as cinco rotas de formulário (`register-responsavel`, `-docente`, `-diretor`, `-secretaria` e `register-code`) recusam (400) sem o aceite no corpo e o gravam no `lgpdHistory` com `metodoValidacao: FORMULARIO_CADASTRO`. Exige-se só a ciência da política; as finalidades específicas continuam opcionais no perfil (Issue #280). O responsável chegou a ficar opcional (Issue #288), e a #295 decidiu exigir nas cinco ([`services/conformidade/consentimentoCadastro.js`](../backend/src/services/conformidade/consentimentoCadastro.js)). Até a Issue #236 a conta nascia com `consentimentoAceiteEm` carimbado sem ninguém marcar nada; a migração `1788652800000-invalidar-consentimento-carimbado-no-cadastro` tira o carimbo das contas antigas. Gestor que cria conta de outra pessoa não consegue gravar consentimento nem `lgpdConsents` por ela (Issue #295). Duas travas contra o carimbo voltar: `consentimentoCadastro.test.js` lê o código-fonte, e `models/Usuario.js` recusa em tempo de execução conta **nova** com `consentimentoAceiteEm` sem a assinatura de mesma data |
| Termo de áudio e imagem, assinável por qualquer perfil | **Pronto** | [`utils/termoAudioImagem.js`](../backend/src/utils/termoAudioImagem.js), [`docs/moderacao/TERMO-DE-USO-AUDIO-IMAGEM.md`](moderacao/TERMO-DE-USO-AUDIO-IMAGEM.md) |
| Termo de privacidade em linguagem simples | **Parcial** | [`html/politica-privacidade.html`](../html/politica-privacidade.html) e `portal-responsavel/src/components/PoliticaPrivacidade.tsx`. O texto publicado não identifica o controlador nem o encarregado, não cita os fornecedores nem o processamento fora do país e descreve a retenção de log de um jeito que não corresponde ao código; o rascunho corrigido, com as bases por categoria e as pendências institucionais marcadas, está em [`docs/lgpd/aviso-de-privacidade-RASCUNHO.md`](lgpd/aviso-de-privacidade-RASCUNHO.md) e **não** foi publicado (Issue #400) |
| Documentos de proteção de dados para validação | **Parcial** | rascunhos em [`docs/lgpd/`](lgpd/), todos marcados "RASCUNHO — PENDENTE DE VALIDAÇÃO JURÍDICA": aviso sobre uso de IA, política de uso de imagem e termo de consentimento separado, termo de uso, registro das operações de tratamento (art. 37) preenchido com as coleções do código, modelo de RIPD, plano de resposta a incidentes, proposta de tabela de temporalidade, procedimento de atendimento aos titulares e lista de fornecedores com a situação de cada contrato. Nenhum foi publicado: dependem de controlador, encarregado e validação jurídica (Issue #497) |
| Caixa de aceite **desmarcada** por padrão | **Pronto** | `portal-responsavel/src/components/CompletarCadastro.tsx`, `html/termo-audio-imagem.html`, os quatro `html/pages/cadastro-*.html` e o cadastro das páginas `html/login*.html` ([`js/consentimento-cadastro.js`](../js/consentimento-cadastro.js)) |
| Validação forte do aceite | **Pronto** | código de uso único por e-mail em `POST /api/conformidade/consentimento/codigo` + `/confirmar` ([`services/conformidade/validacaoConsentimento.js`](../backend/src/services/conformidade/validacaoConsentimento.js)); `metodoValidacao` gravado em `lgpdHistory` |
| Validação por SMS ou Gov.br | **Pendente** | os dois dependem de contrato/credenciamento do município — o campo `metodoValidacao` já existe para recebê-los; ver §7 |
| Privacidade por padrão (perfil de aluno nunca público) | **Pronto** | nenhuma rota pública devolve aluno; `FileController.servePublicImage` é **allowlist fechada por omissão** — sem sessão só sai imagem cujo `metadata.type` está liberado (hoje só `avatar`); documento, anexo de conversa e foto de aluno exigem `authJWT` (Issue #216) |
| Avaliações do sistema na página inicial | **Pronto** | a página inicial é pública e mostra só avaliação que a pessoa **escolheu** publicar (caixa desmarcada por padrão no perfil e no painel) e que a administração aprovou em `html/admin/moderacao-avaliacoes.html`; quem avaliou aparece por iniciais e papel, sem foto e sem id da conta ([`utils/avaliacaoPublica.js`](../backend/src/utils/avaliacaoPublica.js)). Editar o texto devolve a avaliação para revisão, e a decisão vai ao `AuditLog`. A listagem do painel e o evento em tempo real enviado à rede saem na mesma forma. Avaliação anterior, sem adesão registrada, fica fora da página até a pessoa optar — [`avaliacoesPublicas.regressao.test.js`](../backend/src/tests/avaliacoesPublicas.regressao.test.js) (Issue #489) |
| Foto de aluno só para quem tem vínculo | **Pronto** | a foto carrega `metadata.alunoId`/`escolaId`, e o download passa por [`middleware/assertAcessoAoAluno.js`](../backend/src/middleware/assertAcessoAoAluno.js): professor só da própria turma, responsável só do próprio filho, gestão só da escola ativa. Antes da Issue #228 a foto era gravada sem `metadata` e a autorização caía na regra de legado, que liberava qualquer `image/*` a qualquer autenticado da rede |
| Segregação de acesso por perfil e por turma | **Pronto** | recorte por **turma** ([`middleware/horizontalFilter.js`](../backend/src/middleware/horizontalFilter.js), `conformidadeRotas.test.js`) e por **campo**: [`utils/projecaoAluno.js`](../backend/src/utils/projecaoAluno.js) é a lista fechada do que cada perfil recebe do cadastro do aluno, aplicada em listagem, leitura, respostas de escrita e no `populate` da chamada; o professor recebe identificação, dados pedagógicos, alergias e o indicador `necessitaApoio` — detalhe de deficiência e lista de retirada só se a escola ligar `PROFESSOR_VE_DETALHE_DEFICIENCIA=sim` / `PROFESSOR_VE_RETIRADA=nome`; o código de vínculo é `select: false` no schema — [`projecaoAluno.regressao.test.js`](../backend/src/tests/projecaoAluno.regressao.test.js) (Issue #388) |
| Separação das portas de login (escola x família) | **Pronto** | no login com **senha**, [`utils/portalDeLogin.js`](../backend/src/utils/portalDeLogin.js) decide a porta pelo perfil gravado no banco, nunca pelo que o cliente declara: conta de responsável na tela da escola e conta de equipe no portal da família recebem 403 (`CONTA_DE_RESPONSAVEL` / `CONTA_DA_ESCOLA`) sem cookie de sessão, e o campo `portal` ausente é lido como escola — a recusa vem **depois** da prova de senha, então não serve para enumerar contas ([`loginPorPortal.test.js`](../backend/src/tests/loginPorPortal.test.js)). A porta não é a única trava: as páginas da escola continuam fechadas para a família em `utils/matrizAcesso.js`, e os dados, no `authorize` de cada rota. O login com Google é só da família e só por **ID token**: o servidor confere assinatura, emissor, validade e `audience` igual ao client ID do portal, exige `email_verified` e recusa access token; conta de equipe recebe 403 antes de qualquer escrita (`LOGIN_GOOGLE_RECUSADO` no `AuditLog`). `npm run sessoes:encerrar-equipe` (simulação por padrão) encerra sessões de equipe abertas antes da correção — testes em [`loginGoogle.regressao.test.js`](../backend/src/tests/loginGoogle.regressao.test.js) e [`contencaoAcesso.regressao.test.js`](../backend/src/tests/contencaoAcesso.regressao.test.js) (Issues #378 e #387). Até a Issue #466 este mapa dava a recusa no login com senha como não implementada |
| Cadastro de direção e secretaria por convite de uso único | **Pronto** | o código da escola vale só para o cadastro docente; direção e secretaria nascem de convite criado pelo admin (`/api/admin/convites-equipe`) — token de 256 bits guardado só como hash, prazo curto, amarrado a e-mail, escola e perfil, consumido de forma atômica; o aceite cria a conta com o vínculo da escola e **sem sessão** (a entrada é pelo login com 2FA); criação, uso, recusa e revogação vão para o `AuditLog` — [`conviteEquipe.regressao.test.js`](../backend/src/tests/conviteEquipe.regressao.test.js) (Issues #378 e #386) |
| E-mail do responsável confirmado antes de liberar dado de aluno | **Pronto** | o vínculo é decidido pelo e-mail da ficha, então a posse da caixa postal precisa ser provada: conta de responsável criada a partir do marco (`VERIFICACAO_EMAIL_A_PARTIR_DE`) recebe 403 `EMAIL_NAO_VERIFICADO` em `assertAcessoAoAluno` e em todo o portal até confirmar o link; quem entra pelo Google já chega confirmado, porque o ID token exige `email_verified`. Conta anterior ao marco segue valendo — derrubar o acesso de famílias que já usam trocaria um risco por um dano certo. O reenvio fica em `POST /api/auth/reenviar-verificacao` e o portal mostra a tela `ConfirmeSeuEmail` — [`emailVerificadoResponsavel.regressao.test.js`](../backend/src/tests/emailVerificadoResponsavel.regressao.test.js) (Issue #412) |
| Troca do e-mail da conta pela própria pessoa | **Pronto (API e página de confirmação)** | `POST /api/auth/email/solicitar-troca` pede o endereço novo e a **senha atual** e manda um link só para o endereço novo, com token guardado apenas como hash e válido por 2 horas; endereço já em uso recebe a mesma resposta, sem link. `POST /api/auth/email/confirmar-troca` só aceita o link **na mesma conta, logada** (abrir o link não confirma), derruba as outras sessões (`tokenVersion`) e leva para o endereço novo tudo que apontava para o antigo: `responsavel`, `responsavelDados.email` e `responsaveis[].email` das fichas, o **bloqueio judicial** (`restricoesAcesso[].email`, para que trocar de e-mail não sirva para fugir dele), `Autorizacao.responsavelEmail`, as fichas de equipe e os pedidos de vínculo pendentes. O endereço antigo recebe aviso; pedido, recusa e troca vão para o `AuditLog`. Conta do Google não troca: o login dela acha a conta pelo e-mail. Regra em [`services/trocaEmail.js`](../backend/src/services/trocaEmail.js), testes em [`trocaEmail.test.js`](../backend/src/tests/trocaEmail.test.js) (Issue #609). As telas de pedido no portal e no perfil da equipe são as Issues #610 e #611 |
| Vínculo familiar decidido pela escola | **Pronto** | o professor não escreve responsáveis, guarda nem pessoas autorizadas (403 + `ALUNO_VINCULO_RECUSADO`); o responsável **pede** a inclusão de outro e-mail e a secretaria aprova ou recusa (`/api/secretaria/vinculos`, tela em `html/secretaria/vinculos.html`) — e-mail pendente não dá acesso nenhum; aprovação, recusa e mudanças de guarda e retirada ficam no `AuditLog` com e-mail mascarado, e os demais responsáveis são avisados da inclusão aprovada — [`escritaProfessorAluno.regressao.test.js`](../backend/src/tests/escritaProfessorAluno.regressao.test.js) e [`vinculoResponsavel.regressao.test.js`](../backend/src/tests/vinculoResponsavel.regressao.test.js) (Issues #389 e #398) |
| Bloqueio de responsável por decisão judicial | **Pronto** | a secretaria ou a direção da escola do aluno marca o e-mail de quem teve o acesso restringido pela Justiça (tela em `html/secretaria/vinculos.html`); o bloqueio vence o e-mail na ficha em todo ponto que reconhece o responsável — guarda por aluno, lista de filhos do portal, comunicados, salas em tempo real, turmas, vínculo com a rede, assistente e exportação ([`utils/restricaoAcesso.js`](../backend/src/utils/restricaoAcesso.js)). Marcar exige confirmar que a decisão está arquivada, não aceita texto livre, encerra as sessões da conta e vai ao `AuditLog` com e-mail mascarado; o marcador não sai para professor nem para outros responsáveis — [`restricaoJudicial.regressao.test.js`](../backend/src/tests/restricaoJudicial.regressao.test.js) (Issue #491). Comunicados, assistente e salas usam o mesmo utilitário, sem teste dedicado |
| Isolamento entre escolas da rede | **Pronto** | [`middleware/filtrarPorEscola.js`](../backend/src/middleware/filtrarPorEscola.js) falha fechada para perfil de equipe (403 `ESCOLA_NAO_RESOLVIDA`), e toda rota que recebe id de aluno, nota, falta ou documento decide por [`assertAcessoAoAluno`](../backend/src/middleware/assertAcessoAoAluno.js) — inclusive documentos do responsável, status da ficha, `GET /api/notas/:id` e a chamada, cuja escola vem do contexto e cuja lista de presença recusa aluno de fora da turma — [`escolaResolvida.regressao.test.js`](../backend/src/tests/escolaResolvida.regressao.test.js) e [`guardaAluno.regressao.test.js`](../backend/src/tests/guardaAluno.regressao.test.js) (Issues #396 e #397) |
| Coleta mínima: campo sem finalidade sai do cadastro | **Pronto** | `religiao` e `responsaveis[].responsabilidadeFinanceira` foram removidos do schema, dos formulários, das listas de campos aceitos e da projeção — religião é dado sensível (art. 11) sem uso no sistema, e responsabilidade financeira não existe em rede municipal. Cadastro antigo é limpo por `npm run campos:limpar-sem-finalidade` (simulação por padrão, `--aplicar` para remover, registro em `AuditLog`); `responsavelDados` é `Mixed` e tem o descarte em [`utils/camposSemFinalidade.js`](../backend/src/utils/camposSemFinalidade.js). Cor/raça continua, porque o Censo Escolar exige — [`camposSemFinalidade.regressao.test.js`](../backend/src/tests/camposSemFinalidade.regressao.test.js) (Issue #408) |
| Direitos do titular (LGPD, art. 18) | **Pronto** | [`controllers/MeusDadosController.js`](../backend/src/controllers/MeusDadosController.js): `GET /api/meus-dados` entrega ao próprio titular, sem intermediário, o que o sistema guarda dele — cadastro, consentimento, histórico de ações, conversas do chat e do assistente — e, para o responsável, os dados escolares do filho (acesso e portabilidade, incisos I, II e V); `POST /api/meus-dados/solicitar-exclusao` abre pedido com protocolo em [`models/PedidoTitular.js`](../backend/src/models/PedidoTitular.js), prazo de **15 dias** corridos como compromisso da escola — o art. 19 trata do direito de acesso, e para exclusão a LGPD não fixa esse número; [VALIDAR COM JURÍDICO] o prazo de cada tipo — e histórico de despacho; o pedido guarda o id da escola (da conta, ou do filho para o responsável), o protocolo tem sufixo aleatório e o motivo digitado fica só no pedido, fora do `AuditLog`, que é só de inclusão (Issue #484); o titular acompanha em `GET /api/meus-dados/pedidos` (tela em `html/meus-dados.html`) e o admin despacha em `/api/admin/pedidos-titular` (`html/admin/pedidos-lgpd.html`). Revogar consentimento é desmarcar a finalidade no perfil: a escolha sai e o histórico de aceites fica ([`utils/consentimentoDoPerfil.js`](../backend/src/utils/consentimentoDoPerfil.js), art. 8º, §5º) — [`pedidosTitular.regressao.test.js`](../backend/src/tests/pedidosTitular.regressao.test.js) (Issue #413) e [`registroPedidoTitular.regressao.test.js`](../backend/src/tests/registroPedidoTitular.regressao.test.js) (Issue #484). Retificação e informação existem como tipo de pedido, mas ainda não têm botão próprio na tela |
| Anonimização / direito ao esquecimento | **Pronto** | usuário inativo há 12 meses em [`utils/anonimizacaoAutomatica.js`](../backend/src/utils/anonimizacaoAutomatica.js) — a rotina **não** alcança responsável de aluno com vínculo ativo (a escola ainda tem dever de contato) e **desativa** conta de equipe em vez de anonimizar (a autoria de nota e chamada é parte do registro escolar), tudo configurável por `ANONIMIZACAO_INATIVIDADE_DIAS` e `ANONIMIZACAO_EQUIPE`; **aluno que saiu da rede** em [`services/conformidade/anonimizacaoAluno.js`](../backend/src/services/conformidade/anonimizacaoAluno.js) — apaga identificador e dado de saúde, preserva notas, faltas, turma e situação |
| Encerrar cadastro de aluno sem apagar registro escolar | **Pronto** | `DELETE /api/alunos/:id` não remove mais o documento: inativa (padrão) ou, com `?modo=anonimizar`, chama o serviço de anonimização, que só aceita aluno já fora da rede (409 `ANONIMIZACAO_NAO_PERMITIDA` enquanto matriculado); as duas saídas ficam no `AuditLog` por id. O registro da anonimização automática nunca chegava a ser gravado — o `req` fictício do cron não tinha `headers` e o erro morria dentro do helper — [`encerramentoCadastro.regressao.test.js`](../backend/src/tests/encerramentoCadastro.regressao.test.js) (Issue #409) |
| Canal de denúncia visível (ECA Digital) | **Pronto** | `POST /api/moderacao/denunciar` aceita denúncia sem mensagem vinculada; botão no cabeçalho do perfil, do dashboard e do portal do responsável ([`js/canal-denuncia.js`](../js/canal-denuncia.js), `portal-responsavel/src/components/CanalDenuncia.tsx`) |
| Retenção de log com prazo | **Pronto** | TTL de 365 dias em `AuditLog` — acima do mínimo de 6 meses do Marco Civil |
| Documento de matrícula não sai do servidor para IA | **Pronto** | `POST /api/secretaria/alunos/importar/estruturar` responde 410 e não chama provedor externo; PDF da SEDUC e planilha são lidos localmente em `services/importacaoAlunos` (Issue #378, mesmo teste) |
| Dado de aluno pseudonimizado antes da IA | **Pronto** | camada única em [`services/ia/pseudonimizar.js`](../backend/src/services/ia/pseudonimizar.js): nome vira rótulo ("Aluno A"), identificadores e data de nascimento não saem, e motivo de falta, saúde, deficiência, transtornos e observação em texto livre nunca saem; o texto digitado pela pessoa passa pelo mesmo filtro ([`escopoAlunos.js`](../backend/src/services/ia/escopoAlunos.js)) e a resposta é traduzida de volta no servidor; a IA é ligada **por escola** ([`interruptor.js`](../backend/src/services/ia/interruptor.js), padrão desligado para a equipe; a direção usa sem pedir enquanto a escola não gravar decisão, e o desligamento gravado vale para todos — Issue #725) e a narração recusa texto que cite aluno — [`iaPseudonimizada.regressao.test.js`](../backend/src/tests/iaPseudonimizada.regressao.test.js) (Issue #401). O insight global da direção, que fala com o provedor por `voiceService` e não pela camada acima, mandava o nome dos alunos com frequência crítica quando a escola tinha a IA ligada; agora manda rótulos e reidentifica a resposta no servidor. As rotas pedagógicas já respeitavam o interruptor por escola (`exigirIaLigada`), e os controllers passaram a conferir de novo, como segunda barreira — [`iaPedagogico.regressao.test.js`](../backend/src/tests/iaPedagogico.regressao.test.js) (Issue #493) |
| Indicador automático como apoio, sem decisão automática | **Pronto** | "alunos em risco", tendência e previsão de nota são estimativas: as respostas que os trazem incluem um aviso único ([`utils/avisoIndicador.js`](../backend/src/utils/avisoIndicador.js)) de que servem de apoio e não geram decisão sobre o aluno, e o BI pedagógico e o painel da direção o exibem junto do indicador. Nenhum desses cálculos grava situação no cadastro; o teste garante que continue assim (LGPD, art. 20: revisão humana) [VALIDAR COM JURÍDICO] o enquadramento — [`avisoIndicadores.regressao.test.js`](../backend/src/tests/avisoIndicadores.regressao.test.js) (Issue #494) |
| Encarregado identificado em local de destaque (Res. CD/ANPD nº 18/2024) | **Pendente** | o e-mail de exemplo `dpo@escola.edu.br`, que ninguém atendia, saiu das três telas (`html/politica-privacidade.html`, `html/cadastro-aluno.html` e `PoliticaPrivacidade.tsx` do portal) na Issue #530; no lugar, elas dizem que o encarregado está sendo designado e apontam um canal que funciona hoje — a página Meus Dados para a equipe e a secretaria da escola para as famílias. **Continua pendente**: a resolução exige **nome** e **meio de contato** do encarregado, e a ANPD fiscaliza isso desde dez/2024. Depende de nomeação (ver [`lgpd/pendencias-institucionais.md`](lgpd/pendencias-institucionais.md)) — ver §7, item 7 |
| Transferência internacional com cláusulas-padrão (LGPD, art. 33; Res. CD/ANPD nº 19/2024) | **Pendente** | a aplicação roda no Render em `oregon` (EUA), e Gemini, ElevenLabs e login Google também estão fora do país ([`lgpd/fornecedores-e-subprocessadores-RASCUNHO.md`](lgpd/fornecedores-e-subprocessadores-RASCUNHO.md)). O prazo para incorporar as cláusulas-padrão da ANPD aos contratos **venceu em 23/08/2025** — ver §7, item 8 |
| Cookies informados na política (Guia ANPD de cookies, 2022) | **Parcial** | o sistema usa só cookies necessários (`escola_jwt`, `csrf_token`, `destino_pos_login`) e nenhum rastreador de terceiros, então **não precisa de banner** de consentimento; mas a política publicada não menciona cookies. O rascunho do aviso já cita — sai junto com a publicação da Issue #400 |
| ECA Digital (Lei 15.211/2025, Decreto 12.880/2026) — análise de aplicabilidade | **Parcial** | não existe perfil de aluno (`Usuario.role` só admite adulto), então o produto não é "direcionado" a criança nem tem "acesso provável" por ela na maior parte das telas — o que afasta aferição de idade e supervisão parental. O que a lei pede de todos já existe: privacidade por padrão (§1), canal de denúncia visível, nenhum perfilamento para publicidade. Falta **registrar** essa análise por escrito antes das sanções da ANPD (previstas a partir de nov/2026) e refazê-la se um dia houver login de aluno — ver §7, item 9 |
| Soberania de dados (dados no Brasil) | **Infra** | cluster MongoDB Atlas em região brasileira e Render em região compatível; ver §7 |

### A matriz de acesso, na forma em que o setor público a cobra

| Perfil | Vê dados do aluno | Edita notas/chamada | Prontuário de saúde | Exporta dado governamental |
|---|---|---|---|---|
| Admin/TI | sim | não | não | sim |
| Secretaria/Direção | todos da escola | sim | sim | sim |
| Professor | **só as turmas dele**, só os campos da função | só as turmas dele | alertas básicos (alergias) e o indicador de apoio | não |
| Responsável/Aluno | só os próprios | não | só os próprios | não |

A coluna "Professor" é a que o código protege de forma mais visível: veja o
teste `conformidadeRotas.test.js`, caso *"professor enxerga apenas os alunos das
turmas que leciona"*, e a recusa 403 ao pedir aluno de outra turma.

O recorte por campo é garantido por `utils/projecaoAluno.js` (Issue #388): a
suíte `projecaoAluno.regressao.test.js` varre as respostas dadas ao professor e
reprova se encontrar CPF, endereço, cor/raça, plano de saúde, responsáveis,
guarda, documentos ou o código de vínculo.

---

## 2. Segurança da informação e auditoria (Marco Civil, art. 15)

| Exigência | Situação | Onde |
|---|---|---|
| Documento assinado com versões e trilha | **Pronto** | cada arquivo guarda hash SHA-256, autor e data; substituir cria versão nova e **preserva** a anterior, acessível em `/api/documentos-responsaveis/:id/versoes`; só quem enviou substitui (a escola muda status e registra parecer separado); envio, visualização, download, substituição e status vão ao `AuditLog`; a ficha só aceita arquivo enviado pelo próprio usuário; autorizações guardam histórico de respostas; aviso de finalidade nas telas de envio — [`documentoVersoes.regressao.test.js`](../backend/src/tests/documentoVersoes.regressao.test.js) (Issue #399) |
| Professor vê a situação das autorizações, se a direção decidir | **Pronto** | desligado por padrão; desde a Issue #727 a direção decide **por professor** (ferramenta `gestao.autorizacoes-pais`, ver [`AUTORIZACAO-FERRAMENTAS.md`](AUTORIZACAO-FERRAMENTAS.md)), e o atalho em `detalhes/autorizacoes-pais.html` (`PATCH /api/escolas/:id/autorizacoes-professor`) grava a mesma decisão para todos os professores atuais, com antes e depois no `AuditLog` por professor. A migração `1791471600000-autorizacoes-pais-por-professor` manteve o acesso de quem já via. Autorizado, o professor vê em `detalhes/autorizacoes-turma.html` só tipo, título e situação de cada autorização dos alunos das próprias turmas — nunca arquivo, dose de medicamento, contato de motorista ou data ([`controllers/AutorizacoesTurmaController.js`](../backend/src/controllers/AutorizacoesTurmaController.js)) — [`autorizacoesProfessor.regressao.test.js`](../backend/src/tests/autorizacoesProfessor.regressao.test.js) (Issue #496) |
| Log de quem acessou, quando e o que alterou | **Pronto** | [`models/AuditLog.js`](../backend/src/models/AuditLog.js) — guarda perfil, ação, recurso, `valorAnterior`/`valorNovo`, IP, user-agent |
| Log em toda exportação de dado de aluno | **Pronto** | `ConformidadeController` grava `EXPORTAR_FICHA_CONSELHO_TUTELAR`, `EXPORTAR_EDUCACENSO` e `EXPORTAR_DADOS_ABERTOS` |
| Guarda mínima de 6 meses | **Pronto** | TTL de 365 dias (§1) |
| Coleção de log imutável (append-only) | **Pronto (aplicação)** | hooks em [`models/AuditLog.js`](../backend/src/models/AuditLog.js) recusam update, delete, replace e `save()` de documento existente |
| Imutabilidade no banco | **Infra** | usuário de aplicação com `insert`/`find` e **sem** `update`/`remove` em `audit_logs`; ver §7 |
| Senha definida só pelo titular | **Pronto** | `senha` saiu da lista de campos que um gestor altera em conta alheia — inclusive para o admin: `PUT /api/usuarios/:id` com senha de outra pessoa responde 403 `SENHA_SO_DO_TITULAR` e registra `SENHA_DE_TERCEIRO_RECUSADA`. A gestão dispara `POST /api/usuarios/:id/redefinir-senha`, que manda o código para o e-mail do titular pelo fluxo de recuperação e registra `SENHA_REDEFINICAO_SOLICITADA`; a tela da direção (`html/direcao/gerenciar-secretaria`) não pede mais senha nova. Sem isso, quem definia a senha entrava como a pessoa e o `AuditLog` atribuía a ela tudo o que fosse feito — [`senhaDoTitular.regressao.test.js`](../backend/src/tests/senhaDoTitular.regressao.test.js) (Issue #411) |
| Tempo real com as mesmas regras de sessão | **Pronto** | o handshake do Socket.IO ([`realtime/autenticarSocket.js`](../backend/src/realtime/autenticarSocket.js)) confere o que o `authJWT` confere nas rotas HTTP: conta ativa, `tokenVersion`, `jti` encerrado no logout (consulta que falha fechado) e propósito de sessão — o token intermediário do 2FA não abre conexão. Antes, uma sessão encerrada no logout seguia recebendo eventos enquanto a versão da conta fosse a mesma — [`handshakeSocket.regressao.test.js`](../backend/src/tests/handshakeSocket.regressao.test.js) (Issue #488) |
| 2FA para perfis administrativos | **Parcial** | [`utils/politica2FA.js`](../backend/src/utils/politica2FA.js), [`docs/2FA-OBRIGATORIO.md`](2FA-OBRIGATORIO.md). Sem configuração, o segundo fator é exigido de `diretor` e `secretaria`; o **admin** — que vê todos os alunos e exporta dado governamental — só passa por ele se a conta tiver `twoFactorEnabled` ou se `PERFIS_2FA_OBRIGATORIO` incluir `admin`. O padrão não inclui o admin de propósito: ligar a exigência com o e-mail fora e sem códigos de backup tranca a conta administrativa, e por isso a ativação segue o roteiro por conta do documento. Enquanto houver admin entrando só com senha, isto não está pronto — ver §7 |
| Senha com hash forte | **Pronto** | bcrypt em toda senha gravada e login só com hash bcrypt ([`controllers/UserController.js`](../backend/src/controllers/UserController.js)); códigos de backup em scrypt ([`utils/codigosBackup.js`](../backend/src/utils/codigosBackup.js)) |
| HTTPS ponta a ponta | **Infra** | terminação TLS no Render; `helmet` com HSTS no `app.js` |
| Registro de todo incidente de segurança por 5 anos (Res. CD/ANPD nº 15/2024) | **Pronto** | coleção `incidentes_seguranca` ([`models/IncidenteSeguranca.js`](../backend/src/models/IncidenteSeguranca.js)) **sem TTL** e sem exclusão pelo mongoose, com os campos do art. 10 e histórico de cada passo; rotas só do admin em `/api/admin/incidentes`. O prazo de **3 dias úteis** é calculado em [`services/conformidade/prazoIncidente.js`](../backend/src/services/conformidade/prazoIncidente.js) no fuso de Brasília, pulando fim de semana e feriado nacional fixo; encerrar exige a comunicação à ANPD e aos titulares (risco relevante) ou a justificativa de não comunicar. `AuditLog` só com o protocolo — [`registroIncidentes.regressao.test.js`](../backend/src/tests/registroIncidentes.regressao.test.js) (Issue #513). Sem tela: por enquanto é API. O plano de resposta segue em rascunho em [`lgpd/plano-resposta-incidentes-RASCUNHO.md`](lgpd/plano-resposta-incidentes-RASCUNHO.md) |
| Nunca logar PII | **Pronto** | [`utils/logSanitizer.js`](../backend/src/utils/logSanitizer.js) mascara por **nome de chave** (`{ nome: 'Maria Silva' }` vira `M. S.`) e varre segredo em texto livre — mas nome dentro de mensagem ele não tem como mascarar. Por isso nenhuma chamada de log interpola nome de pessoa: descrição de auditoria e mensagem de logger citam **id**, e `UPDATE_STUDENT` guarda a lista de campos alterados em vez da ficha inteira dos dois lados. Uma varredura do código-fonte reprova quem voltar a interpolar — [`logSemNome.regressao.test.js`](../backend/src/tests/logSemNome.regressao.test.js) (Issue #410) |
| Imagem e áudio de terceiros protegidos por direito autoral (Lei 9.610/98) | **Parcial** | [`services/direitosAutorais/`](../backend/src/services/direitosAutorais/): o upload de foto, documento, anexo do chat e mensagem de voz responde **451** quando o arquivo bate com o catálogo de obras da escola (SHA-256, hash do áudio sem ID3 e hash perceptual de imagem) ou traz aviso de copyright embutido (EXIF, XMP, IPTC, ID3, Vorbis, RIFF, MP4); a direção bloqueia um arquivo já armazenado pelo id (`POST /api/direitos-autorais/arquivos/:id/bloquear`) e todo download dele passa a responder 451. Tudo vai ao `AuditLog`. Falta tela para a direção e impressão acústica — ver [`docs/DIREITOS-AUTORAIS.md`](DIREITOS-AUTORAIS.md) e [`direitosAutorais.test.js`](../backend/src/tests/direitosAutorais.test.js) (Issue #509) |

---

## 3. Acessibilidade digital (LBI, WCAG/eMAG)

| Exigência | Situação | Onde |
|---|---|---|
| `prefers-reduced-motion` respeitado | **Pronto** | [`docs/MOTION.md`](MOTION.md) e o padrão da opção de movimento em [`js/acessibilidade.js`](../js/acessibilidade.js) |
| Pular para o conteúdo (WCAG 2.4.1) | **Pronto** | injetado em todas as páginas, com `tabindex="-1"` no alvo |
| Foco sempre visível (WCAG 2.4.7) | **Pronto** | `:focus-visible` em [`css/acessibilidade.css`](../css/acessibilidade.css) |
| Alto contraste | **Pronto** | escopo `[data-contraste="alto"]`, que desliga o glassmorphism |
| Redimensionamento de texto (WCAG 1.4.4) | **Pronto** | escala 100/115/130% guardada por navegador |
| Alvo de toque mínimo (WCAG 2.5.5) | **Pronto** | 44–48px nos controles do painel e do canal de denúncia |
| Varredura automática WCAG 2.2 A/AA (axe-core) | **Pronto** | varredura de 76 páginas, cada uma aberta com o perfil que tem acesso a ela: de 48 páginas com falha para **nenhuma** — rótulos ligados aos campos, nome acessível em botões só de ícone, regiões com rolagem alcançáveis pelo teclado, links sublinhados e contraste de pelo menos 4,5:1 (Issue #536). As páginas públicas ficam travadas no CI por [`e2e/acessibilidade.a11y.spec.ts`](../e2e/acessibilidade.a11y.spec.ts). A varredura automática pega só parte dos problemas; não substitui o item abaixo |
| Auditoria com leitor de tela real + laudo eMAG | **Pendente** | ver §7 |
| Referência técnica atualizada: **ABNT NBR 17225:2025** (WCAG 2.2) | **Pendente** | publicada em 11/03/2025, é hoje a norma brasileira que dá conteúdo ao art. 63 da LBI e a que os editais passaram a citar. A auditoria do item acima deve ser feita contra ela, não só contra o eMAG 3.1 (que é de WCAG 2.0) — ver §7, item 2 |

Os recursos estão em **todas** as páginas — a injeção é um codemod idempotente
(`scripts/inject-acessibilidade.js`), porque acessibilidade que existe em
algumas telas não cumpre a lei: ninguém escolhe por qual página entra no
sistema.

O que ainda falta é o **laudo**: o edital costuma exigir declaração de
conformidade eMAG, e ela não se produz por afirmação de quem escreveu o código.
A semântica de cada página (ordem de cabeçalhos, rótulo de formulário, texto
alternativo) continua sendo responsabilidade dela, e é isso que a auditoria com
leitor de tela real vai apontar.

---

## 4. Conformidade pedagógica (LDB e INEP)

| Exigência | Situação | Onde |
|---|---|---|
| Frequência mínima de 75% (LDB, art. 24, VI) | **Pronto** | [`services/conformidade/frequenciaLdb.js`](../backend/src/services/conformidade/frequenciaLdb.js) |
| Alerta automático de infrequência | **Pronto** | `GET /api/conformidade/frequencia/alertas` |
| Comunicação obrigatória ao Conselho Tutelar (LDB, art. 12, VIII) | **Pronto** | gatilho em 30% do limite legal — 15 faltas em 200 dias letivos |
| Ficha de encaminhamento pronta para assinar | **Pronto** | `GET /api/conformidade/frequencia/:alunoId/ficha-conselho` → PDF ([`services/conformidade/fichaConselhoTutelar.js`](../backend/src/services/conformidade/fichaConselhoTutelar.js)) |
| Exportação para o Censo Escolar (JSON auditável) | **Pronto** | [`services/conformidade/educacenso.js`](../backend/src/services/conformidade/educacenso.js) — códigos oficiais e lista de pendências por aluno |
| Arquivo de migração delimitado | **Parcial** | [`services/conformidade/leiauteEducacenso.js`](../backend/src/services/conformidade/leiauteEducacenso.js) gera o `.txt` e **recusa** lote com pendência; a ordem dos campos precisa ser conferida contra o caderno da edição — ver abaixo |
| Nome social no registro escolar (Decreto 8.727/2016; Resolução CNE/CP nº 1/2018; em SP, Decreto 55.588/2010) | **Pronto** | `Aluno.nomeSocial`, gravado só por `PUT`/`DELETE /api/secretaria/alunos/:id/nome-social` ([`controllers/NomeSocialController.js`](../backend/src/controllers/NomeSocialController.js)), que exige o requerimento arquivado: do aluno maior de 18 anos ou dos responsáveis. O professor recebe o nome social **em `nome`**, sem o sobrenome civil (`utils/projecaoAluno.js`); a ficha da gestão e do responsável traz os dois; o nome civil continua no Educacenso e na ficha do Conselho. A anonimização apaga, e a IA trata como nome. Tela em `html/secretaria/vinculos.html` — [`nomeSocial.regressao.test.js`](../backend/src/tests/nomeSocial.regressao.test.js) (Issue #510). Telas que desenham nome de aluno por outro caminho que não a projeção seguem mostrando o civil |
| Comunicação ao Conselho Tutelar de suspeita de violência (ECA, arts. 13, 56-I e 245; Lei 14.344/2022; Lei 13.819/2019, art. 6º; LDB, art. 12, VIII, na redação da **Lei 15.231/2025**) | **Pronto** | denúncia de `violencia`, `assedio` ou `automutilacao` nasce com `conselhoTutelar.situacao: 'pendente'` (`models/ModeracaoOcorrencia.js`); a gestão registra data, meio e protocolo em `POST /api/moderacao/ocorrencia/:id/conselho-tutelar`, e só a direção dispensa, com justificativa ([`controllers/ConselhoTutelarController.js`](../backend/src/controllers/ConselhoTutelarController.js)). A fila `GET /api/moderacao/conselho-tutelar/pendentes` não traz relato nem autor; automutilação sai marcada como **sigilosa**. Bloco no painel da direção (`html/direcao/moderacao.html`) — [`conselhoTutelarViolencia.regressao.test.js`](../backend/src/tests/conselhoTutelarViolencia.regressao.test.js) (Issue #511). A ficha em PDF, como a de infrequência, ainda não existe |
| Relatório bimestral de intimidação sistemática (Lei 13.185/2015, art. 6º) | **Pronto** | `GET /api/conformidade/bullying/relatorio?ano=&bimestre=` ([`services/conformidade/relatorioBullying.js`](../backend/src/services/conformidade/relatorioBullying.js)): denúncias de `bullying` e `ciberbullying` da escola no bimestre civil, por categoria e situação da apuração, com a supressão k = 5 da §5 e total abaixo de 5 não publicado como número — [`relatorioBullying.regressao.test.js`](../backend/src/tests/relatorioBullying.regressao.test.js) (Issue #512). Sem tela de publicação: por enquanto é API |
| Nunca bloquear boletim por pendência financeira | **Pronto por ausência** | o sistema não tem módulo financeiro; nenhuma rota de boletim/frequência consulta débito |

### As contas, explícitas

Para um ano letivo de **200 dias** (mínimo da LDB, art. 24, I):

```
limite de faltas   = 200 × 25%  = 50 dias   → risco crítico de reprovação
gatilho do Conselho = 50 × 30%  = 15 dias   → comunicação obrigatória
```

Dois detalhes que os testes fixam e que costumam ser implementados errado:

1. **Falta é DIA, não registro de chamada.** A escola que lança presença por
   matéria gera cinco documentos por dia. Contar documentos dispararia a
   comunicação ao Conselho com três dias de ausência.
2. **Falta justificada continua contando** para a frequência mínima. O atestado
   explica, não abona — as exceções legais (Decreto-Lei 1.044/1969, Lei
   6.202/1975) são regime domiciliar deferido pela direção, não um campo da
   chamada. A ficha marca os dias justificados com `(J)` para a secretaria
   avaliar o contexto antes de acionar o Conselho.

### O que está pronto no Educacenso, e o que exige conferência anual

Pronto e estável: a **tradução para os códigos oficiais** e a **lista de
pendências por aluno** (`cor/raça`, `sexo`, `data de nascimento`,
`nacionalidade`, e o **tipo** da deficiência, sem o qual não há repasse
adicional do Fundeb). É a parte que consome o tempo da secretaria — descobrir em
novembro que 40 alunos estão sem data de nascimento.

Pronto e **dependente de conferência**: o arquivo delimitado por `|`. O leiaute
do Educacenso muda a cada edição, então a ordem dos campos vive em
`REGISTROS`, como **dado** — atualizar para o ano é editar essa estrutura, não a
função que escreve o arquivo. O `cabecalho.versaoLeiaute` acompanha o arquivo
justamente para ninguém entregar um `.txt` montado com a referência do ano
passado sem perceber.

Duas proteções que valem citar em auditoria:

- o gerador **se recusa** a escrever com pendência (`409`, listando o que
  falta). Arquivo com aluno incompleto é declaração errada, e este é o último
  momento em que dá tempo de corrigir o cadastro;
- todo valor é sanitizado contra o separador. Um `|` digitado no campo "tipo de
  deficiência" deslocaria todas as colunas seguintes daquela linha, e o INEP
  leria "turma" no lugar de "nome".

---

## 5. Transparência sem vazamento (LAI)

| Exigência | Situação | Onde |
|---|---|---|
| Painel de dados abertos anonimizado | **Pronto** | `GET /api/conformidade/dados-abertos` ([`services/conformidade/dadosAbertos.js`](../backend/src/services/conformidade/dadosAbertos.js)) |
| Proteção contra reidentificação | **Pronto** | supressão complementar com limiar (**k = 5**) |

O ponto delicado não é esconder o nome — é a **célula pequena**. Publicar
"aprovação por turma" numa turma de 8 alunos com 1 reprovado entrega a criança
para a comunidade inteira. E esconder *uma* célula com o total publicado não
resolve: o valor volta por subtração. Por isso a supressão é iterativa — o balde
"Outros" absorve a menor célula pública até deixar de identificar alguém
(teste: *"não dá para deduzir a célula suprimida por subtração do total"*).

---

## 6. Rotas de conformidade

Todas sob `/api/conformidade`, com `authJWT` + `horizontalFilter` +
`filtrarPorEscola` ([`routes/conformidade.js`](../backend/src/routes/conformidade.js)).

| Rota | Perfis | O que devolve |
|---|---|---|
| `GET /frequencia/alertas` | professor (suas turmas), secretaria, diretor, admin | alunos que já exigem providência legal, mais graves primeiro |
| `GET /frequencia/:alunoId` | idem | apuração individual com a lista de dias faltados |
| `GET /frequencia/:alunoId/ficha-conselho` | secretaria, diretor, admin | PDF da ficha de comunicação ao Conselho Tutelar |
| `GET /educacenso` | secretaria, diretor, admin | lote do Censo com pendências (`?formato=arquivo` para baixar) |
| `GET /dados-abertos` | secretaria, diretor, admin | indicadores agregados e anonimizados |
| `GET /soberania` | secretaria, diretor, admin | onde os dados estão hospedados (§7) |
| `POST /alunos/:alunoId/anonimizar` | secretaria, diretor, admin | direito ao esquecimento; exige `{ "confirmar": true }` |
| `POST /consentimento/codigo` | qualquer titular autenticado | envia o código de confirmação por e-mail |
| `POST /consentimento/confirmar` | qualquer titular autenticado | registra o consentimento com `metodoValidacao` |

`GET /educacenso` aceita `?formato=arquivo` (JSON para download) e
`?formato=txt` (arquivo de migração delimitado; responde 409 com a lista de
pendências enquanto houver cadastro incompleto).

Parâmetros comuns: `?anoLetivo=2026` e `?diasLetivos=200` (padrão da LDB).

O professor identifica a infrequência, mas **quem comunica a autoridade é a
gestão da unidade** — por isso a ficha e as exportações ficam fora do perfil
dele, e o teste cobre esse 403.

---

## 7. O que falta — lista de trabalho

Esta lista reúne o que depende de laudo, de contrato ou de configuração de
infraestrutura. O trabalho de **código** em andamento está nas Issues do plano
de conformidade (#378 e seguintes) e nos itens marcados **Parcial** acima.

1. **Permissão do banco para o log de auditoria** (`tipo:melhoria`, infra). A
   aplicação já recusa update e delete em `audit_logs`, mas middleware só vale
   para quem passa pelo mongoose. O usuário de aplicação no Atlas precisa ter
   `insert` e `find` na coleção e **não** ter `update`/`remove`. O código impede
   o acidente; a permissão impede o dolo.
2. **Auditoria WCAG/eMAG com leitor de tela real** (`tipo:melhoria`). Os
   recursos estão entregues (§3); falta o laudo, que é o que o edital pede — e
   que vai apontar a semântica página a página. Fazer contra a **ABNT NBR
   17225:2025** (WCAG 2.2), que tem critérios que o eMAG não tem — por exemplo
   tamanho mínimo de alvo (2.5.8) e foco não encoberto (2.4.11).
3. **Validação por SMS ou Gov.br** (`tipo:nova-funcao`). Dependem de contrato
   com gateway e de credenciamento do município como serviço confiante. O campo
   `metodoValidacao` já existe e já distingue as forças de validação, então
   entrar com um deles não exige remodelar nada.
4. **Conferir o leiaute do Educacenso da edição corrente** (`tipo:melhoria`,
   anual). Abrir o caderno do INEP do ano e conferir `REGISTROS` em
   `leiauteEducacenso.js`. É trabalho de uma issue por edição, por definição.
5. **Declarar a região dos dados** (`tipo:chore`, infra). Definir `DATA_REGION`
   e `DATA_REGION_PAIS` no Render e conferir a região do cluster no Atlas. O
   boot já registra a situação e `GET /api/conformidade/soberania` responde a
   pergunta com data — enquanto não houver declaração, o log sai em nível de
   alerta.
6. **Segundo fator em toda conta admin** (`tipo:melhoria`, configuração). Seguir
   o roteiro de [`docs/2FA-OBRIGATORIO.md`](2FA-OBRIGATORIO.md) — prontidão,
   ativação na própria conta, validação com código de backup — e só então
   acrescentar `admin` a `PERFIS_2FA_OBRIGATORIO` no Render. O perfil de maior
   alcance do sistema não pode depender só de senha.

Itens acrescentados na revisão de setembro de 2026:

7. **Publicar o encarregado** (institucional). O e-mail de exemplo já saiu
   das telas (Issue #530); falta a rede nomear o encarregado e publicar nome e
   canal reais em `html/politica-privacidade.html`, `html/cadastro-aluno.html`
   e `PoliticaPrivacidade.tsx` (Res. CD/ANPD nº 18/2024). Anda junto com a
   Issue #400.
8. **Cláusulas-padrão da ANPD nos contratos com fornecedores estrangeiros**
   (institucional, **atrasado**). Render, Google e ElevenLabs. O prazo da Res.
   CD/ANPD nº 19/2024 venceu em 23/08/2025. Alternativa técnica que reduz o
   problema: mover a aplicação para região no Brasil (Render não tem; exigiria
   trocar de hospedagem) — ver item 5.
9. **Registrar a análise de aplicabilidade do ECA Digital** (`tipo:melhoria`,
   documento). Escrever em `docs/lgpd/` por que o sistema não é serviço
   direcionado a criança (sem login de aluno), o que já cumpre dos deveres
   gerais e o gatilho para refazer a análise. As sanções da ANPD estão
   previstas a partir de novembro de 2026.
10. ~~Registro de incidentes de segurança~~ — **entregue** na Issue #513
    (§2). Falta a tela do painel e aprovar o plano de resposta.
11. ~~Nome social do aluno~~ — **entregue** na Issue #510 (§4).
12. ~~Encaminhamento de violência ao Conselho Tutelar~~ — **entregue** na
    Issue #511 (§4). Falta a ficha em PDF no modelo da de infrequência.
13. ~~Relatório bimestral de bullying~~ — **entregue** na Issue #512 (§4).
    Falta a tela de publicação.

Ver também os itens 14 a 17, da §9 (São Paulo e Americana).

Fora do código, mas que a rede deve acompanhar: a **Lei 13.460/2017** (ouvidoria
e carta de serviços do município — o canal é da prefeitura, não deste sistema),
a **Lei 14.063/2020** se a rede quiser que documentos emitidos pelo sistema
(ficha do Conselho, declarações) tenham assinatura eletrônica em vez de
impressa, e o **PL 2338/2023** (marco da IA), que em setembro de 2026 ainda
aguarda parecer na Câmara e não é lei.

---

## 8. Testes que sustentam este documento

| Arquivo | O que fixa |
|---|---|
| [`frequenciaLdb.test.js`](../backend/src/tests/frequenciaLdb.test.js) | os gatilhos legais nas bordas (14 vs 15 faltas, 49 vs 50) |
| [`conformidadeRotas.test.js`](../backend/src/tests/conformidadeRotas.test.js) | contagem por dia, recorte por perfil e por escola, e o rastro em `AuditLog` |
| [`educacenso.test.js`](../backend/src/tests/educacenso.test.js) | códigos do INEP e a lista de pendências |
| [`dadosAbertosAnonimato.test.js`](../backend/src/tests/dadosAbertosAnonimato.test.js) | a supressão que impede reidentificação |
| [`fichaConselhoTutelar.test.js`](../backend/src/tests/fichaConselhoTutelar.test.js) | o conteúdo do documento oficial (endereço, responsáveis, dias) |
| [`auditLogImutavel.test.js`](../backend/src/tests/auditLogImutavel.test.js) | que nenhuma escrita além de inserção passa em `audit_logs` |
| [`anonimizacaoAluno.test.js`](../backend/src/tests/anonimizacaoAluno.test.js) | a lista de campos que saem e os que ficam — inclusive a chave de busca |
| [`validacaoConsentimento.test.js`](../backend/src/tests/validacaoConsentimento.test.js) | as bordas do código de confirmação (expirado, travado, nunca pedido) |
| [`consentimentoCadastro.test.js`](../backend/src/tests/consentimentoCadastro.test.js) | as cinco rotas de cadastro recusam sem aceite e gravam o registro auditável com ele; gestor não consente por outra pessoa; e uma trava que reprova qualquer `Usuario.create` que volte a gravar consentimento sozinho |
| [`canalDenuncia.test.js`](../backend/src/tests/canalDenuncia.test.js) | gravidade por categoria e o fato de nada ser bloqueado |
| [`leiauteEducacenso.test.js`](../backend/src/tests/leiauteEducacenso.test.js) | sanitização do separador e a recusa de gerar lote incompleto |
| [`soberaniaDados.test.js`](../backend/src/tests/soberaniaDados.test.js) | o conflito entre região declarada e infraestrutura real |
| [`pedidosTitular.regressao.test.js`](../backend/src/tests/pedidosTitular.regressao.test.js) | pedido do titular com protocolo e prazo de 15 dias, exportação com os dados do filho e despacho só pelo admin |
| [`registroPedidoTitular.regressao.test.js`](../backend/src/tests/registroPedidoTitular.regressao.test.js) | motivo do titular fora do `AuditLog`, prazo sem atribuição à lei, escola do pedido pelo id, protocolo sem pedaço do id da conta e busca da fila junto com a escola |
| [`loginPorPortal.test.js`](../backend/src/tests/loginPorPortal.test.js) | recusa de conta na porta errada, sem cookie, depois da prova de senha |
| [`handshakeSocket.regressao.test.js`](../backend/src/tests/handshakeSocket.regressao.test.js) | handshake do Socket.IO recusa token encerrado no logout e token que não é de sessão; mantém conta ativa e `tokenVersion` |
| [`autorizacoesProfessor.regressao.test.js`](../backend/src/tests/autorizacoesProfessor.regressao.test.js) | professor vê só a situação das autorizações das próprias turmas, e só se a direção da escola liberou |
| [`avisoIndicadores.regressao.test.js`](../backend/src/tests/avisoIndicadores.regressao.test.js) | indicadores automáticos sobre aluno chegam com o aviso de apoio; o cálculo não altera o cadastro |
| [`avaliacoesPublicas.regressao.test.js`](../backend/src/tests/avaliacoesPublicas.regressao.test.js) | avaliação pública só com adesão e moderação, iniciais no lugar de nome, sem foto nem id da conta — também na listagem do painel e no evento em tempo real |
| [`restricaoJudicial.regressao.test.js`](../backend/src/tests/restricaoJudicial.regressao.test.js) | responsável bloqueado por decisão judicial perde o acesso mesmo com o e-mail na ficha; o outro responsável segue; só a gestão da escola marca |
| [`iaPedagogico.regressao.test.js`](../backend/src/tests/iaPedagogico.regressao.test.js) | insight global sem nome de aluno no texto enviado ao provedor; controllers pedagógicos não chamam o provedor em escola sem adesão à IA, mesmo fora da rota protegida |
| [`nomeSocial.regressao.test.js`](../backend/src/tests/nomeSocial.regressao.test.js) | só a gestão registra o nome social, com requerimento e regra de idade; o professor recebe o nome social sem o civil; anonimização e IA; AuditLog sem o nome |
| [`conselhoTutelarViolencia.regressao.test.js`](../backend/src/tests/conselhoTutelarViolencia.regressao.test.js) | denúncia de violência, assédio e automutilação exige a comunicação; fila por escola sem relato; só a direção dispensa; não registra duas vezes |
| [`relatorioBullying.regressao.test.js`](../backend/src/tests/relatorioBullying.regressao.test.js) | bimestre civil no fuso de Brasília; recorte por categoria, escola e período; supressão k = 5 inclusive contra subtração; só a gestão |
| [`registroIncidentes.regressao.test.js`](../backend/src/tests/registroIncidentes.regressao.test.js) | prazo de 3 dias úteis com fim de semana e feriado; sem TTL e sem exclusão; regras de encerramento; só admin; AuditLog sem o texto livre |

---

## 9. Estado de São Paulo e município de Americana

Levantamento de setembro de 2026. A rede-alvo é a **municipal de Americana
(SP)**, então as normas do sistema **estadual** de ensino (Conviva SP, Placon,
protocolos da Seduc-SP) orientam, mas não obrigam a rede municipal — a menos
que a Secretaria de Educação de Americana as adote por ato próprio. O que
obriga Americana é: lei federal, lei e decreto **municipais**, e as normas do
**Conselho Municipal de Educação de Americana (CMEA)**, que é o órgão
normativo do sistema municipal.

| Norma | Alcance | Situação | O que pede ao sistema |
|---|---|---|---|
| **Decreto estadual 55.588/2010** (nome social) | administração estadual; a Seduc-SP o aplica no cadastro de alunos, lista de chamada, carteirinha e boletim | **Pronto** | atendido pelo nome social da Issue #510 (§4). Na rede municipal a base é a Resolução CNE/CP nº 1/2018, que é nacional |
| **Lei estadual 18.069/2024** (protocolo de combate ao bullying) | rede **estadual** | referência | o protocolo pede registro e acompanhamento do caso; o item 13 da §7 e o fluxo de denúncia já seguem essa linha |
| **Programa Conviva SP / Placon** (registro de ocorrências escolares) | rede **estadual** | não se aplica, salvo adesão | se Americana aderir, o sistema precisaria exportar as ocorrências no formato da Seduc — hoje não exporta |
| **Secretaria Escolar Digital (SED)** e Matrícula Antecipada | parceria Estado–municípios; a SED é usada por redes estaduais, municipais e privadas de SP | **Parcial** | o sistema **importa** o PDF de alunos da SEDUC (`services/importacaoAlunos`) e guarda o RA (`Aluno.matricula`, alias `ra`); não devolve dados para a SED. `[CONFIRMAR COM A SECRETARIA DE AMERICANA]` se o cadastro da rede municipal passa pela SED ou só pelos sistemas próprios da prefeitura (INFOSEDUC/SISGERED) |
| **Decreto municipal de LGPD de Americana** | prefeitura de Americana | **Pendente — não localizado** | a pesquisa não achou decreto de Americana que regulamente a LGPD, como o Decreto 59.767/2020 faz na capital. É esse ato que costuma dizer **quem é o controlador** e **quem é o encarregado** do município — exatamente as duas lacunas dos itens 7 e 8. `[CONFIRMAR NA PREFEITURA / CONTROLADORIA DE AMERICANA]` |
| **PL 58/2026 da Câmara de Americana** (diretrizes para tecnologias digitais e IA na rede municipal) | rede **municipal** | **Acompanhar** | aprovado em 2ª discussão em agosto de 2026; foco declarado em proteção de dados, segurança de crianças, transparência e participação das famílias. Não localizamos o texto nem a sanção. O sistema já tem IA **desligada por padrão por escola**, pseudonimização e aviso de apoio sem decisão automática (§1); se virar lei, conferir artigo por artigo — item 16 |
| **Normas do CMEA** (regimento escolar, avaliação, frequência) | rede **municipal** | **Pendente — não conferido** | calendário (dias letivos), escala de notas, recuperação e compensação de ausências são definidos pelo sistema municipal. O sistema aceita `?diasLetivos` e configurações por escola, mas os valores de Americana não foram conferidos contra as deliberações do CMEA — item 17 |

### Itens de trabalho desta seção

14. ~~Nome social também pela norma paulista~~ — **entregue** com o item 11
    (Issue #510). O requerimento fica arquivado na secretaria; o sistema
    guarda quem pediu, quando e quem registrou.
15. ~~Fluxo da Lei 15.231/2025~~ — **entregue** com o item 12 (Issue #511):
    automutilação sai sigilosa e a fila não mostra relato nem autor.
16. **Conferir a lei de IA de Americana**, se sancionada (`tipo:melhoria`).
    Obter o texto final do PL 58/2026 e mapear cada artigo contra
    `services/ia/`, como foi feito para a LGPD na §1.
17. **Conferir os parâmetros pedagógicos com o CMEA** (`tipo:melhoria`).
    Dias letivos, compensação de ausências e escala de avaliação da rede de
    Americana, e se há deliberação municipal sobre escrituração escolar digital.

Pedidos que dependem da Secretaria de Educação de Americana, não do código:
o decreto municipal de LGPD (ou a confirmação de que não existe), a adesão ou
não à SED/Conviva e as deliberações vigentes do CMEA.
