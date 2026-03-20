# Multi-igreja (multi-tenant) — arquitetura

Objetivo: o mesmo deploy e o mesmo banco servem **várias igrejas**. A estrutura atual vira **Celeiro São Paulo**; uma nova igreja, **Inc São Paulo**, terá ministérios, líderes, escalas, check-ins e formulários **isolados**.

## 1. Conceito central: `Igreja` (tenant)

Cada registro representa uma organização.

| Campo sugerido | Uso |
|----------------|-----|
| `nome` | Ex.: "Celeiro São Paulo", "Inc São Paulo" |
| `slug` | Ex.: `celeiro-sp`, `inc-sp` — estável para URLs e APIs |
| `ativo` | Desativar sem apagar dados |

**Slug** deve ser único e imutável na prática (URLs públicas e links antigos).

## 2. O que fica “por igreja” (sempre filtrar por `igrejaId`)

| Coleção / domínio | Observação |
|-------------------|------------|
| `Ministerio` | Lista e cadastro por igreja |
| `Escala` + `Candidatura` + `EscalaInscricoesPorMinisterio` | Escalas e inscrições só da igreja |
| `EventoCheckin` + `Checkin` | Eventos e registros só da igreja |
| `EventoFormulario` + formulários (`FormularioMembro`, etc.) | Eventos e respostas por igreja |
| `User` (líder / voluntário) | Cada usuário “operacional” pertence a **uma** igreja (ou lista, se no futuro alguém puder atuar em duas — raro) |
| `RoleHistory` | Histórico de perfil no contexto da igreja |
| `Voluntario` | Ideal: **único por `(email + igrejaId)`** — mesma pessoa pode existir nas duas igrejas com o mesmo email |

## 3. Quem vê o quê

### Administrador global (“vê todas”)

- Usuário com papel que **não** está preso a uma igreja (ex.: `role: admin` **e** `igrejaId: null`), ou um flag explícito `isSuperAdmin` / lista de emails master.
- Na UI: **seletor de igreja** (dropdown). Todas as chamadas à API levam o contexto da igreja escolhida, por exemplo:
  - header `X-Igreja-Id: <ObjectId>` ou `X-Igreja-Slug: inc-sp`, **ou**
  - query `?igreja=inc-sp` em rotas internas.

Sem contexto de igreja, o admin global não lista dados “misturados” — evita vazamento entre tenants.

### Líder e voluntário

- Sempre têm `igrejaId` fixo no token/sessão.
- **Não** escolhem outra igreja; APIs ignoram tentativa de mudar tenant.

## 4. Autenticação (sessão atual em memória)

Hoje o token guarda `role`, `ministerioIds`, etc. Será necessário incluir:

- `igrejaId` (ObjectId ou null só para admin global)
- opcional: `igrejaSlug` para exibição

No login:

- Admin global → `igrejaId: null`; após login, o front define “igreja ativa” e envia em cada request.
- Líder/voluntário → `igrejaId` obrigatório, derivado do `User` no banco.

## 5. Rotas públicas (links sem login)

Hoje: `?escala=`, `?ministerio=`, check-in, formulários.

Opções (recomendado combinar slug + ids internos):

- `?igreja=inc-sp&escala=...`  
- ou path: `/i/inc-sp?escala=...` (exige ajuste no servidor estático)

O servidor, ao resolver `escalaId` / `eventoId`, deve validar que o documento pertence à **igreja** indicada no link (ou inferida por um único tenant legado durante migração).

## 6. Migração dos dados atuais

1. Criar documento **Celeiro São Paulo** (`slug: celeiro-sp`).
2. Criar documento **Inc São Paulo** (`slug: inc-sp`) — listas vazias.
3. Script único de migração: para cada coleção com `igrejaId` novo, setar `igrejaId = id do Celeiro` em todos os documentos que ainda não têm.
4. Ajustar índices: trocar `unique: true` em `Voluntario.email` por índice composto `{ email: 1, igrejaId: 1 }` (e planejar deduplicação se necessário).
5. Rodar `npm run update-db` (ou script de sync de índices) após deploy.

### Planilha Google Sheets / CSV (`VOLUNTARIOS_CSV_PATH`, `CSV_URL`, check-ins CSV)

A importação legada é **sempre gravada no tenant Celeiro** (`celeiro-sp`), independente do seletor de igreja no admin global. Assim a lista oficial da plataforma não “vaza” para a Inc por engano.

Se já existirem voluntários `fonte: 'planilha'` com `igrejaId` errado:

```bash
cd server && npm run fix-planilha-celeiro
# simular: node scripts/fix-planilha-voluntarios-celeiro.js --dry-run
```

O script `migrate-multi-igreja.js` também corrige esses registros ao ser executado de novo.

## 7. Fases de implementação sugeridas

| Fase | Entrega |
|------|---------|
| **1** | Model `Igreja`, script de seed/migração, `igrejaId` nas coleções “folha”, backfill Celeiro |
| **2** | JWT + `requireAuth`: `req.igrejaId` efetivo; filtro em todas as queries admin/líder |
| **3** | Front: seletor de igreja para admin global; persistir escolha (localStorage) |
| **4** | URLs públicas com `igreja`/`slug`; validação cruzada id ↔ tenant |
| **5** | Tela admin para criar/editar igrejas (opcional: só master) |

## 8. Nomenclatura

- **Celeiro São Paulo** → tenant legado; todo dado atual aponta para ele após migração.
- **Inc São Paulo** → novo tenant; ministérios e usuários criados **só** nesse `igrejaId`.

---

O arquivo `server/models/Igreja.js` é o primeiro passo de código; o restante da API e do front deve seguir este documento incrementalmente para não quebrar produção num único PR gigante.
