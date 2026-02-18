# Agente de IA via WhatsApp – Celeiro Dashboard

## Visão geral

Agente de IA que permite interagir com o Dashboard Celeiro através do WhatsApp, mantendo a mesma hierarquia de perfis e permissões da plataforma web.

---

## Perfis e permissões (mesma hierarquia)

| Perfil    | Acesso no WhatsApp |
|-----------|--------------------|
| **Admin** | Tudo: voluntários, check-ins, escalas, usuários, ministérios, envio de email, eventos |
| **Líder** | Check-ins do ministério, escalas do ministério, perfil, meus check-ins |
| **Voluntário** | Perfil, check-in do dia, meus check-ins, minhas escalas |

---

## Fluxos suportados

### Todos os perfis
- Login / autenticação por WhatsApp
- Ver perfil
- Trocar senha
- Check-in de presença (se houver evento do dia)
- Ver meus check-ins
- Ver minhas escalas/candidaturas

### Líder
- Ver check-ins do ministério (com filtros)
- Ver escalas do ministério

### Admin
- Resumo de voluntários (totais, filtros)
- Listar voluntários (busca, filtros)
- Enviar email para voluntários
- Eventos de check-in (listar, criar, editar)
- Check-ins (listar, filtros)
- Escalas (listar, criar, editar, candidaturas)
- Usuários (listar, criar, editar)
- Ministérios (listar, criar, editar)

---

## Arquitetura

```
[WhatsApp] <--> [Meta Cloud API] <--> [Webhook /api/whatsapp]
                                              |
                                              v
                                    [WhatsApp Agent]
                                    - Identificar usuário (telefone -> User)
                                    - Autenticação (login por email/código)
                                    - Interpretar intenção (LLM)
                                    - Executar ação (chamar API interna)
                                    - Formatar resposta para WhatsApp
                                              |
                                              v
                                    [API existente /api/*]
                                    (mesmos endpoints do dashboard web)
```

---

## Componentes

### 1. WhatsApp Cloud API (Meta)
- Recebe e envia mensagens
- Webhook para mensagens recebidas
- Requer conta Meta Business + app WhatsApp

### 2. Webhook (`POST /api/whatsapp/webhook`)
- Recebe eventos do WhatsApp (mensagens, status)
- Verifica assinatura
- Encaminha para o Agent

### 3. Agent (IA)
- **System prompt**: descreve ações disponíveis por role
- **User message**: mensagem do usuário
- **Output**: intenção estruturada (`{ action, params }`) ou resposta direta

### 4. Executor
- Traduz `action` em chamada à API (`authFetch` com token do usuário)
- Formata resposta (tabela, lista) para texto WhatsApp

### 5. Autenticação
- **Opção A**: Login por email + código enviado por WhatsApp
- **Opção B**: Vínculo manual no admin (associar telefone ao User)
- Sessão: `userId` + `role` por `whatsappId` (número normalizado)

---

## Integração BR DID (verificação do número)

Se usar números da [BR DID](https://brdid.com.br), o webhook deles pode automatizar o recebimento do código de verificação. Ver **[BRDID-CONFIG.md](./BRDID-CONFIG.md)** para o passo a passo.

---

## Setup

### Variáveis de ambiente

```env
# WhatsApp (Meta Cloud API)
WHATSAPP_TOKEN=           # Access token do app Meta
WHATSAPP_PHONE_NUMBER_ID= # Phone number ID
WHATSAPP_VERIFY_TOKEN=    # Token para verificação do webhook (você define, ex: celeiro-webhook)

# IA (uma das opções - usada para interpretar intenção)
OPENAI_API_KEY=           # Para GPT-4 (prioridade se definido)
GROK_API_KEY=             # Para Grok (já usado no projeto)
XAI_API_KEY=              # Alias de GROK_API_KEY

# Já existente
APP_URL=                  # URL pública (ex: https://seu-app.railway.app) para chamadas internas
```

### Meta Cloud API – Setup completo

Ver **[META-CLOUD-SETUP.md](./META-CLOUD-SETUP.md)** para o passo a passo detalhado.

---

## Formato das interações (exemplos)

### Voluntário
```
Usuário: Oi
Bot: Olá! Sou o assistente do Celeiro. Para continuar, digite seu email cadastrado.

Usuário: joao@email.com
Bot: Código 8472 enviado. Digite-o aqui para confirmar.

Usuário: 8472
Bot: Login feito! O que deseja?
• 1 - Meu perfil
• 2 - Check-in de hoje
• 3 - Meus check-ins
• 4 - Minhas escalas
```

### Líder
```
Usuário: Quem fez check-in hoje no meu ministério?
Bot: Check-ins de hoje - Welcome / Recepção:
1. Maria (maria@email.com) - 10:32
2. João (joao@email.com) - 10:45
Total: 2
```

### Admin
```
Usuário: Quantos voluntários temos?
Bot: Resumo:
• Total: 342 voluntários
• Por área: Welcome 45, Kids 38, ...
```

---

## Segurança

- Validar assinatura do webhook (Meta envia `X-Hub-Signature-256`)
- Rate limit por número de telefone
- Logs de auditoria das ações via WhatsApp
- Código de login expira em 10 minutos

---

## Implementação incremental

### Fase 1 (MVP)
- [ ] Webhook + verificação
- [ ] Modelo User com campo `whatsapp` (telefone normalizado)
- [ ] Login por email + código
- [ ] Agent com ações básicas: perfil, check-in do dia, meus check-ins
- [ ] Executor que chama API existente

### Fase 2
- [ ] Fluxos de líder (check-ins do ministério)
- [ ] Fluxos de admin (resumo, listar voluntários)

### Fase 3
- [ ] Envio de email via WhatsApp (admin)
- [ ] Escalas e candidaturas
- [ ] Eventos e usuários
- [ ] Lista de ações conversacional (menu por botões WhatsApp)
