# Deploy do Dashboard Celeiro em nuvem (baixo custo)

Este guia ajuda a colocar a aplicação no ar em uma cloud de baixo custo.

## Desenvolvimento local (antes do deploy)

O frontend usa a API na **mesma origem**. Rode o servidor e abra o app no mesmo endereço:

```bash
cd server && npm start
```

Depois acesse **http://localhost:3001** no navegador (não abra `index.html` por file://).

## Opções recomendadas

| Provedor        | Custo estimado        | Prós                          | Contras                    |
|-----------------|------------------------|-------------------------------|----------------------------|
| **Railway**     | ~US$ 5/mês (ou trial)  | Simples, MongoDB possível     | Trial limitado             |
| **Render**      | Free tier ou ~US$ 7/mês| Free tier generoso            | Free tier “dorme” após inatividade |
| **Fly.io**      | Free tier              | Containers, boa documentação  | Config um pouco mais técnica |
| **MongoDB Atlas**| Free tier M0           | Banco gerenciado grátis       | Usado com qualquer um acima |

**Recomendação:** **MongoDB Atlas (free)** + **Railway** ou **Render** para a aplicação. Assim você paga só pelo app (ou usa free tier) e o banco fica grátis.

---

## 1. Preparar o banco: MongoDB Atlas (grátis)

1. Acesse [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) e crie uma conta.
2. Crie um cluster **M0 (FREE)**.
3. Em **Database Access** → Add User: crie um usuário com senha (guarde a senha).
4. Em **Network Access** → Add IP: use `0.0.0.0/0` (permite acesso de qualquer IP; em produção você pode restringir depois).
5. Em **Database** → Connect → **Drivers**: copie a connection string. Ela será algo como:
   ```text
   mongodb+srv://USUARIO:SENHA@cluster0.xxxxx.mongodb.net/celeiro-dashboard?retryWrites=true&w=majority
   ```
6. Substitua `USUARIO` e `SENHA` pelos seus. Essa URL será a variável **MONGODB_URI** no deploy.

---

## 2. Deploy na Railway

[Railway](https://railway.app) é uma das opções mais simples para subir um app Node.

### Passos

1. Crie uma conta em [railway.app](https://railway.app) (pode usar GitHub).
2. **New Project** → **Deploy from GitHub repo** (conecte o repositório do dashboard).
3. Se o repositório tiver **Dockerfile na raiz**, o Railway detecta e faz o build pela Docker.
4. **Variables** no projeto: adicione as variáveis de ambiente (veja seção “Variáveis de ambiente”, abaixo).
5. Em **Settings** → **Networking** → **Generate Domain**: o Railway gera uma URL pública (ex.: `https://seu-app.up.railway.app`).

### Build sem Docker (alternativa)

Se não quiser usar Docker:

- **Root Directory:** deixe em branco ou a pasta raiz do repositório.
- **Build Command:** `cd server && npm install`
- **Start Command:** `cd server && node server.js`
- **Watch Paths:** `server/`

Nesse caso, a raiz do repositório precisa ter `index.html`, `app.js`, `styles.css` e a pasta `server/`, e o `server.js` deve servir os estáticos da pasta pai (como já faz hoje).

---

## 3. Deploy no Render

[Render](https://render.com) tem free tier para Web Services.

1. Crie conta em [render.com](https://render.com).
2. **New** → **Web Service**.
3. Conecte o repositório do GitHub.
4. **Environment:** Node.
5. **Build Command:** `cd server && npm install`
6. **Start Command:** `cd server && node server.js`
7. **Root Directory:** (vazio = raiz do repo).
8. Adicione as variáveis de ambiente em **Environment**.
9. **Create Web Service**. O Render gera uma URL como `https://seu-app.onrender.com`.

**Nota:** No free tier o serviço “dorme” após ~15 min sem acesso; o primeiro acesso pode demorar ~30 s.

---

## 4. Deploy com Docker (qualquer cloud)

Na raiz do projeto há um **Dockerfile**. Você pode usá-lo em qualquer plataforma que rode containers (Railway, Render, Fly.io, DigitalOcean, etc.):

```bash
# Build
docker build -t celeiro-dashboard .

# Rodar (passe MONGODB_URI e outras env)
docker run -p 3001:3001 -e MONGODB_URI="sua-uri" -e ADMIN_USER=admin -e ADMIN_PASS="sua-senha" celeiro-dashboard
```

Na cloud, configure as variáveis de ambiente no painel do serviço (não coloque senhas no Dockerfile).

---

## Variáveis de ambiente (produção)

Configure estas variáveis no painel da sua cloud (Railway, Render, etc.):

| Variável              | Obrigatório | Descrição |
|-----------------------|------------|-----------|
| **MONGODB_URI**       | Sim        | Connection string do MongoDB Atlas (ver passo 1). |
| **ADMIN_USER**        | Sim        | Login do admin. |
| **ADMIN_PASS**        | Sim        | Senha do admin (use senha forte). |
| **PORT**              | Não        | Geralmente a cloud define (ex.: 3001 ou 8080). |
| **RESEND_API_KEY**    | Se usar email | Chave da API Resend para envio de emails. |
| **RESEND_FROM_EMAIL** | Se usar email | Email de remetente verificado no Resend. |
| **AUTH_TOKEN_TTL_HOURS** | Não     | Tempo de vida do token em horas (ex.: 24). |

**Importante:** Não commite `.env` nem senhas no repositório. Use apenas as variáveis no painel da cloud.

---

## Checklist pós-deploy

- [ ] Acessar a URL do app (ex.: `https://seu-app.up.railway.app`).
- [ ] Fazer login com **ADMIN_USER** e **ADMIN_PASS**.
- [ ] Testar cadastro de voluntário (se usar).
- [ ] Se usar email: configurar **RESEND_API_KEY** e **RESEND_FROM_EMAIL** e testar envio.
- [ ] Upload de foto: em ambiente efêmero (ex.: Render/Railway sem volume), fotos podem ser perdidas ao reiniciar; para persistência use storage externo (ex.: S3) no futuro.

---

## Persistência de uploads (fotos)

Em ambientes como Railway e Render, o sistema de arquivos é efêmero: reinícios do app apagam arquivos em `uploads/`. Para produção com fotos persistentes você pode:

1. Usar um storage na nuvem (ex.: **AWS S3**, **Cloudflare R2**, **Railway Volumes**) e salvar a URL em `User.fotoUrl`.
2. Ou aceitar que as fotos são temporárias até implementar um desses storages.

O aplicativo já está preparado para rodar com a API na mesma origem (URL relativa), então funciona em qualquer um desses deploys.
