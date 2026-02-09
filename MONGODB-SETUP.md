# Configurar MongoDB Atlas

Para usar o novo sistema de autenticação com gerenciamento de usuários, você precisa de uma instância MongoDB.

## Opção 1: MongoDB Atlas (Recomendado - Gratuito na Nuvem)

### Passo 1: Criar conta no MongoDB Atlas
1. Acesse https://www.mongodb.com/cloud/atlas/register
2. Crie uma conta gratuita clicando em "Sign up with Email"
3. Complete o registro

### Passo 2: Criar um Cluster
1. No dashboard, clique em "Build a Database"
2. Escolha o plano **"Free"** (M0 Sandbox)
3. Escolha sua região (ex: "us-east-1")
4. Clique em "Create Cluster"
5. Aguarde alguns minutos até o cluster estar pronto

### Passo 3: Configurar Acesso
1. Na aba "Security", clique em "Database Access"
2. Clique em "Add New Database User"
3. Crie um usuário:
   - Username: `admin`
   - Password: escolha uma senha forte
   - Role: `Atlas Admin`
4. Clique em "Add User"

### Passo 4: Configurar IP Whitelist
1. Na aba "Security", clique em "Network Access"
2. Clique em "Add IP Address"
3. Selecione "Allow Access from Anywhere" (ou adicione seu IP)
4. Clique em "Confirm"

### Passo 5: Obter String de Conexão
1. Na aba "Deployment", clique no seu cluster
2. Clique em "Connect"
3. Escolha "Drivers"
4. Selecione "Node.js" e versão "4.0 or later"
5. **Copie a connection string** que aparece (formato: `mongodb+srv://...`)

### Passo 6: Configurar arquivo `.env`
1. Abra `/Users/rodrigoterron/dashboard/server/.env`
2. Encontre a linha com `MONGODB_URI`
3. Substitua `mongodb://localhost:27017/celeiro-dashboard` pela string de conexão que você copiou
4. **Importante**: Substitua `<username>` e `<password>` pelos valores que você criou
5. **Importante**: Substitua `<database>` por `celeiro-dashboard` (ou outro nome que prefira)

Exemplo final:
```
MONGODB_URI=mongodb+srv://admin:sua_senha_aqui@cluster0.xxxxx.mongodb.net/celeiro-dashboard?retryWrites=true&w=majority
```

### Passo 7: Reiniciar servidor
```bash
cd /Users/rodrigoterron/dashboard/server
npm start
```

Você deve ver a mensagem:
```
✓ Conectado ao MongoDB
```

---

## Opção 2: MongoDB Local (com Docker)

Se preferir rodar MongoDB localmente:

```bash
# Instalar Docker (se não tiver): https://www.docker.com/products/docker-desktop
# Depois rodar:
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

Seu `.env` já está configurado para:
```
MONGODB_URI=mongodb://localhost:27017/celeiro-dashboard
```

---

## Opção 3: MongoDB Local (Instalação Manual)

Se preferir instalar MongoDB diretamente no seu Mac:

```bash
# Via Homebrew
brew tap mongodb/brew
brew install mongodb-community

# Iniciar o serviço
brew services start mongodb-community

# Verificar se está rodando
pgrep mongod
```

---

## Testando a Configuração

Após configurar, teste o novo endpoint:

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@example.com",
    "nome": "Teste",
    "senha": "senha123"
  }'
```

Se funcionou, vai retornar um token JWT!

---

## Próximas Etapas

Após configurar MongoDB, você pode:
1. Registrar novos usuários via `/api/auth/register`
2. Fazer login com `/api/auth/login-email`
3. Trocar senha com `/api/auth/change-password`
4. **Em breve**: Integrar autenticação com Google OAuth
