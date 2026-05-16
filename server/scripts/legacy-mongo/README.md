# Scripts legados (MongoDB)

Scripts de migração e manutenção usados antes da produção em **PostgreSQL**.

**Produção (Railway):** use `DB_PROVIDER=postgres` e:

- `npm run seed-ministerios-celeiro`
- `npm run import-lideres-csv`
- `npm run import-users-mongo-to-pg` (quando Atlas voltar)

Os demais scripts nesta pasta raiz (`sync-mongo.js`, `update-db.js`, etc.) são apenas para ambientes com Mongo ativo.
