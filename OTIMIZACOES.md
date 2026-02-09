# Plano de Otimizações - Dashboard Celeiro

## 📊 Análise da Plataforma

### Estrutura Atual
- **server.js**: 617 linhas (backend Express + SQLite)
- **app.js**: 1075 linhas (frontend vanilla JS)
- **styles.css**: 829 linhas
- **Dependências**: 20+ pacotes npm

### Problemas Identificados

#### Backend
1. **SQLite ainda em uso** - melhor migrar tudo para MongoDB
2. **Sem cache** - cada requisição busca data da planilha Google ou do banco
3. **Sem compressão** - respostas JSON não comprimidas
4. **Sem paginação** - endpoint `/api/voluntarios` retorna todos os registros
5. **Sem validação de entrada** - inputs não validados antes de salvar
6. **Múltiplas conversões de data** - função `parseDatePtBr` chamada múltiplas vezes
7. **N+1 queries prováveis** - em operações de envio de email

#### Frontend
1. **app.js muito grande** - 1075 linhas, pode ser modularizado
2. **Sem lazy loading** - carrega dados no onload, não sob demanda
3. **Sem debounce** - filtros e busca não têm debounce
4. **Sem service worker** - sem cache offline
5. **Sem minificação** - usar `terser` para produção
6. **Gráficos recalculados** - Chart.js recalcula a cada filtro

#### Infra/DevOps
1. **4 arquivos de docs duplicados** - COMO-TESTAR.md, TESTAR-AGORA.md, VERIFICAR.md, VSCODE-TERMINAL.md
2. **Sem .env validação** - variáveis obrigatórias não são checadas no startup
3. **Sem health check** - sem endpoint `/api/health`
4. **Sem rate limiting** - sem proteção contra brute force

---

## ✅ Plano de Ação

### Fase 1: Estrutura de Dados (MongoDB)
- [x] Criar modelo `Voluntario.js` com Mongoose
- [x] Criar modelo `Checkin.js` com Mongoose
- [ ] Migrar função `syncVoluntariosFromText` para salvar em MongoDB
- [ ] Criar indices para performance

### Fase 2: Otimizações Backend
- [ ] Remover dependência de `better-sqlite3`
- [ ] Adicionar cache com Redis ou memória (TTL configurável)
- [ ] Implementar paginação no `/api/voluntarios`
- [ ] Validar inputs com bibliotecas apropriadas
- [ ] Adicionar endpoint `/api/health`
- [ ] Adicionar compression middleware (gzip)
- [ ] Rate limiting com express-rate-limit

### Fase 3: Otimizações Frontend
- [ ] Modularizar `app.js` em funções separadas
- [ ] Adicionar debounce em filtros e busca
- [ ] Lazy loading de dados
- [ ] Service Worker para cache offline
- [ ] Minificar CSS/JS para produção

### Fase 4: Documentação
- [ ] Consolidar em um único README.md
- [ ] Remover COMO-TESTAR.md, TESTAR-AGORA.md, VERIFICAR.md, VSCODE-TERMINAL.md
- [ ] Criar SETUP.md com instruções MongoDB

### Fase 5: Testes e Deploy
- [ ] Testar todos os endpoints
- [ ] Verificar performance de queries
- [ ] Documentar variáveis de ambiente
- [ ] Criar script de seed de dados

---

## 🚀 Prioridades Imediatas

1. **Criar modelos Mongoose** (voluntarios e checkins)
2. **Consolidar documentação** (manter apenas README.md)
3. **Adicionar cache** (melhorar tempo de resposta)
4. **Adicionar validação** (segurança)
5. **Testar endpoints** (qualidade)

---

## 📈 Métricas de Sucesso

- Tempo de resposta `/api/voluntarios` < 200ms (com cache)
- A cada 10 requisições, 8 servidas do cache
- Tamanho do app.js reduzido em 20% com minificação
- 0 erros em testes de carga
- 100% dos endpoints documentados
