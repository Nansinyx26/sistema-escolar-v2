# RASCUNHO — PENDENTE DE VALIDAÇÃO JURÍDICA

> **Não publicar.** Este texto é um rascunho técnico: descreve o que o sistema
> faz hoje, no código, para que a assessoria jurídica e o encarregado de dados
> (DPO) transformem em documento oficial. Tudo entre `[ ]` depende de decisão
> ou informação que não está no código.
>
> Substitui, quando validado, o conteúdo de `html/politica-privacidade.html` e
> de `portal-responsavel/src/components/PoliticaPrivacidade.tsx`. O texto
> publicado hoje afirma coisas que o código não faz (por exemplo, log de
> auditoria "permanente", quando o prazo é de 365 dias) e omite outras que ele
> faz (fornecedores, processamento fora do país, uso de IA).

---

## 1. Quem trata os seus dados

| | |
|---|---|
| **Controlador** | `[NOME DA MANTENEDORA / SECRETARIA MUNICIPAL DE EDUCAÇÃO]`, CNPJ `[ ]`, endereço `[ ]` |
| **Encarregado (DPO)** | `[NOME]`, `[E-MAIL INSTITUCIONAL]`, `[TELEFONE]` |
| **Escolas atendidas** | `[LISTA DE UNIDADES]` |
| **Operadores** | fornecedores da seção 6 |

`[VALIDAR COM JURÍDICO]` quem é controlador e quem é operador em cada
tratamento: a decisão muda o texto das seções 5 e 6.

## 2. Quem usa o sistema

Direção, secretaria, professores e responsáveis legais. **Não existe conta de
aluno**: crianças e adolescentes não acessam o sistema, mas os dados deles são
tratados nele.

## 3. Que dados são tratados, para quê, e com qual base legal

Coluna preenchida para **escola pública**. Escola privada tem bases diferentes
em parte das linhas — `[VALIDAR COM JURÍDICO]` se houver unidade privada na rede.

| Dados | Para quê | Base legal (LGPD) |
|---|---|---|
| Identificação do aluno (nome, RA, turma, data de nascimento, sexo) | Matrícula, registro escolar, boletim, frequência | Art. 7º, II (obrigação legal — LDB, Censo Escolar) e III (políticas públicas) |
| Cor/raça, nacionalidade, deficiência e tipo de deficiência | Censo Escolar (INEP) e adaptação pedagógica | Art. 11, II, "a" — dado sensível tratado por obrigação legal |
| Alergias, medicação autorizada e condições de saúde essenciais | Segurança da criança na escola e atendimento em emergência | Art. 11, II, "e" — proteção da vida e da incolumidade física |
| Dados dos responsáveis (nome, contato, parentesco, vínculo) | Comunicação escola–família, autorizações, retirada da criança | Art. 7º, II e III (ECA, art. 56; LDB, art. 12) |
| Notas, frequência, observações pedagógicas | Acompanhamento escolar e obrigações de registro | Art. 7º, II e III |
| Documentos enviados pela família (autorizações assinadas, comprovantes) | Prova da manifestação do responsável | Art. 7º, II e VI (exercício regular de direitos) |
| Foto do aluno | Identificação interna nas telas do sistema | Art. 7º, III — **divulgação fora do sistema exige consentimento específico** |
| Dados de acesso (e-mail, senha em hash, registros de sessão e auditoria) | Autenticação, segurança e responsabilização | Art. 7º, II e art. 46 |
| CPF do aluno e plano de saúde | `[DECISÃO INSTITUCIONAL]` — hoje o sistema aceita esses campos; se a rede não precisar deles, devem sair do cadastro | — |

**Crianças e adolescentes (art. 14).** O tratamento é feito no melhor interesse
da criança. Conforme o Enunciado CD/ANPD nº 1/2023, os dados de criança podem
ser tratados pelas bases dos arts. 7º e 11 — não só por consentimento. O
consentimento específico do responsável é usado para o que **não** é necessário
à prestação do serviço educacional (por exemplo, publicação de imagem).

## 4. O que a escola **não** faz

- Não vende dados, não faz publicidade e não perfila ninguém para fins comerciais.
- Não condiciona boletim, frequência ou matrícula a qualquer pagamento (o
  sistema não tem módulo financeiro).
- Não expõe dados de aluno em página pública: nenhuma tela aberta devolve
  informação de criança.

## 5. Quem vê o quê, dentro do sistema

| Perfil | Acesso |
|---|---|
| Direção e secretaria | Dados da própria escola, para a função administrativa |
| Professor | Apenas os alunos das turmas dele, e apenas os campos que a função usa: identificação, dados pedagógicos, alergias e um indicador de necessidade de apoio. Não recebe CPF, endereço, religião, plano de saúde, dados dos responsáveis nem o código de vínculo |
| Responsável | Apenas os próprios filhos |
| Administração do sistema | Manutenção da rede |

