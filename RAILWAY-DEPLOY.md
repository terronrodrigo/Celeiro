# Primeiro deploy no Railway – passo a passo

Use este guia para fazer um **teste de deploy** do Dashboard Celeiro no Railway.

---

## Antes de começar

1. **Código no GitHub**  
   O repositório [github.com/terronrodrigo/Celeiro](https://github.com/terronrodrigo/Celeiro) deve ter o código atualizado (já feito).

2. **MongoDB Atlas (grátis)**  
   O app precisa de um banco MongoDB. Se ainda não tiver:
   - Acesse [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) e crie uma conta.
   - Crie um cluster **M0 (FREE)**.
   - **Database Access** → Add User → crie usuário e senha (guarde a senha).
   - **Network Access** → Add IP Address → **Allow Access from Anywhere** (`0.0.0.0/0`).
   - **Database** → **Connect** → **Drivers** → copie a connection string.  
   Exemplo:  
   `mongodb+srv://SEU_USUARIO:SUA_SENHA@cluster0.xxxxx.mongodb.net/celeiro-dashboard?retryWrites=true&w=majority`  
   Troque `SEU_USUARIO` e `SUA_SENHA` pelos dados do usuário que você criou.

---

## Deploy no Railway

### 1. Novo projeto a partir do GitHub

1. Acesse [railway.app](https://railway.app) e faça login (pode ser com GitHub).
2. Clique em **New Project**.
3. Escolha **Deploy from GitHub repo**.
4. Se for a primeira vez, autorize o Railway a acessar sua conta GitHub.
5. Selecione o repositório **terronrodrigo/Celeiro**.
6. O Railway vai criar o projeto e começar um build. Ele detecta o **Dockerfile** na raiz e usa ele automaticamente.

### 2. Variáveis de ambiente

O app precisa de algumas variáveis para funcionar:

1. No projeto, clique no **serviço** (o quadrado que representa o deploy).
2. Vá na aba **Variables**.
3. Clique em **+ New Variable** ou **Add Variable** e adicione:

| Nome           | Valor (exemplo) |
|----------------|------------------|
| `MONGODB_URI`  | A connection string do MongoDB Atlas (a URL completa que você copiou). |
| `ADMIN_USER`   | `admin` (ou o login que quiser para acessar o dashboard). |
| `ADMIN_PASS`   | Uma senha forte (ex.: `MinhaS3nhaS3gura!`). |

**Importante:**  
- A `MONGODB_URI` deve estar entre aspas se tiver caracteres especiais na senha. No Railway você cola direto o valor.  
- Não use a senha real do MongoDB no `ADMIN_PASS`; o `ADMIN_PASS` é só para login na aplicação.

4. Salve. O Railway costuma fazer um **redeploy** automático quando você altera variáveis.

### 3. Gerar URL pública

1. Ainda no serviço, vá em **Settings** (ou na aba **Settings**).
2. Na parte de **Networking** ou **Public Networking**, clique em **Generate Domain** (ou **Add Domain**).
3. O Railway vai criar uma URL tipo:  
   `https://celeiro-production-xxxx.up.railway.app`  
   (o nome pode variar.)

### 4. Testar

1. Espere o **Deploy** terminar (status **Success** / verde).
2. Clique na URL gerada ou copie e abra no navegador.
3. Você deve ver a tela de **login** do dashboard.
4. Faça login com o **ADMIN_USER** e **ADMIN_PASS** que você configurou.

Se aparecer a tela de login e você conseguir entrar, o **primeiro deploy de teste** está ok.

---

## Se algo der errado

- **Build falhou**  
  Veja os **logs** do build no Railway (aba **Deployments** → clique no deploy → **View Logs**). Erro comum: falta de variável (por exemplo `MONGODB_URI`).

- **App abre mas dá erro ao logar**  
  Confirme que `MONGODB_URI` está correta (usuário, senha, nome do cluster e do database). No Atlas, confira se o IP está liberado (`0.0.0.0/0`).

- **Página em branco ou “Cannot GET /”**  
  O servidor pode ainda estar subindo. Espere 1–2 minutos e atualize. Se continuar, confira os logs do **serviço** (runtime), não só do build.

- **Porta**  
  O Railway define a variável `PORT` automaticamente. O app já usa `process.env.PORT`, então não é preciso configurar nada extra.

---

## Próximos passos (opcional)

- **Email (Resend):** se quiser enviar e-mails pelo dashboard, adicione no Railway as variáveis `RESEND_API_KEY` e `RESEND_FROM_EMAIL` (veja o `DEPLOY.md`).
- **Fotos:** em ambiente Railway sem volume, as fotos de perfil podem ser perdidas ao reiniciar o app. Para persistência, no futuro dá para usar um storage externo (ex.: S3).

Quando o primeiro deploy estiver funcionando, você pode seguir o restante do `DEPLOY.md` para ajustes de produção (emails, domínio próprio, etc.).
