# Scripts legados (MongoDB)

Scripts de migração e manutenção usados **antes** da produção em PostgreSQL exclusivo.

**Produção (Railway):** use `DB_PROVIDER=postgres` e os scripts ativos em `server/scripts/`:

- `npm run seed-ministerios-celeiro`
- `npm run import-lideres-csv`
- `npm run import-users-mongo-to-pg` (requer MONGODB_URI temporário)
- `npm run purge-checkin-orfaos`

## Scripts nesta pasta (MongoDB legado)

| Script | Uso |
|--------|-----|
| `sync-mongo.js` | Sincronizar CSV → Mongo |
| `update-db.js` | Atualizar schema/dados Mongo |
| `migrate-multi-igreja.js` | Seed multi-igreja no Mongo |
| `fix-planilha-voluntarios-celeiro.js` | Import planilha Celeiro |
| `fix-datacheckin.js` | Corrigir dataCheckin (bug antigo) |
| `merge-eventos-checkin.js` | Mesclar eventos duplicados |
| `update-checkin-kids.js` | Atualizar check-ins kids |
| `copy-to-prod.js` | Copiar dados entre clusters Mongo |
| `create-admin.js` | Criar admin no Mongo |
| `set-user-password.js` | Alterar senha no Mongo |
| `delete-users.js` | Remover usuários no Mongo |
| `create-voluntario-test.js` | Seed voluntário teste |
| `criar-igreja-clone-ministerios.js` | Clonar igreja + ministérios |
| `list-escalas.js` | Listar escalas (debug) |
| `escalas-por-ministerio.js` | Escalas por ministério (debug) |
| `checkins-hoje-por-ministerio.js` | Check-ins do dia (debug) |
| `send-cadastro-email.mjs` | Email cadastro incompleto (Mongo) |

Executar a partir de `server/`:

```bash
node scripts/legacy-mongo/sync-mongo.js
```
