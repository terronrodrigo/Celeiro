# Migração para app.celeirosp.com

Guia para mover a plataforma de voluntários de `voluntariosceleirosp.com` para **`https://app.celeirosp.com`**.

O site institucional pode continuar em **`https://celeirosp.com`** (outro hospedeiro). Só o app (dashboard, check-in, escalas, formulários) usa o subdomínio `app`.

---

## 1. DNS (registro do domínio celeirosp.com)

No painel onde você gerencia o DNS de `celeirosp.com` (Registro.br, Cloudflare, etc.):

| Tipo  | Nome | Valor |
|-------|------|--------|
| **CNAME** | `app` | `2t3bjm80.up.railway.app` |

Aguarde a propagação (minutos a algumas horas). O Railway só emite SSL quando o CNAME estiver correto.

**Opcional (manter links antigos):** mantenha também o domínio `voluntariosceleirosp.com` apontando para o **mesmo** serviço Railway. O app redireciona automaticamente para `app.celeirosp.com` (ver seção 4).

---

## 2. Railway — domínio customizado

1. [railway.app](https://railway.app) → projeto do Celeiro → serviço do dashboard.
2. **Settings** → **Networking** → **Custom Domain** → adicione `app.celeirosp.com`.
3. Copie o **CNAME** indicado e configure no DNS (passo 1). Neste projeto, o Railway pediu `2t3bjm80.up.railway.app`.
4. Aguarde status **Active** / certificado SSL verde.

Para migração gradual, adicione também `voluntariosceleirosp.com` (e `www` se existir) como domínios extras no mesmo serviço.

---

## 3. Variáveis no Railway

Em **Variables** do serviço, atualize ou confirme:

| Variável | Valor |
|----------|--------|
| **`APP_URL`** | `https://app.celeirosp.com` |
| **`CORS_ORIGINS`** | `https://app.celeirosp.com` |
| **`RESEND_FROM_EMAIL`** | `Celeiro São Paulo <voluntarios@celeirosp.com>` *(após verificar domínio no Resend)* |
| **`LEGACY_REDIRECT_HOSTS`** | `voluntariosceleirosp.com,www.voluntariosceleirosp.com` *(opcional; padrão no código)* |

Não inclua barra no final de `APP_URL`.

Faça **Redeploy** após salvar as variáveis.

---

## 4. Redirecionamento do domínio antigo

Com `LEGACY_REDIRECT_HOSTS` configurado (ou o padrão do código), requisições em `voluntariosceleirosp.com` recebem **301** para o mesmo caminho em `https://app.celeirosp.com`.

Exemplos:

- `https://voluntariosceleirosp.com/?checkin=...` → `https://app.celeirosp.com/?checkin=...`
- `https://voluntariosceleirosp.com/f/vU7Ezsc` → `https://app.celeirosp.com/f/vU7Ezsc`

Para desativar o redirect: defina `LEGACY_REDIRECT_HOSTS=` (vazio) no Railway.

---

## 5. Resend (e-mails)

1. [resend.com](https://resend.com) → **Domains** → adicione **`celeirosp.com`**.
2. Configure os registros DNS (SPF, DKIM) que o Resend indicar.
3. Após verificação, atualize **`RESEND_FROM_EMAIL`** no Railway (ex.: `voluntarios@celeirosp.com`).
4. Enquanto o domínio não estiver verificado, pode manter temporariamente o remetente antigo em `RESEND_FROM_EMAIL`.

---

## 6. WhatsApp / Meta (se usar o agente)

Atualize **`APP_URL`** no webhook e na documentação Meta para `https://app.celeirosp.com`. Ver [WHATSAPP-AGENT.md](./WHATSAPP-AGENT.md).

---

## 7. Checklist pós-migração

- [ ] Abrir `https://app.celeirosp.com` e fazer login.
- [ ] Testar link de check-in (`?checkin=...&igreja=celeiro-sp`).
- [ ] Testar link de escala (`?escala=...&igreja=celeiro-sp`).
- [ ] Testar cadastro público (`#cadastro` ou link curto `/f/...`).
- [ ] Testar “Esqueci a senha” (link no e-mail deve usar `app.celeirosp.com`).
- [ ] Abrir um link antigo em `voluntariosceleirosp.com` e confirmar redirect.
- [ ] Atualizar QR codes / materiais impressos com a nova URL (ou confiar no redirect).
- [ ] Hard refresh nos navegadores (`Cmd+Shift+R`).

---

## 8. celeirosp.com (site principal)

O app **não** precisa estar na raiz `celeirosp.com`. Recomendação:

- **`celeirosp.com`** → site institucional (WordPress, etc.).
- **`app.celeirosp.com`** → esta plataforma.

No site institucional, coloque botões “Área do voluntário” apontando para `https://app.celeirosp.com`.
