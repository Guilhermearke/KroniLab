# Conectar as ferramentas

Quatro peças, em ordem de importância. Depois de cada uma, rode `npm run doctor`
— ele testa a conexão de verdade e diz o que ainda falta.

```bash
cp .env.example .env
npm run doctor
```

---

## 1. Supabase — banco, login e sincronização

Sem isso o app roda só com o banco local (SQLite): o Live Mode funciona, mas
nada sincroniza entre os aparelhos da equipe.

1. No painel do projeto: **Settings → API**
2. Copie para o `.env`:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. Aplique o schema: **SQL Editor** → cole `supabase/migrations/0001_init.sql`
   → Run. São 25 tabelas, o gatilho de mudança de tom e o RLS por igreja.

> **Estado (18/09/2026):** aplicado no projeto `kronilab-gif's Project`
> (ref `dyymlikpcssccubfvpve`, us-east-1). Conferido no banco: 25 tabelas,
> 25 com RLS, 28 políticas, 1 trigger. URL:
> `https://dyymlikpcssccubfvpve.supabase.co`. Falta só colar a anon key no
> `.env`.

O `doctor` separa as duas coisas: *Supabase* diz se o projeto responde, *Schema*
diz se as tabelas existem. Projeto de pé com banco vazio é o caso mais comum.

> A anon key é pública por natureza — ela vai dentro do app. Quem protege os
> dados é o RLS, não o segredo da chave. A `SUPABASE_SERVICE_KEY` é outra
> história: ela ignora o RLS e só pode viver no servidor.

**Se o projeto não aparecer para o conector do Claude:** ele está ligado a outra
conta. Reconecte o conector do Supabase com o e-mail dono do projeto.

---

## 2. Worker de áudio — a IA que monta a VS

```bash
cd services/audio-worker
pip install -r requirements.txt
uvicorn app.main:app --reload
```

No `.env`: `EXPO_PUBLIC_WORKER_URL=http://localhost:8000`

Com `KRONILAB_SEPARATION_PROVIDER=mock` o pipeline inteiro roda **sem GPU** —
ele copia o áudio em cada stem. Serve para exercitar upload, análise, click,
guia, download e Live Mode antes de existir uma placa.

---

## 3. Cloudflare R2 — onde ficam os arquivos grandes

Stems, click e guia de um culto passam fácil de 1 GB. Sem R2 o worker guarda
tudo em disco local, o que serve para desenvolver e não para a equipe baixar.

Painel → **R2 → Manage API tokens** → preencha `KRONILAB_R2_*` no `.env`.

---

## 4. Cloudflare Pages — a demo no ar

**Workers & Pages → Create → Pages → Connect to Git →** `KroniLab`

| Campo | Valor |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `apps/web-demo/dist` |
| Root directory | *(vazio — a raiz do repo)* |

A raiz precisa ser a do repositório por causa dos workspaces: o build importa
`packages/core`, que não existe dentro de `apps/web-demo`.

Não é preciso token: o Pages faz build a cada push sozinho.

> **Estado (18/09/2026):** projeto `kronilab` criado, ligado a
> `Guilhermearke/KroniLab` (app do GitHub instalado só nesse repo), primeiro
> deploy no ar em **https://kronilab.pages.dev**. Cada push na `main` publica.

### Domínio próprio — kronilab.com.br

O domínio está no registro.br (titular Guilherme Machado da Silva). Para o
Pages atendê-lo, o DNS inteiro passa a viver na Cloudflare:

1. Zona `kronilab.com.br` criada na conta Cloudflare (`Kronilab@gmail.com`).
   Nameservers atribuídos: `cora.ns.cloudflare.com` e `elliot.ns.cloudflare.com`.
2. Registros já criados na zona: `kronilab.com.br` e `www` → CNAME
   `kronilab.pages.dev`, proxied.
3. No **registro.br → Domínios → kronilab.com.br → Alterar servidores DNS**:
   trocar `ns1/ns2.sinai.staydns.com` pelos dois da Cloudflare. O DNS antigo
   estava vazio (sem A, MX ou TXT), então nada cai com a troca.
4. Quando a zona ficar *Active* (minutos a algumas horas), em
   **Pages → kronilab → Custom domains → Set up a custom domain** adicionar
   `kronilab.com.br` e `www.kronilab.com.br`. O Pages recusa esse passo
   enquanto a zona está *Pending*.

> **Armadilha do painel:** o fluxo novo "Connect a domain" chama
> `registrar/domains/batch_check` antes de criar a zona; para `.com.br` isso
> devolve 422 e o botão *Continue* trava girando para sempre, sem erro na tela.
> A zona foi criada pela API (`POST /api/v4/zones`) de dentro da sessão do
> painel. Se precisar repetir, é esse o caminho — não o formulário.

---

## Conectores MCP

O `.mcp.json` define Supabase, Cloudflare e GitHub. Abra o projeto no Claude
Code e ele oferece conectar. As chaves vêm do `.env` — nenhuma fica escrita no
arquivo de configuração.

Os servidores da Cloudflare e do GitHub são remotos: a autenticação abre no
navegador e nenhum token é colado em arquivo. **Confirme as URLs da Cloudflare**
em `developers.cloudflare.com/agents/model-context-protocol/` antes de usar —
elas mudam de tempos em tempos, e as do `.mcp.json` são o que estava valendo
quando o arquivo foi escrito.

---

## O que cada peça destrava

| Sem | O que ainda funciona | O que não funciona |
|---|---|---|
| Supabase | Live Mode, estudo, tudo local | Sincronizar entre aparelhos, login, aviso de mudança de tom |
| Worker | Tudo que já foi processado | Criar VS a partir de um áudio novo |
| R2 | Desenvolvimento local | A equipe baixar o culto |
| Pages | Rodar a demo local | Mostrar a demo por link |
