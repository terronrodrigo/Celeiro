# Setup Meta WhatsApp Cloud API – Celeiro

Guia passo a passo **bem detalhado** para conectar o agente ao seu número de teste.

---

## O que você precisa

- ✅ Conta Meta Business criada  
- ✅ Número de teste do WhatsApp  
- ⬜ **Phone Number ID** e **Access Token** (obtidos abaixo)  
- ⬜ App rodando em URL pública (Railway, Render, ou ngrok para teste local)

---

## Como navegar no Meta for Developers

### Acessar o painel

1. Abra o navegador e vá em: **https://developers.facebook.com**
2. Faça login com sua conta Facebook/Meta.
3. No topo da página, clique em **"Meus aplicativos"** (ou "My Apps").
4. Na lista, clique no **nome do seu app** (o que você criou para o WhatsApp).

Você está agora no **App Dashboard** – painel principal do seu app.

---

### Onde ficam as coisas (menu lateral)

À **esquerda** da tela há um menu vertical. Procure por:

| Item do menu | O que é |
|--------------|---------|
| **Visão geral** / Overview | Página inicial do app |
| **WhatsApp** | Produto do WhatsApp – **é aqui que vamos trabalhar** |
| Outros (Login, Analytics...) | Ignore por enquanto |

Ao clicar em **WhatsApp**, o menu expande e aparecem subitens, por exemplo:

- **Introdução** / **Começar** / **API Setup**
- **Configuração** / **Configuration**
- **API Setup** (às vezes aparece em ambos)

---

## Passo 1: Obter Phone Number ID e Access Token

### 1.1 Ir até a tela certa

1. No menu lateral esquerdo, clique em **WhatsApp**.
2. Se aparecer um submenu, clique em **API Setup** (ou **Começar** / **Introdução**).
   - Às vezes o link é: **WhatsApp** → **Introdução** → e na página há uma aba ou seção **API Setup**.
3. A página exibe uma tela com:
   - **"From"** (ou "De") – mostra o número de teste
   - **"To"** (ou "Para") – campo para adicionar número para testes
   - **Phone number ID**
   - **Access token**

### 1.2 Copiar o Phone Number ID

1. Na seção **"From"**, procure o **Phone number ID**.
   - É um número longo (ex: `123456789012345`).
   - Pode estar logo abaixo do número de telefone de teste.
2. Clique para copiar ou selecione e copie (Ctrl+C / Cmd+C).
3. Guarde em um lugar seguro – você vai colocar no `.env` como `WHATSAPP_PHONE_NUMBER_ID`.

### 1.3 Gerar e copiar o Access Token

1. Procure **"Access token"** ou **"Token de acesso"** na mesma página.
2. Clique em **"Generate"** ou **"Generate token"** ou **"Temporary access token"**.
   - Às vezes há um botão de "gerar" ou um ícone de renovar ao lado.
3. Um token longo aparecerá (começa com `EAA...`).
4. Clique em **"Copy"** (Copiar) ou selecione e copie.
5. Guarde – você vai colocar no `.env` como `WHATSAPP_TOKEN`.

> **Importante:** O token temporário expira em 24h. Para produção, use um System User token (permanente).

---

## Passo 2: Configurar variáveis no servidor

No `.env` do servidor (ou nas variáveis do Railway/Render):

```env
WHATSAPP_TOKEN=EAAxxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_VERIFY_TOKEN=celeiro-webhook-secreto

# URL pública do app (obrigatório para o agente chamar a API)
APP_URL=https://seu-app.railway.app

# IA para interpretar mensagens (pelo menos um)
GROK_API_KEY=...   # ou OPENAI_API_KEY=...
```

**`WHATSAPP_VERIFY_TOKEN`:** escolha uma string secreta (ex: `celeiro-webhook-secreto`). A Meta vai enviá-la no GET de verificação; deve ser **exatamente igual** ao que você colocar no webhook.

---

## Passo 3: Configurar o webhook na Meta

### 3.1 Encontrar a tela de configuração do webhook

1. No menu lateral esquerdo, clique em **WhatsApp**.
2. Procure o item **Configuração** ou **Configuration** (em inglês).
   - Se o menu estiver em português: **WhatsApp** → **Configuração**
   - Se em inglês: **WhatsApp** → **Configuration**
3. Clique nesse item.

### 3.2 Localizar a seção Webhook

Na página de **Configuração** / **Configuration**, você verá seções como:

- Webhook
- Permissões
- Outras opções

1. Procure a seção **"Webhook"**.
2. Deve haver um botão: **"Configurar"**, **"Edit"**, **"Configure"** ou **"Manage"**.
3. Clique nesse botão.

### 3.3 Preencher os campos

Uma janela ou formulário abrirá. Preencha:

| Campo | Valor | Exemplo |
|-------|-------|---------|
| **Callback URL** | URL do seu app + `/api/whatsapp/webhook` | `https://seu-app.onrender.com/api/whatsapp/webhook` |
| **Verify token** | O mesmo que `WHATSAPP_VERIFY_TOKEN` no .env | `celeiro-webhook-secreto` |

Importante:

- Use **HTTPS** (não `http://`).
- Não coloque barra no final da URL (`/api/whatsapp/webhook` e não `/api/whatsapp/webhook/`).

### 3.4 Verificar e salvar

