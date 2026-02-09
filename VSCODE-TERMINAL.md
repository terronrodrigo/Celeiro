# Por que não consigo rodar no terminal do VS Code / Cursor?

## Causa mais comum: o terminal não acha o Node

No VS Code/Cursor, o **terminal integrado** às vezes abre **sem carregar** seu arquivo de configuração do shell (`.zshrc` ou `.bash_profile`). Se você instalou o Node com **nvm** ou **Homebrew**, o `node` e o `npm` podem estar só nesse arquivo, e o terminal do editor **não os encontra**.

### O que fazer

**Opção 1 – Carregar o shell antes de rodar**

No terminal do VS Code, rode **antes** dos outros comandos:

```bash
source ~/.zshrc
```

(Se você usa Bash, use `source ~/.bash_profile`.)

Depois:

```bash
cd dashboard/server
npm start
```

**Opção 2 – Fechar e abrir de novo**

1. Feche o VS Code/Cursor **por completo** (sair do programa).
2. Abra de novo e abra a pasta do projeto.
3. Abra o terminal (Ctrl + \`) e rode:

```bash
cd dashboard/server
npm start
```

Assim o sistema pode pegar o Node que você instalou.

**Opção 3 – Usar o Terminal do Mac**

1. Abra o **Terminal** do Mac (Spotlight: Cmd+Espaço → "Terminal").
2. Rode:

```bash
cd /Users/rodrigoterron/dashboard/server
npm start
```

No Terminal do Mac o `.zshrc` costuma ser carregado, então o `node` e o `npm` costumam funcionar.

---

## Outras causas

### “npm: command not found” ou “node: command not found”

- O terminal não está encontrando Node/npm (veja acima).
- Ou o Node não está instalado: instale em https://nodejs.org e reinicie o editor.

### “Cannot find module” ao rodar `npm start`

Rode na pasta `dashboard/server`:

```bash
npm install
```

Depois:

```bash
npm start
```

### Pasta errada

O comando precisa ser rodado **dentro de** `dashboard/server`. Confira:

```bash
pwd
```

Deve terminar com algo como `.../dashboard/server`. Se não estiver, faça:

```bash
cd /Users/rodrigoterron/dashboard/server
npm start
```

### Porta 3001 em uso

Se aparecer algo como “port 3001 already in use”:

- Feche outra janela/terminal onde o servidor já esteja rodando, ou
- Mude a porta no arquivo `server/.env`, por exemplo: `PORT=3002`, e use no navegador: **http://localhost:3002**

---

## Resumo

| Problema | Solução |
|----------|--------|
| `node` ou `npm` não encontrado no terminal do VS Code | Rodar `source ~/.zshrc` antes, ou fechar/abrir o VS Code, ou usar o Terminal do Mac |
| Módulos faltando | Na pasta `dashboard/server`: `npm install` e depois `npm start` |
| Pasta errada | `cd /Users/rodrigoterron/dashboard/server` e depois `npm start` |
| Porta em uso | Usar outra porta em `server/.env` (ex.: `PORT=3002`) |

Depois que aparecer **“API Celeiro rodando em http://localhost:3001”**, abra no navegador: **http://localhost:3001**.
