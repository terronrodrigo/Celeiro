# Análise de melhorias - Celeiro São Paulo

Contexto: a plataforma está saindo de um papel restrito de "voluntários" para uma plataforma operacional mais ampla do Celeiro São Paulo, com pessoas, membros, check-in, escalas, formulários, comunicação e múltiplas igrejas/ministérios.

## Prioridade 0 - Migração de domínio e marca

- Concluir DNS de `app.celeirosp.com`: criar CNAME `app` apontando para `2t3bjm80.up.railway.app`.
- Aguardar Railway marcar o domínio como verificado e SSL ativo antes de fazer deploy com redirect 301.
- Manter `voluntariosceleirosp.com` e `www.voluntariosceleirosp.com` no mesmo serviço Railway durante a transição.
- Só ativar remetente `Celeiro São Paulo <voluntarios@celeirosp.com>` depois de verificar `celeirosp.com` no Resend.
- Revisar materiais externos: QR codes, links em bio, site institucional, WhatsApp, Meta/webhooks e documentos impressos.

## Prioridade 1 - Segurança e produção

- Rotacionar segredos de produção que hoje parecem antigos ou fracos, principalmente `ADMIN_PASS`, `SETUP_SECRET`, chaves de IA e chaves de e-mail.
- Desativar ou proteger melhor `/api/setup` em produção depois que a conta admin estiver criada.
- Atualizar dependências com vulnerabilidades conhecidas. O build atual reportou 6 vulnerabilidades no `npm audit`, incluindo aviso para migrar `multer` 1.x para 2.x.
- Mover permissões para um modelo mais explícito por capacidade: `pessoas.read`, `escalas.write`, `emails.send`, `settings.write`, etc.
- Adicionar auditoria para ações sensíveis: envio de e-mail em massa, aprovação de escala, alteração de usuário, exclusões e geração de convites.
- Revisar rate limits por rota pública: check-in, formulários, magic link, reset de senha, candidatura e webhooks.

## Prioridade 2 - Arquitetura backend

- Quebrar `server/server.js` em módulos por domínio. Hoje ele tem cerca de 7.500 linhas e mais de 100 rotas, o que aumenta risco a cada mudança.
- Separar rotas, services e repositories: `routes/escalas`, `services/email`, `repositories/postgres`, `routes/auth`, `routes/public`.
- Finalizar o descomissionamento Mongo ou isolar legado em um adaptador claro. Ainda há muitos caminhos `isMongo()` e rotas com fallback legado.
- Consolidar envio de e-mails em um único serviço com templates versionados, remetente padrão, preview, logs e retries.
- Criar um módulo central de URLs públicas: check-in, escala, formulário, magic link, convite de líder e QR.

## Prioridade 3 - Frontend e experiência

- Dividir `app.js` em módulos. Hoje ele tem cerca de 10.000 linhas; o ideal é separar estado, API client, views, componentes e helpers.
- Dividir `index.html` por templates ou migrar gradualmente para uma estrutura de componentes leve.
- Ajustar a navegação e os nomes para o novo escopo: "Pessoas", "Comunicação", "Cultos", "Escalas", "Formulários", "Check-ins", "Configurações".
- Melhorar estados vazios, loading e erro nas telas críticas de líder/admin.
- Criar um painel de "Hoje" operacional: culto, escala, check-in aberto, pendências, aniversários/novos membros e alertas.

## Prioridade 4 - Dados e crescimento

- Padronizar o conceito de pessoa: membro, voluntário, líder, admin, visitante/novo membro, candidato.
- Criar histórico de mudanças do perfil da pessoa, especialmente ministérios, batismo, dados de contato e status.
- Adicionar campos de consentimento para comunicação por e-mail/WhatsApp e rastrear origem do consentimento.
- Criar deduplicação mais forte por e-mail/telefone e merge de perfis.
- Criar exports e relatórios por período: presença, retenção, engajamento, pipeline de novos membros, ministérios com maior necessidade.

## Prioridade 5 - Operação, observabilidade e qualidade

- Adicionar healthcheck mais completo: banco, e-mail, domínio configurado, jobs ativos e versão do deploy.
- Criar logs estruturados com request id e tenant/igreja, sem expor dados pessoais.
- Adicionar monitoramento de jobs: abertura de check-in, lembrete de escala, reengajamento e marcação automática de faltas.
- Ampliar testes de rotas HTTP com servidor local em CI, não só testes unitários.
- Adicionar testes de regressão para URLs públicas e domínio: `APP_URL`, fallback por host, redirect legado e CORS.

## Prioridade 6 - Comunicação e e-mail

- Verificar `celeirosp.com` no Resend com SPF/DKIM/DMARC.
- Criar preferências de comunicação por pessoa: e-mail, WhatsApp, ambos, opt-out.
- Registrar eventos de e-mail: enviado, falhou, bounce, aberto/clicado se habilitado.
- Unificar tom de voz como "Celeiro São Paulo", deixando "voluntários" apenas como função/contexto.
- Preparar templates por jornada: novo membro, primeiro check-in, convite para servir, confirmação de escala, ausência, reengajamento.

## Sequência recomendada

1. DNS + SSL de `app.celeirosp.com`.
2. Deploy da migração de domínio/marca.
3. Testes pós-deploy: login, check-in público, escala pública, formulário público, reset de senha, link antigo com redirect.
4. Rotação de segredos e verificação Resend.
5. Refatoração backend por módulos começando por e-mail/URLs.
6. Refatoração frontend por views começando por Pessoas/Voluntários e Escalas.
