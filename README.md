# Dashboard Voluntários – Celeiro São Paulo

Dashboard que resume as inscrições da planilha **Inscrição Voluntários - Celeiro São Paulo** e permite **selecionar emails e enviar via [Resend](https://resend.com)**.

## O que tem

- **Resumo**: total de inscrições, áreas de atuação e disponibilidade
- **Gráficos**: por área de atuação e por disponibilidade
- **Tabela**: lista de voluntários com busca e **checkboxes para selecionar emails**
- **Enviar email**: botão abre modal para escrever assunto e mensagem e enviar **só para os selecionados** via Resend (com personalização `[nome]`)
- **Autenticação simples**: login admin para acessar a plataforma
- **Check-in**: aba por ministério com filtro e lista de check-ins por culto

## Como rodar

### 1. Planilha Google

A planilha precisa estar **publicada na web** para o servidor conseguir ler:

1. Abra a planilha: [Inscrição Voluntários - Celeiro São Paulo](https://docs.google.com/spreadsheets/d/1uTgaI8Ct_rPr1KwyDOPCH5SLqdzv0Bwxog0B9k-PbPo/edit?pli=1&gid=1582636562)
2. **Arquivo** → **Compartilhar** → **Publicar na Web**
3. Em “Links”, escolha a aba correta (ex.: a que tem as respostas) e clique em **Publicar**
4. Opcional: no servidor, defina `GOOGLE_SHEETS_CSV_URL` no `.env` com a URL do CSV dessa planilha/aba, se for outra

### 2. Backend (API)

```bash
cd dashboard/server
cp .env.example .env
# Edite .env e coloque RESEND_API_KEY, ADMIN_USER e ADMIN_PASS
# (opcionais: RESEND_FROM_EMAIL, GOOGLE_SHEETS_CSV_URL, VOLUNTARIOS_CSV_PATH, CHECKIN_CSV_PATH, DB_PATH, AUTH_TOKEN_TTL_HOURS)
npm install
npm start
```

Para carregar do CSV no MongoDB:

```bash
cd dashboard/server
npm run migrate
```

A API sobe em `http://localhost:3001` e expõe:

- `GET /api/voluntarios` – lê a planilha e devolve voluntários + resumo
- `POST /api/send-email` – envia email via Resend (body: `{ to: string[], subject, html, voluntarios?: { [email]: nome } }`)

### 3. Resend (envio de email)

1. Crie uma conta em [resend.com](https://resend.com) e um **API Key**
2. No `.env` do servidor:

   ```env
   RESEND_API_KEY=re_xxxxxxxxxxxx
   RESEND_FROM_EMAIL=Celeiro São Paulo <noreply@seudominio.com>
   ```

   Se não definir `RESEND_FROM_EMAIL`, o Resend usa o endereço de teste deles (só para sua conta).

3. Para produção, use um **domínio verificado** no Resend em `RESEND_FROM_EMAIL`

### 4. Frontend (dashboard)

Abra o `index.html` do dashboard no navegador (por exemplo abrindo `dashboard/index.html` ou usando um servidor estático). O front chama a API em `http://localhost:3001`; se a API estiver em outra URL, altere `API_BASE` em `app.js`.

### 5. Login (admin)

Use o usuário e senha definidos no `.env` do servidor para acessar o dashboard.

### 6. Check-in

Configure `CHECKIN_CSV_PATH` apontando para o CSV do check-in.
O servidor importa os novos registros e salva no banco SQLite.

## Uso do envio de email

1. Na tabela, marque os voluntários que devem receber o email (ou use “Selecionar todos”).
2. Clique em **“Enviar email (N)”**.
3. No modal: preencha **Assunto** e **Mensagem** (pode usar HTML).
4. Use **`[nome]`** no texto para ser trocado pelo nome do voluntário em cada email.
5. Clique em **Enviar**. O backend chama o Resend e mostra quantos foram enviados e se houve falha.

## Estrutura

```
dashboard/
├── index.html       # Página do dashboard
├── app.js           # Lógica: buscar dados, gráficos, tabela, seleção, modal, envio
├── styles.css       # Estilos (inclui modal e estados de loading/erro)
├── README.md        # Este arquivo
└── server/
    ├── server.js    # Express: GET /api/voluntarios, POST /api/send-email
    ├── package.json
    ├── .env.example
    └── .env          # Suas chaves (não versionado)
```

## Variáveis de ambiente (servidor)

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `RESEND_API_KEY` | Sim (para enviar) | API Key do Resend |
| `RESEND_FROM_EMAIL` | Recomendado | Remetente (ex.: `Celeiro São Paulo <noreply@seudominio.com>`) |
| `GOOGLE_SHEETS_CSV_URL` | Não | URL do CSV da planilha; se não definir, usa a planilha padrão do Celeiro |
| `ADMIN_USER` | Sim | Usuário admin do dashboard |
| `ADMIN_PASS` | Sim | Senha do usuário admin |
| `AUTH_TOKEN_TTL_HOURS` | Não | Tempo de sessão (padrão: 24h) |
| `PORT` | Não | Porta do servidor (padrão: 3001) |
