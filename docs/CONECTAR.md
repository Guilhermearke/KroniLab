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
