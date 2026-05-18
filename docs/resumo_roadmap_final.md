# 🏆 Resumo Final: Roadmap Sistema Escolar v3.1

Abaixo está o balanço geral do projeto. Dividimos a lista entre tudo o que já conquistamos (Feitos) e as tarefas que ficaram mapeadas para o futuro (Pendentes).

## ✅ O que já foi implementado (Feitos)

O sistema hoje é incrivelmente robusto, seguro e preparado para regras rigorosas como a LGPD.

### Segurança & Autenticação
- **2FA (Dois Fatores):** Administradores e diretores agora validam o login com código enviado por e-mail.
- **Proteção Brute-Force:** Contas são bloqueadas por 15 minutos após várias tentativas de erro, e um e-mail de alerta é enviado para a equipe de TI.
- **Prevenção contra XSS:** O `DOMPurify` foi integrado ao frontend para barrar scripts maliciosos injetados por usuários.
- **Verificação de E-mail:** Novos cadastros não entram direto; recebem um token por e-mail e precisam ativar a conta.
- **Notificações Críticas:** Qualquer alteração sensível (como rotação do código diário da escola) dispara alertas automatizados por e-mail.

### Compliance (LGPD Art. 18)
- **Portal do Titular:** Página "Meus Dados" completa, onde o usuário pode visualizar informações, baixar um pacote JSON completo de portabilidade e solicitar exclusão da conta.
- **Consentimento no Cadastro:** Telas de cadastro agora exigem aceite obrigatório das Políticas de Privacidade.
- **Anonimização Automática:** Scripts (Cron Jobs) varrem o banco mensalmente apagando dados sensíveis de contas inativas há mais de um ano.

### Módulo Acadêmico & Funcionalidades
- **Sistema de Notas & Boletim:** Validação rígida de notas (0 a 10) e endpoints que processam médias e fecham o boletim completo por aluno.
- **Paginação de Dados:** Preparado para milhares de alunos, entregando dados em páginas ao invés de sobrecarregar a memória.
- **Sistema de Changelog (Notificações):** Sino de novidades no dashboard (`changelog.js`) que avisa professores sobre atualizações no sistema, com lidos/não-lidos persistidos via localStorage.
- **Nova Logo & Arte visual:** Atualização premium de favicons (`.svg` e `.png`), limpando os códigos antigos e padronizando os PWA icons em toda a plataforma.

### Infraestrutura & Performance
- **PWA e Service Workers:** O sistema tem estratégia offline (*Stale-While-Revalidate*) e botão de instalação mobile com manifest.
- **Monitoramento Uptime:** Rota `/api/health` operante para manter instâncias da nuvem acordadas.
- **Índices no MongoDB:** Buscas de texto e ordenações no banco agora rodam milissegundos mais rápidas por conta da nova malha de índices (Text Index, TTL).

---

## ⏳ O que falta fazer (Pendentes)

Estas são as tarefas que ficaram para o backlog, pois exigem configurações fora do ambiente de código atual ou muito tempo de validação.

### Integrações Externas (Requer Painéis Terceiros)
1. **Google OAuth (Login com Google)**
   - Criar projeto no Google Cloud Console e gerar `Client ID` / `Secret`.
   - Adicionar as chaves no `.env` e mapear as rotas de callback do `passport-google-oauth20`.
2. **Cloudflare WAF e DNS**
   - Configurar o domínio no Cloudflare para ativar proteção anti-DDoS e cache de borda.

### Refatorações Estruturais de Código
3. **Remoção de todos os `onclick` do HTML**
   - A tarefa foi mapeada em `implementation_plan.md` e pausada. O objetivo é tirar o javascript de dentro do HTML e usar `addEventListener` em arquivos separados, fortalecendo a segurança contra XSS (via CSP).
4. **Testes Automatizados (Jest/Supertest)**
   - Escrever testes de integração para garantir que o fluxo de 2FA e bloqueios não quebre com novas atualizações de código.
5. **Migração para TypeScript**
   - Refatorar os Controllers e Models do backend para `.ts`, garantindo que um objeto de "Aluno" tenha os tipos estritamente validados no código antes de chegar no banco.

### Estratégia Mobile Pura
6. **Planejamento de App Nativo**
   - Discutir se a versão PWA (que acabamos de entregar) já supre as necessidades ou se valerá a pena iniciar um novo repositório em React Native/Flutter puxando os dados dessa mesma API que construímos.
