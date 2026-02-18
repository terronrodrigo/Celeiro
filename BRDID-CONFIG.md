# Configuração BR DID + WhatsApp

Integração com a [BR DID](https://brdid.com.br) para automatizar a verificação do número no WhatsApp Business.

## O que a BR DID faz

A BR DID fornece o endpoint `whatsapp_configurar` que:

1. Associa um webhook ao seu número (DID) contratado
2. Quando o WhatsApp envia o código de verificação (por ligação/áudio), o BR DID intercepta
3. Envia um POST para sua URL com os dados da chamada e `url_audio` (link do áudio)

O Celeiro recebe esse POST, extrai o código (via Whisper/OpenAI se disponível) e o admin pode consultá-lo.

---

## Passo a passo

### 1. Ter um número BR DID

- Acesse [brdid.com.br](https://brdid.com.br)
- Contrate um DID (número virtual)
- Obtenha seu **TOKEN** da conta no painel

### 2. Configurar o webhook no BR DID

Chame a API da BR DID:

```http
POST https://brdid.com.br/br-did/api/public/whatsapp_configurar?TOKEN=SEU_TOKEN&numero=5511999999999&url_retorno=https://SEU-APP.com/api/brdid/whatsapp-verification
```

**Parâmetros (query):**

| Parâmetro   | Descrição |
|-------------|-----------|
| `TOKEN`     | Token da sua conta BR DID |
| `numero`    | Número completo (código país + DDD + número), ex: 5511999999999 |
| `url_retorno` | URL pública do seu app + `/api/brdid/whatsapp-verification` |

**Exemplo com curl:**

```bash
curl -X POST "https://brdid.com.br/br-did/api/public/whatsapp_configurar?TOKEN=seu_token&numero=5511999999999&url_retorno=https://seu-app.railway.app/api/brdid/whatsapp-verification"
```

### 3. Iniciar a verificação no WhatsApp Business

- Abra o **WhatsApp Business** no celular
- Adicione o número (DID contratado)
- Quando pedir o código, escolha **"Me ligue"** ou opção de áudio
- O BR DID captura a chamada e envia os dados para o webhook

### 4. Consultar o código no Celeiro

Com o app em produção e logado como admin:

```http
GET https://seu-app.com/api/brdid/whatsapp-verification/latest
Authorization: Bearer SEU_TOKEN_JWT
```

Resposta:

```json
{
  "codigo": "847291",
  "numero": "5511999999999",
  "recebidoEm": "2025-02-16T14:30:00.000Z",
  "url_audio": "https://..."
}
```

- Se `codigo` estiver preenchido: digite no WhatsApp Business
- Se não: abra `url_audio` para ouvir o código, ou configure `OPENAI_API_KEY` para transcrição automática

---

## Extração automática do código (opcional)

Com `OPENAI_API_KEY` no `.env`, o servidor usa o **Whisper** para transcrever o áudio e extrair o código. Sem isso, você precisará ouvir o áudio manualmente ou o BR DID pode enviar o código em outro campo (verificar payload real).

---

## Variáveis de ambiente

Nenhuma variável específica da BR DID é necessária no Celeiro. O webhook é público (sem autenticação) – o BR DID chama a URL que você configurou.

Para extração automática do código:

```env
OPENAI_API_KEY=sk-...   # Para Whisper transcrever o áudio
```

---

## Endpoints do Celeiro

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/brdid/whatsapp-verification` | Não | Webhook chamado pelo BR DID |
| GET | `/api/brdid/whatsapp-verification/latest` | Admin | Último código recebido |

---

## Fluxo visual

```
[Você] Configura webhook no BR DID (numero + url_retorno)
          ↓
[WhatsApp Business] "Adicionar número" → escolhe "Me ligue"
          ↓
[WhatsApp] Liga para o número
          ↓
[BR DID] Intercepta, grava áudio, POST → seu webhook
          ↓
[Celeiro] Recebe, extrai código (Whisper ou manual)
          ↓
[Admin] GET /api/brdid/whatsapp-verification/latest → vê o código
          ↓
[Você] Digita o código no WhatsApp Business
```
