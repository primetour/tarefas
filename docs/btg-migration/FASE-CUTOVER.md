# Fase Cutover — Troca de domínio Vercel → Cloudflare Pages

> Data: 2026-05-21 · Branch: `feat/btg-migration` · Owner: Renê / Tiago
> Status: PLANEJAMENTO (nada executado ainda)

## Objetivo

Definir, de forma clara e compartilhável (TI, gestão), como os 3 sites BTG
saem do ambiente atual (Vercel / Next.js) e passam a ser servidos pela
versão migrada — HTML estático + vanilla JS — hospedada no Cloudflare Pages,
sem risco e de forma reversível.

## Estado atual

| Item | Hoje |
|---|---|
| Sites BTG no ar | `operadora.primetour.com.br`, `ultrablue.primetour.com.br`, `partners.primetour.com.br` |
| Onde rodam hoje | **Vercel** — projeto `btg-pactual` (Next.js 16) |
| Versão migrada | Pronta e validável em `gestor-btg-lp-builder-staging.web.app/btg/` (staging Firebase) |
| Stack da versão migrada | HTML estático + JavaScript (sem servidor) — dentro do repositório do Gestor |
| DNS de `primetour.com.br` | Provavelmente **Hostinger** — alterado pelo **setor de TI** da Primetour |
| Host final pretendido | **Cloudflare Pages** — mesmo host do Gestor oficial |

## Conceito-chave: domínio é só um apontamento

`operadora.primetour.com.br` não "é" o site — é um registro DNS que diz para
onde o navegador deve ir. Hoje aponta para a Vercel. O cutover é **trocar
esse apontamento** para o Cloudflare Pages. Nada é movido de dentro da
Vercel; apenas se muda o destino.

Migrar o código para a branch `main` **não** muda nada para o público —
enquanto o DNS apontar para a Vercel, o visitante continua vendo o site
antigo. Merge de código e cutover de domínio são passos **independentes**.

## Pré-requisitos antes do cutover

Itens a resolver antes de unificar a branch `feat/btg-migration` com a
produção (todos hoje protegidos por trava de hostname — só atuam em staging):

| # | Item | Resolução |
|---|---|---|
| 1 | `firebase.json` ganhou bloco `hosting` | Não levar esse trecho para `main` — produção não usa Firebase Hosting. Risco zero. |
| 2 | Modo demonstração (login bypass) em `js/pages/login.js` | Remover num commit único antes do merge. |
| 3 | Plugs de produção (IA, upload de imagem, busca de fotos, solicitações) | Código preparável agora; só os deploys das Cloud Functions / regras acontecem no cutover. |

## Plugs de produção a religar no cutover

Várias features rodam em modo staging (mock / desativadas) porque dependem
de Cloud Functions com CORS e autenticação restritos ao projeto de
produção. No cutover, cada uma precisa de um pequeno ajuste de código +
redeploy:

| Plug | O que fazer | Onde |
|---|---|---|
| **IA — sugerir/revisar** | Adicionar os 3 domínios BTG ao CORS da função `callLLM` + preencher `PROD_CONFIG` | `functions/index.js`, `btg/shared/btg-ai.js` |
| **Upload de imagem (R2)** | Adicionar os 3 domínios BTG ao CORS da função `getR2UploadUrl` | `functions/index.js` |
| **Busca de fotos (Unsplash)** | Adicionar os 3 domínios BTG ao CORS da função `fetchDestinationPhoto` | `functions/index.js` |
| **Solicitações de newsletter** | Apontar a gravação para a coleção `requests` (hoje `btg_requests_dev`) e remover o gate de hostname | `btg/shared/btg-requests-service.js`, `js/services/requests.js` |

As 3 primeiras compartilham o mesmo padrão: basta acrescentar os domínios
(`partners` / `ultrablue` / `operadora` `.primetour.com.br`) à lista `cors`
da função e fazer um redeploy de funções no projeto de produção.

## Melhoria no cutover: "Setor solicitante" via SSO

Hoje a solicitação de newsletter grava o **"Setor solicitante"** fixo como
`'BTG Pactual'` — não há login nem usuários no staging. Com o SSO ativo em
produção, esse campo deve passar a vir do **perfil do colaborador logado**
(coleção `users`, campo `sector`).

O **"Setor responsável"** (Marketing e Comunicação) continua fixo — é o
*destino* da solicitação, não a origem.

## Decisões tomadas

- **Host final:** Cloudflare Pages (mesmo host do Gestor oficial).
- **DNS:** alteração feita pelo setor de TI da Primetour, no provedor de DNS
  (Hostinger).
- **Estratégia:** uma marca por vez — Operadora → Ultrablue → Partners.
- **Fallback:** o projeto na Vercel permanece ligado até as 3 marcas estarem
  estáveis. Só então é desligado.