1. Clique em **"Verify and save"** ou **"Verificar e salvar"**.
2. A Meta faz uma requisição GET na sua URL com o `verify_token`. Se o servidor responder corretamente, a verificação passa.
3. Se der erro, confira:
   - App em deploy e acessível pela internet
   - `WHATSAPP_VERIFY_TOKEN` idêntico no .env e no formulário

### 3.5 Inscrever no campo "messages"

1. Ainda na página de webhook (ou volte em **Webhook** → **Manage**), procure **"Webhook fields"** ou **"Campos do webhook"**.
2. Marque a caixa **"messages"**.
3. Salve.

Sem isso, o webhook não recebe mensagens.

---

## Passo 4: Adicionar seu número como testador

Para que **seu** WhatsApp possa falar com o número de teste, você precisa ser testador do app.

### 4.1 Encontrar Roles / Testers

1. No menu lateral esquerdo, role para cima até o topo.
2. Procure **"Configurações do app"** ou **"App settings"** (às vezes um ícone de engrenagem).
   - Ou clique em **"Configurações"** / **"Settings"** na barra superior.
3. Dentro de Configurações, procure a seção **"Funções"** / **"Roles"** / **"Papéis"**.
4. Ou: no menu lateral, pode haver **"Roles"** ou **"App roles"** direto.

### 4.2 Adicionar testador

1. Na seção **Roles**, clique em **"Testadores"** / **"Testers"**.
2. Clique em **"Adicionar testadores"** ou **"Add testers"**.
3. Digite o **nome** ou **email** da sua conta Facebook (a que está logada).
4. Ou use o campo **"To"** na tela **WhatsApp** → **API Setup**: adicione seu número com DDI (ex: `5511999999999`) para que possa enviar e receber mensagens de teste.

---

## Passo 5: Testar localmente (opcional)

Se o app estiver em `localhost`, use **ngrok** para expor:

```bash
ngrok http 3001
```

Use a URL do ngrok (ex: `https://abc123.ngrok.io`) como base:

- **Callback URL:** `https://abc123.ngrok.io/api/whatsapp/webhook`
- **APP_URL:** `https://abc123.ngrok.io`

---

## Passo 6: Enviar mensagem de teste

### Pelo painel Meta

1. Vá em **WhatsApp** → **API Setup**.
2. Na seção **"To"**, adicione seu número com DDI (ex: `5511999999999`).
3. Use o campo de mensagem para enviar uma mensagem de teste *do* número de negócio *para* você (para ver se envia).

### Pelo seu WhatsApp (conversa com o bot)

1. No seu celular, abra o WhatsApp.
2. Inicie uma conversa com o **número de teste** (o que aparece em "From" no API Setup).
3. Envie **"Oi"**.
4. O webhook deve receber, o agente deve responder pedindo o email.

---

## Fluxo do agente

1. Usuário envia **"Oi"** → Bot pede o email.
2. Usuário envia o **email cadastrado** (deve existir na plataforma) → Bot envia código por WhatsApp e pede para digitar.
3. Usuário envia o **código** → Login e menu de opções.
4. A partir daí, o usuário pode usar comandos como: perfil, check-ins, escalas etc.

> **Importante:** O email informado deve ser de um usuário já cadastrado no dashboard (admin, líder ou voluntário).

---

## Resumo: onde está cada coisa no menu

```
developers.facebook.com
└── Meus aplicativos (topo)
    └── [Seu app]
        └── Menu lateral esquerdo:
            ├── Visão geral
            ├── WhatsApp  ← AQUI
            │   ├── API Setup     → Phone Number ID, Token, campo "To"
            │   └── Configuration → Webhook (Callback URL, Verify token)
            └── Configurações / Roles → Testers (adicionar seu número)
```

## Número de teste – quem pode falar

Com número de **teste** do Meta, apenas números cadastrados como testadores podem conversar com ele. Veja o Passo 4 acima.

---

## Dica: interface em outro idioma

Se o painel estiver em inglês, procure por:

- **My Apps** = Meus aplicativos  
- **API Setup** = Configuração da API  
- **Configuration** = Configuração  
- **Webhook** = Webhook (igual)  
- **Callback URL** = URL de retorno  
- **Verify token** = Token de verificação  
- **Testers** = Testadores  
- **Roles** = Funções / Papéis  

---

## Erros comuns

| Erro | Possível causa |
|------|----------------|
| Webhook não verifica | URL inacessível, `WHATSAPP_VERIFY_TOKEN` diferente, ou app não respondendo |
| "Assinatura inválida" | `WHATSAPP_TOKEN` incorreto ou expirado |
| Bot não responde | Verificar logs do servidor; conferir `APP_URL` e chave de IA |
| "Número não está no sistema de mensagens" | Número não é testador ou ainda não iniciou conversa com o número de teste |

---

## Checklist final

- [ ] `WHATSAPP_TOKEN` no .env  
- [ ] `WHATSAPP_PHONE_NUMBER_ID` no .env  
- [ ] `WHATSAPP_VERIFY_TOKEN` no .env (igual ao da Meta)  
- [ ] `APP_URL` no .env (URL pública com HTTPS)  
- [ ] `GROK_API_KEY` ou `OPENAI_API_KEY` para a IA  
- [ ] Webhook configurado na Meta com a URL correta  
- [ ] Campo "messages" marcado no webhook  
- [ ] Seu número adicionado como testador  
- [ ] App em deploy (ou ngrok) e reiniciado após alterar .env  
