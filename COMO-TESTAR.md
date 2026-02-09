# Como testar o dashboard

## Pré-requisito

- **Node.js** instalado (versão 18+). Se não tiver: [nodejs.org](https://nodejs.org).

---

## 1. Publicar a planilha (para os dados aparecerem)

1. Abra a planilha:  
   [Inscrição Voluntários - Celeiro São Paulo](https://docs.google.com/spreadsheets/d/1uTgaI8Ct_rPr1KwyDOPCH5SLqdzv0Bwxog0B9k-PbPo/edit?pli=1&gid=1582636562)
2. Menu **Arquivo** → **Compartilhar** → **Publicar na Web**
3. Em **Links**, selecione a aba das respostas (ex.: "Respostas ao formulário 1" ou a que tiver os dados)
4. Clique em **Publicar** e confirme.

Sem isso o servidor não consegue ler os dados e o dashboard fica em branco ou com erro.

---

## 2. Subir o servidor

No terminal:

```bash
cd dashboard/server
cp .env.example .env
npm install
npm start
```

Você deve ver algo como:

```
API Celeiro rodando em http://localhost:3001
```

Deixe esse terminal aberto.

---

## 3. Abrir o dashboard

No navegador, acesse:

**http://localhost:3001**

O mesmo servidor serve a API e a página do dashboard.

- Se os dados da planilha aparecerem (números, gráficos, tabela), a **leitura da planilha** está ok.
- Se aparecer “Erro” ou “Verifique se o servidor está rodando”, confira:
  - se o servidor está rodando no terminal;
  - se a planilha foi publicada na web (passo 1).

---

## 4. Testar o envio de email (opcional)

Para testar o **envio via Resend**:

1. Crie uma conta em [resend.com](https://resend.com) (tem plano gratuito).
2. Em **API Keys**, crie uma chave e copie (ex.: `re_xxxx...`).
3. Abra o arquivo **`dashboard/server/.env`** e coloque:

   ```env
   RESEND_API_KEY=re_sua_chave_aqui
   ```

   Pode deixar `RESEND_FROM_EMAIL` em branco para usar o email de teste do Resend.

4. Reinicie o servidor (Ctrl+C no terminal e `npm start` de novo).
5. No dashboard: selecione um ou mais voluntários (checkbox), clique em **Enviar email (N)**.
6. Preencha **Assunto** e **Mensagem** (pode usar `[nome]` para personalizar) e clique em **Enviar**.

Se aparecer “Enviados: 1” (ou o número de destinatários), o envio está funcionando. Os emails de teste do Resend costumam chegar no mesmo endereço da conta (verifique a documentação do Resend).

---

## Resumo rápido

| O que testar        | O que fazer |
|---------------------|------------|
| Ver dados e gráficos| Publicar planilha → `npm start` no `server` → abrir http://localhost:3001 |
| Enviar email        | Adicionar `RESEND_API_KEY` no `.env` → reiniciar servidor → selecionar emails e usar “Enviar email” |