## Passo a passo

### Etapa A — Preparo (nada público muda)

1. Merge do código para `main`, com os 3 pré-requisitos resolvidos.
2. Publicar o BTG no Cloudflare Pages — acessível numa URL de teste
   (ex.: `*.pages.dev` ou `operadora-beta.primetour.com.br`).
3. Validação completa nessa URL de teste: conteúdo, ofertas, formulário, IA,
   solicitações.

### Etapa B — Cutover de uma marca (ex.: Operadora)

4. **TI troca o registro DNS no Hostinger:** `operadora.primetour.com.br`
   deixa de apontar para a Vercel e passa a apontar para o Cloudflare Pages
   (na prática, um registro **CNAME** para o projeto do Pages).
5. **Propagação DNS:** de alguns minutos a poucas horas. O Cloudflare emite o
   certificado HTTPS automaticamente.
6. **Verificação:** abrir o domínio e confirmar que serve a versão nova.
7. **Observação:** acompanhar por alguns dias.

### Etapa C — Repetir e limpar

8. Com a Operadora estável, repetir a Etapa B para Ultrablue e depois
   Partners.
9. Com as 3 marcas estáveis, **desligar o projeto na Vercel** — passo final,
   opcional, sem pressa.

## Plano de rollback

Cada passo é reversível e não-destrutivo:

- **Durante o cutover de uma marca:** se algo quebrar, a TI repointa o DNS de
  volta para a Vercel. O site antigo volta no ar (nunca foi apagado).
- **A Vercel é a rede de segurança** até as 3 marcas estarem validadas.
- O cutover marca a marca garante que um problema afeta **apenas uma marca**,
  nunca as três ao mesmo tempo.

## Rollback do merge na `main` (se produção quebrar)

Como o `main` faz deploy automático, um merge problemático vai pro ar. Se o
Gestor de produção apresentar falha depois do merge BTG, a recuperação é
rápida — o estado bom de produção está salvo no backup:

| Referência | Valor |
|---|---|
| Branch de backup (no GitHub) | `backup/main-pre-btg-merge` |
| Tag | `backup-main-v4.49.72` |
| Commit | `00e54e7` — produção v4.49.72, estado anterior ao merge BTG |

### Antes do merge — anotar 1 informação

Logo após fazer o merge BTG na `main`, anotar o **hash do commit de merge**
(aparece no `git log` da `main` como o commit "Merge ... btg ..."). É esse
commit que será desfeito, se necessário.

### Procedimento de rollback (recomendado — `revert`)

Não reescreve histórico, não usa force-push e preserva commits de outras
equipes que tenham entrado na `main` depois do merge BTG:

```
git fetch origin
git checkout main
git pull origin main
git revert -m 1 <hash-do-commit-de-merge-btg>
git push origin main
```

O `git revert` cria um commit novo que desfaz o merge BTG. O push na `main`
dispara o deploy automático — produção volta à versão boa em ~1-2 minutos.

### O que NÃO fazer

Evitar `git reset --hard` + `git push --force` na `main`: apaga o histórico
e qualquer commit de outras equipes que tenha entrado depois do merge BTG.
Só em último caso e com a TI ciente.

### Tempo de recuperação

~2-3 minutos no total: o `revert` é instantâneo; o deploy automático do
Cloudflare Pages republica a versão boa logo em seguida.

### Importante

Este procedimento deve estar **em mãos da TI antes do merge** — a
recuperação não pode depender de ninguém específico estar disponível.

## A confirmar com a TI

1. **Provedor de DNS:** confirmar que `primetour.com.br` está mesmo na
   Hostinger (ou identificar o provedor correto).
2. **Arquitetura no Cloudflare Pages:** como o BTG agora vive no mesmo
   repositório do Gestor, ele será publicado junto. A TI decide se os 3
   domínios BTG entram como **domínios personalizados no mesmo projeto Pages
   do Gestor** ou como um **projeto Pages separado**. Ambos funcionam.
3. **Roteamento:** confirmar como `operadora.primetour.com.br` mapeia para o
   conteúdo em `/btg/operadora/` (Cloudflare Pages suporta isso via domínio
   personalizado e/ou regras de redirecionamento).

## Checklist por marca

- [ ] Versão nova validada na URL de teste
- [ ] TI agendada para a troca de DNS
- [ ] Registro DNS alterado (CNAME → Cloudflare Pages)
- [ ] HTTPS ativo e válido
- [ ] Site servindo a versão nova
- [ ] Período de observação concluído sem incidentes
- [ ] Marca considerada estável

## Resumo de uma linha

Migrar o código para `main` é seguro e não afeta o público. O cutover de
domínio é um passo separado, gradual (marca a marca), reversível, e a parte
de DNS é executada pela TI — a Vercel permanece como fallback até a
estabilização completa.