Cada acesso e cada alteração relevante ficam registrados (seção 8).

## 6. Com quem os dados são compartilhados

| Fornecedor | Para quê | Onde processa | Situação do contrato |
|---|---|---|---|
| Render (hospedagem da aplicação) | Executar o sistema | **Estados Unidos** (região `oregon`) | `[DPA / CLÁUSULAS-PADRÃO — VALIDAR]` |
| MongoDB Atlas (banco de dados) | Guardar os dados | `[REGIÃO A CONFIRMAR]` | `[DPA — VALIDAR]` |
| Google (API Gemini) | Funções de assistente, **quando a escola liga** | Estados Unidos | `[DPA e plano contratado — VALIDAR: o plano gratuito permite ao provedor usar o conteúdo enviado]` |
| ElevenLabs (narração) | Ler textos em voz alta | Estados Unidos | `[DPA — VALIDAR]` |
| `[PROVEDOR DE E-MAIL]` | Enviar avisos e códigos | `[ ]` | `[DPA — VALIDAR]` |

Também há compartilhamento obrigatório com **INEP/MEC** (Censo Escolar),
**Conselho Tutelar** (LDB, art. 12, VIII; ECA, art. 56) e autoridades, quando a
lei exigir.

**Transferência internacional.** Parte do processamento ocorre fora do Brasil
(tabela acima). A LGPD (art. 33) exige um mecanismo próprio para isso —
`[VALIDAR COM JURÍDICO: cláusulas-padrão contratuais da ANPD ou outra hipótese]`.

## 7. Inteligência artificial

O assistente é **ligado escola por escola** e vem desligado por padrão. Quando
ligado:

- o nome da criança **não** é enviado: vira um rótulo ("Aluno A"), e o nome é
  recolocado no servidor antes de a resposta aparecer na tela;
- identificadores e data de nascimento não são enviados;
- motivo de falta, dados de saúde, deficiência, transtornos e observações em
  texto livre **nunca** são enviados;
- a narração em voz alta recusa qualquer texto que cite o nome de um aluno.

`[DECISÃO INSTITUCIONAL]` se a rede quer usar o assistente, e em quais escolas.

## 8. Por quanto tempo os dados ficam guardados

| Dado | Prazo praticado hoje |
|---|---|
| Registro escolar (notas, frequência, histórico) | Enquanto durar a obrigação de guarda escolar `[VALIDAR COM A SECRETARIA DE EDUCAÇÃO: tabela de temporalidade]` |
| Cadastro do aluno após a saída da rede | Anonimização a pedido: identificadores e dados de saúde saem, a vida escolar fica |
| Documentos enviados pela família | Enquanto durar o vínculo escolar `[VALIDAR]`; versões anteriores são preservadas |
| Registros de auditoria | 365 dias |
| Conversas do chat interno e do assistente | Prazo definido no próprio sistema (retenção automática) |
| Contas inativas | `[DECISÃO INSTITUCIONAL: hoje há anonimização automática após 12 meses sem acesso]` |

## 9. Seus direitos (art. 18) e como exercê-los

Confirmação de tratamento, acesso, correção, anonimização ou bloqueio do que for
desnecessário, portabilidade, informação sobre compartilhamento e revogação do
consentimento — quando a base for consentimento.

**Limites:** o que a escola guarda por obrigação legal (registro escolar, dados
do Censo) não é apagado a pedido; nesses casos o direito é exercido como
bloqueio ou anonimização do que não for necessário.

**Canal:** `[E-MAIL DO ENCARREGADO]`. Pelo sistema, em **Meus Dados**, é
possível baixar o pacote de dados e registrar pedido de exclusão, que recebe
protocolo e acompanhamento. Prazo de resposta: `[VALIDAR COM JURÍDICO — o art.
19 da LGPD fixa 15 dias para a declaração de acesso; para outros pedidos o
prazo depende de regulamento]`.

## 10. Segurança

Senha guardada como hash (bcrypt), segundo fator para direção e secretaria,
sessão em cookie protegido, transporte cifrado (HTTPS), separação de acesso por
perfil e por escola, registro de auditoria que não aceita alteração, e
conferência do conteúdo dos arquivos enviados.

**Incidente de segurança:** comunicação à ANPD e aos titulares conforme a LGPD
(art. 48) e o regulamento da ANPD sobre comunicação de incidentes
`[VALIDAR PRAZO E FORMULÁRIO VIGENTES]`. O procedimento interno está em
`docs/lgpd/plano-de-incidentes-RASCUNHO.md` (Fase 5).

---

**Versão deste rascunho:** `[definir]` · **Data:** `[definir]`
**Pendências que impedem a publicação:** identificação do controlador e do
encarregado; confirmação dos contratos e das regiões dos fornecedores; decisão
sobre IA; tabela de temporalidade; revisão jurídica do texto inteiro.
