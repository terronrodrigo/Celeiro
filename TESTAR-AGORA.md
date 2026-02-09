# Testar o dashboard (Node já instalado)

## Passo 1 – Abrir o Terminal

- No Mac: **Cmd + Espaço**, digite **Terminal** e pressione Enter.

---

## Passo 2 – Instalar dependências e subir o servidor

Cole este comando no Terminal e pressione **Enter**:

```bash
cd /Users/rodrigoterron/dashboard/server && npm install && npm start
```

Espere aparecer algo como:

```
API Celeiro rodando em http://localhost:3001
```

**Deixe essa janela do Terminal aberta** (não feche).

---

## Passo 3 – Abrir no navegador

Abra o **Chrome**, **Safari** ou outro navegador e acesse:

**http://localhost:3001**

O dashboard deve carregar. Se a planilha estiver publicada na web, os dados aparecem; senão, pode aparecer mensagem de erro ao carregar a planilha (você ainda pode testar a tela).

---

## Resumo

1. Terminal → `cd /Users/rodrigoterron/dashboard/server && npm install && npm start`
2. Deixar o Terminal aberto
3. Navegador → **http://localhost:3001**

Para **parar** o servidor: no Terminal, pressione **Ctrl+C**.
