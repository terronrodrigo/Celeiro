# Revisão de Performance - Dashboard Celeiro

## ✅ Implementado

### Frontend
- **Lazy loading por view** – Dados carregados apenas ao abrir cada tela (resumo, voluntários, check-in, escalas, etc.)
- **Escalas separadas** – "Criar escalas" carrega só a lista; "Escala" (candidatos) carrega por escala selecionada
- **Debounce em buscas** – Usuários (350ms), Check-in (300ms), Filtro candidatos (250ms) evitam requisições a cada tecla
- **Cache-busting** – `?v=1.0.3` em CSS/JS para evitar cache antigo após deploy

### Backend
- **Compressão gzip** – Respostas JSON compactadas
- **Cache em memória** – Voluntários e check-ins (TTL configurável)
- **Índices MongoDB** – Candidatura, Checkin, Escala, Voluntario com índices adequados
- **Lazy candidaturas** – `GET /api/escalas/:id/candidaturas` em vez de carregar todas

---

## 🔧 Recomendações

### Prioridade alta
1. **Paginação em voluntários** – Endpoint retorna todos; adicionar `?page=1&limit=50`
2. **Cache de lista de escalas** – Se usada em várias views, cachear por 1–2 min
3. **Evitar re-fetch desnecessário** – Ao voltar para uma view, reutilizar dados em cache se recentes (< 1 min)

### Prioridade média
4. **Otimizar agregations** – `candidaturas-all` e `:id/candidaturas` fazem múltiplas agregações; considerar materialização
5. **Lazy load de gráficos** – Chart.js só inicializar quando a view Resumo estiver visível
6. **Virtualização de tabelas** – Para listas grandes (> 100 linhas), renderizar só as linhas visíveis

### Prioridade baixa
7. **Service Worker** – Cache de assets estáticos offline
8. **Minificação** – Terser para `app.js` em produção
9. **Prefetch** – Carregar próxima view provável em background (ex.: ao abrir Resumo, prefetch Voluntários)

---

## 📊 Endpoints mais pesados

| Endpoint | Uso | Sugestão |
|----------|-----|----------|
| `GET /api/voluntarios` | Lista completa | Paginação + filtros server-side |
| `GET /api/checkins` | Check-ins com filtros | Índice composto (eventoId, data, ministério) |
| `GET /api/escalas` | Lista leve | Já otimizado |
| `GET /api/escalas/:id/candidaturas` | Por escala | Já otimizado (lazy) |

---

## 🏁 Quick wins já aplicados

- Debounce em inputs de busca
- Loading states explícitos (evita tela em branco)
- Separação Escalas vs Criar escalas (carregamento leve)
- Preservar seleção dos filtros ao atualizar opções
