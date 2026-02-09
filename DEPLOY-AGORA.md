# Deploy agora – passos rápidos

## 1. Código no GitHub

Se o projeto ainda não estiver no GitHub:

```bash
cd /Users/rodrigoterron/dashboard
git init
git add .
git commit -m "Deploy: dashboard Celeiro"
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin main
```

(Substitua `SEU_USUARIO` e `SEU_REPO` pelo seu repositório.)

---

## 2. MongoDB Atlas (se ainda não tiver)

1. [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) → crie conta → cluster **M0 (FREE)**.
2. **Database Access** → Add User (usuário + senha).
3. **Network Access** → Add IP → `0.0.0.0/0`.
4. **Connect** → Drivers → copie a connection string e troque `<password>` pela senha do usuário.

Exemplo:  
`mongodb+srv://user:senha@cluster0.xxxxx.mongodb.net/celeiro-dashboard?retryWrites=true&w=majority`

---

## 3. Deploy no Railway (recomendado)

1. [railway.app](https://railway.app) → login (ex.: com GitHub).
2. **New Project** → **Deploy from GitHub repo** → selecione o repositório do dashboard.
3. O Railway usa o **Dockerfile** da raiz automaticamente.
4. No serviço → **Variables** → adicione:

   | Variável       | Valor |
   |----------------|--------|
   | `MONGODB_URI`  | A connection string do Atlas (com usuário e senha). |
   | `ADMIN_USER`   | Ex.: `admin` (login do dashboard). |
   | `ADMIN_PASS`   | Senha forte para login no dashboard. |
   | `SETUP_SECRET` | (Opcional) Código para criar primeiro admin pela tela `?setup=1`. |

5. **Settings** → **Networking** → **Generate Domain**.
6. Acesse a URL gerada e faça login com `ADMIN_USER` e `ADMIN_PASS`.

---

## 4. Deploy no Render (alternativa)

1. [render.com](https://render.com) → **New** → **Web Service**.
2. Conecte o repositório do GitHub.
3. **Environment:** Node.  
   **Build Command:** `cd server && npm install`  
   **Start Command:** `cd server && node server.js`
4. **Environment** (variáveis): `MONGODB_URI`, `ADMIN_USER`, `ADMIN_PASS` (e outras se precisar).
5. **Create Web Service**. Use a URL gerada (ex.: `https://seu-app.onrender.com`).

No free tier o serviço “dorme” após ~15 min sem uso; o primeiro acesso pode demorar ~30 s.

---

## 5. Primeiro acesso

- **Com ADMIN_USER / ADMIN_PASS:** basta acessar a URL e fazer login.
- **Sem admin por variável:** defina `SETUP_SECRET` no painel e acesse `https://sua-url/?setup=1` para criar o primeiro admin (email, nome, senha).

Detalhes: [DEPLOY.md](./DEPLOY.md) e [RAILWAY-DEPLOY.md](./RAILWAY-DEPLOY.md).
