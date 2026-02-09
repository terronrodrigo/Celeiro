# Localhost não abre – o que verificar

## 1. O servidor precisa estar rodando

O dashboard **não** abre só abrindo o arquivo `index.html`. É preciso **subir o servidor** primeiro.

### Opção A – Duplo clique (Mac)

1. No Finder, vá até a pasta **`dashboard`** (onde está este arquivo).
2. Dê **duplo clique** em **`INICIAR-SERVIDOR.command`**.
3. Se aparecer que “não pode ser aberto porque não é de um desenvolvedor identificado”: clique com o botão direito → **Abrir** → **Abrir** de novo.
4. Deixe a janela do Terminal **aberta** (não feche).
5. No navegador, acesse: **http://localhost:3001**

### Opção B – Pelo Terminal

1. Abra o **Terminal** (Spotlight: `Terminal`).
2. Cole e execute (Enter):

```bash
cd /Users/rodrigoterron/dashboard/server && npm install && npm start
```

3. Espere aparecer: `API Celeiro rodando em http://localhost:3001`
4. Deixe essa janela **aberta**.
5. No navegador, abra: **http://localhost:3001**

---

## 2. URL correta

Use exatamente:

**http://localhost:3001**

- Não use só `localhost` (falta a porta).
- Não use `https` (é `http`).
- A porta é **3001**, não 3000.

---

## 3. Node.js instalado

Se ao rodar o script ou o comando aparecer **"command not found: node"** ou **"npm não encontrado"**:

1. Instale o Node.js: https://nodejs.org (versão LTS).
2. Feche e abra o Terminal de novo.
3. Tente iniciar o servidor outra vez.

---

## 4. Resumo

| Passo | O que fazer |
|-------|-------------|
| 1 | Rodar o servidor (duplo clique em `INICIAR-SERVIDOR.command` ou comando no Terminal). |
| 2 | Deixar a janela do Terminal aberta. |
| 3 | Abrir no navegador: **http://localhost:3001** |

Se ainda não abrir, diga qual mensagem aparece (no Terminal ou no navegador) para eu te orientar no próximo passo.
