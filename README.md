# MCP App

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Statements](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/jacksonbicalho/mcp-app/master/.github/badges/statements.json)](COVERAGE.md)
[![Branches](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/jacksonbicalho/mcp-app/master/.github/badges/branches.json)](COVERAGE.md)
[![Functions](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/jacksonbicalho/mcp-app/master/.github/badges/functions.json)](COVERAGE.md)
[![Lines](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/jacksonbicalho/mcp-app/master/.github/badges/lines.json)](COVERAGE.md)

Dar a um agente de IA (Cursor, Claude Desktop) acesso direto e seguro ao contexto real de um sistema — schema do banco, código-fonte, tickets, logs e merge requests — sem que ele precise adivinhar ou você precise copiar/colar tudo manualmente a cada pergunta. Este é um servidor MCP (Model Context Protocol) construído com NestJS que expõe esse contexto do sistema App como um conjunto de ferramentas: banco de dados PostgreSQL, código-fonte, tickets Jira, logs no Kibana e merge requests no GitLab.

## Sumário

- [Pré-requisitos](#pré-requisitos)
- [Funcionalidades](#funcionalidades)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Execução](#execução)
- [Configuração no Cursor / Claude Desktop](#configuração-no-cursor--claude-desktop)
- [Ferramentas Disponíveis](#ferramentas-disponíveis)
- [Resources Disponíveis](#resources-disponíveis)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Testes](#testes)
- [Segurança](#segurança)
- [Exemplos de Uso](#exemplos-de-uso)
- [Troubleshooting](#troubleshooting)
- [Contribuindo](#contribuindo)
- [Licença](#licença)

## Pré-requisitos

- **Node.js** ≥ 18 (usa `fetch` nativo; veja `engines` em [`package.json`](package.json))
- **Yarn** (gerenciador de pacotes deste projeto — veja `packageManager` em `package.json`; ative com `corepack enable` se necessário)
- **PostgreSQL** acessível (o banco a ser analisado pelas ferramentas `db_*`)
- Opcional, por integração: uma conta/token do **Jira Cloud**, um **Kibana** 7.6.x acessível e/ou um **GitLab** self-hosted com Personal Access Token

## Funcionalidades

### Análise do Banco de Dados PostgreSQL

- **Conexão**: Teste de conexão e estatísticas do banco
- **Tabelas**: Listagem, busca e detalhes de tabelas
- **Colunas**: Informações detalhadas sobre colunas
- **Relacionamentos**: Foreign keys e grafo de relacionamentos
- **Índices**: Informações sobre índices
- **Dados**: Amostras de dados de tabelas
- **Consultas**: Execução de queries SELECT

### Análise do Código Fonte

- **Visão geral**: Framework, diretórios e pontos de entrada
- **Navegação**: Listar diretórios e ler arquivos
- **Busca**: Buscar arquivos, conteúdo e URLs
- **Estatísticas**: Contagem de arquivos por extensão
- **PHP**: Análise de classes, métodos e propriedades
- **Referências ao BD**: Encontrar referências ao banco no código

### Jira

- Obter issue por chave (inclui campos tipados de Gestão de mudança e demais custom fields preenchidos)
- Busca por JQL ou por filtros (projeto, assignee, status, tipo)

### Kibana / logs (Elasticsearch via console proxy)

- Health check (`GET /api/status`) — Kibana 7.6.x
- Busca com DSL Elasticsearch via `POST /api/console/proxy`
- Listagem de campos do index-pattern (saved object)
- Hosts internos (`*.internal.example`) exigem DNS corporativo / VPN no processo que roda o MCP

### GitLab

- Health check e autenticação via Personal Access Token (`PRIVATE-TOKEN`)
- Detalhes de merge request, discussions (comentários/review) e listagem de MRs
- Projeto padrão configurável (`apps/example/services/app`)

## Instalação

```bash
# Instalar dependências
yarn install

# Compilar o projeto
yarn build
```

## Configuração

Toda config específica de ambiente (banco, Jira, Kibana, GitLab, `APP_PATH`) vive em `environments.json` — um bloco por ambiente (`development`, `staging`, `production`, `local`). O Cursor vê **um** servidor MCP; o `.env` só guarda nome e versão do servidor. Sem `APP_ENV`, o bloco ativo é `development`.

```bash
cp .env.example .env
cp environments.example.json environments.json
# edite environments.json com as credenciais de cada ambiente
```

### `.env`

```env
# Identidade do servidor MCP (não varia por ambiente)
MCP_SERVER_NAME=mcp-app
MCP_SERVER_VERSION=1.0.0
```

### `environments.json`

Um objeto por ambiente (`development`, `staging`, `production`, `local`, …). A chave **é** o seletor — não coloque `APP_ENV` dentro do bloco. Formato plano (`{ "DB_HOST": "…" }`) ou `{ "env": { "DB_HOST": "…" } }`. Dentro de cada bloco, as chaves abaixo — organizadas pelo mesmo módulo que as consome em `src/` (cada integração é independente; remover um módulo só exige remover seu bloco de chaves, nada mais).

#### Banco de Dados — `src/database` (obrigatório)

| Variável      | Descrição              |
| ------------- | ---------------------- |
| `DB_HOST`     | Host do PostgreSQL     |
| `DB_PORT`     | Porta (default `5432`) |
| `DB_DATABASE` | Nome do banco          |
| `DB_USERNAME` | Usuário                |
| `DB_PASSWORD` | Senha                  |

#### Análise de código — `src/analyzer` (obrigatório para as ferramentas `code_*`)

| Variável   | Descrição                                               |
| ---------- | ------------------------------------------------------- |
| `APP_PATH` | Caminho absoluto do código-fonte do App a ser analisado |

#### Jira — `src/jira` (opcional)

| Variável         | Descrição                                                    |
| ---------------- | ------------------------------------------------------------ |
| `JIRA_BASE_URL`  | URL do Jira Cloud (ex.: `https://seu-dominio.atlassian.net`) |
| `JIRA_EMAIL`     | E-mail da conta do token                                     |
| `JIRA_API_TOKEN` | API token do Jira                                            |

#### Kibana — `src/kibana` (opcional; Kibana 7.6.x via console proxy)

| Variável                                      | Descrição                                   |
| --------------------------------------------- | ------------------------------------------- |
| `KIBANA_BASE_URL`                             | URL base do Kibana                          |
| `KIBANA_INDEX_PATTERN`                        | Index pattern default (ex.: `app*`)         |
| `KIBANA_INDEX_PATTERN_ID`                     | ID do saved object do index-pattern         |
| `KIBANA_XSRF_VALUE`                           | Header `kbn-xsrf` (default `kibana`)        |
| `KIBANA_USERNAME` / `KIBANA_PASSWORD`         | Auth Basic (alternativa ao API Key)         |
| `KIBANA_API_KEY_ID` / `KIBANA_API_KEY_SECRET` | Auth API Key Elastic (alternativa ao Basic) |

#### GitLab — `src/gitlab` (opcional; self-hosted, API v4)

| Variável              | Descrição                                          |
| --------------------- | -------------------------------------------------- |
| `GITLAB_BASE_URL`     | URL da instância GitLab                            |
| `GITLAB_TOKEN`        | Personal Access Token (header `PRIVATE-TOKEN`)     |
| `GITLAB_PROJECT_PATH` | Projeto default (ex.: `apps/example/services/app`) |

Exemplo completo (um ambiente, todas as chaves): [`environments.example.json`](environments.example.json).

### Precedência de variáveis

1. **`overrides` de `use_environment`** = o cliente passa host/senha/token na conversa; vence tudo.
2. **Bloco `"env"` da config MCP** (Cursor / Claude Desktop) = fixado na subida do processo; `environments.json` não sobrescreve essas chaves.
3. **`environments.json[<ambiente>]`** = bloco ativo (default `development`). `use_environment` troca o bloco sem reiniciar.
4. **`.env`** = identidade do servidor (`MCP_SERVER_NAME`, `MCP_SERVER_VERSION`) e fallback de chaves soltas.

O bloco `"env"` do cliente MCP **não é uma lista fixa de chaves conhecidas** — é o `process.env` real do processo. O cliente pode colocar lá **qualquer variável** e ela sempre vence. Exemplo — sobrescrevendo só o índice do Kibana:

```json
{
  "mcpServers": {
    "mcp-app": {
      "command": "node",
      "args": ["/projetos/mcp-app/dist/main.js"],
      "cwd": "/projetos/mcp-app",
      "env": {
        "KIBANA_INDEX_PATTERN": "outro-index*"
      }
    }
  }
}
```

Isso vale para qualquer chave lida via `ConfigService` (`DB_*`, `JIRA_*`, `KIBANA_*`, `GITLAB_*`, `APP_PATH`, ou uma nova).

Mudar o JSON do cliente e **reiniciar** o MCP atualiza o `env` pinado. Na conversa, `use_environment` troca o bloco e aceita `overrides` sem reiniciar.

`environments.json` é obrigatório. `APP_ENV` **não** vai no `.env`: o default é `development`. Peça _“trabalhe em staging”_ ou passe `APP_ENV` no `env` do MCP. O servidor recusa subir se `environments.json` não existir ou se o ambiente apontar para um bloco que não existe nele.

Referência completa: [`.env.example`](.env.example) e [`environments.example.json`](environments.example.json).

## Execução

```bash
# Modo produção (compilado)
yarn build
yarn start

# Modo desenvolvimento
yarn start:dev
```

Após alterar o código, rode `yarn build` e **reinicie** o servidor MCP no cliente.

## Configuração no Cursor / Claude Desktop

**Um processo = um MCP.** Não cadastre `mcp-app-development` e `mcp-app-staging` ao mesmo tempo — são filhos com as mesmas tools. As credenciais ficam em `environments.json`; o cliente só sobe o processo. Veja [`cursor-mcp-config.example.json`](cursor-mcp-config.example.json).

```json
{
  "mcpServers": {
    "mcp-app": {
      "command": "node",
      "args": ["/projetos/mcp-app/dist/main.js"],
      "cwd": "/projetos/mcp-app"
    }
  }
}
```

Use `"command": "node"` direto. Rodar via `yarn start`/`npm start` escreve banner no stdout e quebra o handshake stdio.

O bloco `"env"` do cliente **continua válido** — qualquer chave (`APP_ENV`, `DB_HOST`, `JIRA_API_TOKEN`, …) entra no processo e **não é sobrescrita** por `environments.json`.

Para **trocar de ambiente na conversa** (sem reiniciar), peça ao assistente: _“trabalhe no ambiente de development”_. Ele chama `use_environment`. Também dá para passar credenciais na hora via `overrides`.

Para já subir em outro bloco, sem tool:

```json
"env": { "APP_ENV": "staging" }
```

**Claude Desktop usa esse mesmo JSON**, colado dentro de `claude_desktop_config.json`:

- Linux: `~/.config/claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Se o arquivo já existir com outros servidores MCP, adicione só a entrada `mcp-app` dentro de `"mcpServers"`, sem substituir o resto.

Desenvolvimento com ts-node:

```json
{
  "mcpServers": {
    "mcp-app": {
      "command": "npx",
      "args": ["ts-node", "/projetos/mcp-app/src/main.ts"],
      "cwd": "/projetos/mcp-app"
    }
  }
}
```

## Ferramentas Disponíveis

### Banco de Dados

| Ferramenta             | Descrição                                                |
| ---------------------- | -------------------------------------------------------- |
| `db_test_connection`   | Testa a conexão com o PostgreSQL                         |
| `db_get_stats`         | Obtém estatísticas do banco (tamanho, tabelas, índices)  |
| `db_list_tables`       | Lista todas as tabelas (com contagem de linhas opcional) |
| `db_get_table_details` | Detalhes de uma tabela (colunas, FKs, índices)           |
| `db_get_table_columns` | Informações das colunas de uma tabela                    |
| `db_get_foreign_keys`  | Foreign keys de uma ou todas as tabelas                  |
| `db_get_indexes`       | Índices de uma ou todas as tabelas                       |
| `db_get_sample_data`   | Amostra de dados de uma tabela                           |
| `db_search_tables`     | Busca tabelas por nome                                   |
| `db_search_columns`    | Busca colunas por nome                                   |
| `db_execute_query`     | Executa queries SELECT                                   |
| `db_get_relationships` | Grafo de relacionamentos do banco                        |

### Análise de Código

| Ferramenta               | Descrição                                            |
| ------------------------ | ---------------------------------------------------- |
| `code_get_overview`      | Visão geral do sistema (framework, diretórios)       |
| `code_list_directory`    | Lista arquivos de um diretório                       |
| `code_read_file`         | Lê conteúdo de um arquivo                            |
| `code_search_files`      | Busca arquivos por nome                              |
| `code_search_in_files`   | Busca texto dentro de arquivos                       |
| `code_get_stats`         | Estatísticas do código (extensões, maiores arquivos) |
| `code_get_structure`     | Estrutura de diretórios                              |
| `code_analyze_php_file`  | Analisa classe PHP (métodos, propriedades)           |
| `code_get_db_references` | Encontra referências ao banco no código              |
| `code_search_url`        | Busca uma URL no código e, se necessário, no banco   |

### Ambiente

| Ferramenta                | Descrição                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `use_environment`         | Ativa `development` / `staging` / `production` / `local` para as próximas tools. `overrides` aceita credenciais do cliente |
| `list_environments`       | Nomes dos blocos em `environments.json`                                                                                    |
| `get_current_environment` | Ambiente ativo e chaves setadas (sem valores)                                                                              |

### Jira

| Ferramenta              | Descrição                                                         |
| ----------------------- | ----------------------------------------------------------------- |
| `jira_get_issue`        | Issue por chave; inclui Gestão de mudança tipada e `customFields` |
| `jira_search`           | Busca por JQL                                                     |
| `jira_search_by_filter` | Busca por projeto / assignee / status / tipo (gera JQL)           |

### Kibana

| Ferramenta                    | Descrição                                                        |
| ----------------------------- | ---------------------------------------------------------------- |
| `kibana_test_connection`      | `GET /api/status` (versão e estado)                              |
| `kibana_search`               | Busca Elasticsearch (DSL) via console proxy; index padrão `app*` |
| `kibana_index_pattern_fields` | Campos conhecidos do index-pattern no Kibana                     |

Para `kibana_search`, use campos em minúsculo quando aplicável (ex.: `extra.tags.industry.keyword` para term exato). Exemplo útil em QA: filtrar `extra.tags.industry.keyword = qa` e erros (`level_name.keyword = ERROR` ou `level >= 400`).

### GitLab

| Ferramenta                   | Descrição                                                     |
| ---------------------------- | ------------------------------------------------------------- |
| `gitlab_test_connection`     | `GET /api/v4/user` (valida token)                             |
| `gitlab_get_merge_request`   | Detalhes do MR por IID                                        |
| `gitlab_get_mr_discussions`  | Discussions/comentários do MR (equivalente ao curl de review) |
| `gitlab_list_merge_requests` | Lista MRs do projeto (`state` default `opened`)               |

`projectPath` usa barras (ex.: `apps/example/services/app`); default em `GITLAB_PROJECT_PATH`.

## Resources Disponíveis

| URI                                 | Descrição                                           |
| ----------------------------------- | --------------------------------------------------- |
| `app://database/overview`           | Visão geral do banco de dados                       |
| `app://database/tables`             | Lista de tabelas com contagem                       |
| `app://database/relationships`      | Relacionamentos entre tabelas                       |
| `app://code/overview`               | Visão geral do código                               |
| `app://code/stats`                  | Estatísticas do código                              |
| `app://jira/issue/{issueKey}`       | Ticket Jira por chave                               |
| `app://jira/search?jql=...`         | Busca Jira (JQL URL-encoded; `maxResults` opcional) |
| `app://gitlab/mr/{iid}`             | Merge request GitLab (query `projectPath` opcional) |
| `app://gitlab/mr/{iid}/discussions` | Discussions do MR                                   |

## Estrutura do Projeto

```
mcp-app/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   │   └── error-info.ts          # normaliza `unknown` de catch em {message, stack}
│   ├── config/
│   │   ├── pino.config.ts
│   │   ├── load-environments.ts   # .env (nome/versão) + environments.json[ambiente]
│   │   ├── environment.service.ts # troca de ambiente em runtime
│   │   └── config.mcp-provider.ts # use_environment / list / get
│   ├── database/                  # inclui database.mcp-provider.ts
│   ├── analyzer/                  # inclui analyzer.mcp-provider.ts
│   ├── jira/                      # inclui jira.mcp-provider.ts
│   ├── kibana/                    # inclui kibana.mcp-provider.ts
│   ├── gitlab/                    # inclui gitlab.mcp-provider.ts
│   └── mcp/                       # McpService + McpToolRegistryService (discovery)
├── scripts/
│   ├── coverage-teardown.ts       # globalTeardown do Jest — ratchet de cobertura
│   └── coverage-report.ts         # gera COVERAGE.md
├── .github/workflows/tests.yml    # lint + build + test:cov no CI
├── coverage.config.json           # threshold atual do ratchet (versionado)
├── COVERAGE.md                    # gerado por `yarn test:cov`, não editar
├── jest.config.ts
├── jest.setup.ts
├── cursor-mcp-config.example.json
├── environments.json              # Não versionar — credenciais por ambiente
├── environments.example.json
├── .env                           # Não versionar
├── .env.example
├── .nvmrc
├── eslint.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Testes

Testes unitários com Jest + ts-jest, um `.spec.ts` ao lado de cada arquivo testado.

```bash
yarn test        # roda a suíte
yarn test:watch  # modo watch
yarn test:cov    # com cobertura
```

`yarn test:cov` aplica um **ratchet de cobertura**: o threshold de cada métrica
(lines/statements/functions/branches) fica salvo em [`coverage.config.json`](coverage.config.json)
e o Jest falha se a cobertura cair abaixo dele. Quando a cobertura sobe, um
`globalTeardown` ([`scripts/coverage-teardown.ts`](scripts/coverage-teardown.ts))
sobe o threshold automaticamente (nunca desce sozinho) e regrava
[`COVERAGE.md`](COVERAGE.md) com o detalhamento por arquivo. No CI
([`.github/workflows/tests.yml`](.github/workflows/tests.yml)), essa atualização
é commitada de volta automaticamente em push para `master`.

## Segurança

- Apenas queries SELECT, WITH e EXPLAIN são permitidas no banco
- Arquivos grandes (>1MB) são rejeitados na leitura
- Diretórios sensíveis (`node_modules`, `vendor`, logs) são ignorados na busca
- Credenciais via variáveis de ambiente (não commitar `.env` nem `environments.json`)
- Path do console proxy do Kibana valida o index pattern (apenas leitura `_search`)
- Token GitLab (`GITLAB_TOKEN`) nunca deve ser commitado

## Exemplos de Uso

### Analisar uma tabela específica

```
Use a ferramenta db_get_table_details com tableName="pedidos" para ver a estrutura da tabela de pedidos
```

### Buscar todas as tabelas relacionadas a clientes

```
Use db_search_tables com searchTerm="cliente" para encontrar tabelas de clientes
```

### Ver relacionamentos do banco

```
Use db_get_relationships para obter o grafo de relacionamentos
```

### Analisar o código fonte

```
Use code_get_overview para ter uma visão geral do sistema
Use code_search_in_files com searchTerm="pg_query" para encontrar queries no código
```

### Ticket Jira e logs

```
Use jira_get_issue com issueKey="PROJ-123"
Use kibana_test_connection para validar o Kibana
Use kibana_search com dsl={ "size": 10, "query": { "bool": { "filter": [ { "term": { "extra.tags.industry.keyword": "qa" } } ] } } }
```

### GitLab MR e review

```
Use gitlab_get_mr_discussions com mergeRequestIid=429
Use gitlab_get_merge_request com mergeRequestIid=429
Use app://gitlab/mr/429/discussions como resource
```

## Troubleshooting

### Erro de conexão com o banco

- Verifique se o PostgreSQL está rodando
- Confirme as credenciais no bloco ativo de `environments.json` (default `development`)
- Host: `postgres` (Docker) ou IP/`localhost` conforme o ambiente

### Arquivo não encontrado (código)

- Verifique se `APP_PATH` está correto
- Use caminhos relativos a partir da raiz do App

### Timeout em queries

- Queries complexas podem demorar; use LIMIT
- Verifique a performance do banco

### Variáveis "não pegam" / erro logo na subida citando `APP_ENV` ou `environments.json`

- Confirme que `environments.json` está na **raiz** do repositório
- Sem `APP_ENV`, o default é `development` — esse bloco precisa existir
- `APP_ENV` só é necessário para trocar de bloco (ex.: `staging`); confirme que a chave existe (a mensagem lista os ambientes)
- Cadastre **um** MCP no cliente; várias entradas do mesmo `dist/main.js` só duplicam tools
- Rode `yarn build` e **reinicie** o servidor MCP no cliente
- Chaves no bloco `env` do MCP sobrescrevem tudo, inclusive `APP_ENV`

### Kibana: Could not resolve host / ENOTFOUND

- Hostname interno (ex.: `*.internal.example`) só resolve na rede corporativa / VPN
- Não é erro de autenticação; o processo do MCP precisa resolver o DNS
- Em ambientes com auth, configure Basic (`KIBANA_USERNAME`/`KIBANA_PASSWORD`) ou API Key

### GitLab: 401 ou token inválido

- Confirme `GITLAB_TOKEN` (Personal Access Token) no bloco do ambiente em `environments.json` (ou no `env` do MCP)
- Verifique escopos do token (`read_api` ou equivalente para MRs)

## Contribuindo

Issues e pull requests são bem-vindos. Antes de abrir um PR:

```bash
yarn lint
yarn build
yarn test:cov
```

O CI roda os mesmos passos (veja [Testes](#testes)) e falha se a cobertura regredir.
Para fluxos que não têm teste automatizado ainda, valide manualmente rodando o
servidor (`yarn start:dev`) contra um ambiente configurado (veja [Configuração](#configuração)).

## Licença

Distribuído sob a licença MIT — veja [`LICENSE`](LICENSE).

© 2026 Jackson Bicalho.
