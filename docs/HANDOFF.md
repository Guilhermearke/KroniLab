# KroniLab — Handoff (18/09/2026)

Documento para continuar o projeto com outra IA ou pessoa, sem contexto
anterior. Cole este arquivo inteiro como primeiro prompt.

---

## 1. O que é

**KroniLab**: plataforma de ministério de louvor. A música (gravação) vira uma
VS (virtual sound) com stems separados por IA, click, guia falada, beat grid
e seções; a equipe toca ao vivo com saltos quantizados entre seções, loop,
nudge, tap tempo e pad no tom. Multi-igreja, com escala/culto, RLS por igreja.

Referências de produto (ver `docs/REFERENCIAS.md`):
- **CueWee** (studio.cuewee.app) = a tela de *preparar* (studio multitrack).
- **Playback (MultiTracks)** = a tela de *tocar* (Live Mode, 3 zonas).

## 2. Repositório e estado

- GitHub: `https://github.com/Guilhermearke/KroniLab` (branch `main`).
- Clonado em `/Users/guilhermearke/KroniLab` no Mac do Guilherme. `gh` está
  autenticado como `Guilhermearke`; `git push` funciona.
- Monorepo npm workspaces: `packages/core` (lógica testada, TypeScript puro),
  `apps/web-demo` (demo web, esbuild, sem framework), `apps/mobile` (Expo,
  telas), `services/audio-worker` (Python/FastAPI: separação de stems,
  providers `mock`/`demucs`/`replicate`), `supabase/migrations/0001_init.sql`.
- Comandos: `npm install` · `npm test` (core) · `npm run build` (demo →
  `apps/web-demo/dist`) · `npx tsc -p apps/web-demo/tsconfig.json` (tipos) ·
  `npm run doctor` (testa conexões via `.env`).
- Servidor local da demo: `.claude/launch.json` → `python3 -m http.server
  8123 -d apps/web-demo/dist` (porta 8099 está ocupada por outro projeto).

## 3. O que está no ar / conectado

| Peça | Estado | Identificadores |
|---|---|---|
| **Cloudflare Pages** | ✅ deploy automático a cada push na `main` | projeto `kronilab`, conta `Kronilab@gmail.com`, account id `f05cb9452f0f03a1e38b9eaea8b43b7b`, URL **https://kronilab.pages.dev**. Build: `npm run build`, output `apps/web-demo/dist`, raiz do repo. App GitHub instalado só no repo `Guilhermearke/KroniLab`. |
| **Zona DNS `kronilab.com.br`** | ✅ criada na Cloudflare, status *pending* | nameservers `cora.ns.cloudflare.com` / `elliot.ns.cloudflare.com`. CNAMEs já criados: `kronilab.com.br` e `www` → `kronilab.pages.dev` (proxied). |
| **Registro.br** | ⏸ **troca de nameservers NÃO confirmada** | domínio do titular Guilherme Machado da Silva, usuário `GUMSI396`. NS atuais ainda `ns1/ns2.sinai.staydns.com` (DNS vazio, nada cai ao trocar). Em *Domínios → kronilab.com.br → Alterar servidores DNS*: Servidor 1 `cora.ns.cloudflare.com`, Servidor 2 `elliot.ns.cloudflare.com`, Salvar, Confirmar. A sessão expira rápido. |
| **Pages custom domain** | ⏸ depende do item acima | Depois que a zona ficar *Active*: Pages → kronilab → Custom domains → adicionar `kronilab.com.br` e `www.kronilab.com.br`. |
| **Supabase** | ✅ schema aplicado | projeto `kronilab-gif's Project`, ref `dyymlikpcssccubfvpve`, us-east-1, conta `Kronilab@gmail.com`. URL `https://dyymlikpcssccubfvpve.supabase.co`. 25 tabelas, RLS em todas, 28 políticas, trigger `event_song_settings_key_change`. **Falta** colar a anon key em `.env` (`EXPO_PUBLIC_SUPABASE_ANON_KEY`, em Settings → API Keys). O conector MCP do Supabase do Claude está ligado à OUTRA conta (`guilhermemds85@gmail.com`) — não vê este projeto. |
| **Vercel** | conector disponível, não usado | time `guilhermearke-9837's projects`. |

Armadilhas já encontradas:
- Painel da Cloudflare "Connect a domain" **trava com `.com.br`** (chama
  `registrar/domains/batch_check` → 422 e o botão gira para sempre). A zona
  foi criada por `POST /api/v4/zones` de dentro da sessão do painel.
- O GitHub logado no Chrome era `kronilab-gif`; o repo é de `Guilhermearke`.
  Já resolvido (app instalado na conta certa), mas atenção ao logar.

## 4. Demo web — o que existe (`apps/web-demo/src`)

| Arquivo | Papel |
|---|---|
| `main.ts` | cola tudo: Studio, Mixer, Live, chips Tom/BPM/Pré-contagem, importação, prefs (localStorage), atalhos |
| `engine.ts` | Web Audio: scheduler com lookahead, canais por stem (gain/pan/mute/solo), gravação importada (`AudioBufferSourceNode`), click via grade (inclusive tempo negativo = pré-contagem), guia agendada, saltos/loop/nudge/tap via `@kronilab/core` |
| `click.ts` | sons: `blip` (amostra), cowbell/woodblock/rim/beep (síntese); acento; subdivisão 0.5x/1x/2x |
| `guide.ts` | guia: amostra → TTS pt-BR → bipe; antecedência 1 compasso; contagem falada |
| `samples.ts` | banco de amostras (`apps/web-demo/samples/*.wav`, 9 arquivos recortados da exportação do CueWee — áudio de terceiro, trocar antes de cobrar) |
| `importer.ts` | decodifica áudio, **BPM por autocorrelação de onsets** (BPM fixo!), primeiro tempo pelo envelope grave, peaks da waveform |
| `import-ui.ts` | modal: arquivo → análise → BPM/Tap/alternativas/offset → "Ouvir com click" → editor de seções em compassos → salva |
| `store.ts` | IndexedDB das músicas importadas (blob + metadados) |
| `data.ts` | modelo `DemoSong`, setlist, stems (`mix` = gravação inteira), `songFromStored` |
| `timeline.ts` | lanes (régua, cifras, click, guia, stems) com alturas via CSS vars (`--h-click/--h-guide/--h-stem`) |
| `mixer.ts` | linhas de canal; `renderStrips` (coluna à esquerda das lanes); `renderLiveFaders` (palco) |
| `arrangement.ts` | VS sintetizada das 3 músicas demo |
| `pad.ts` | pad no tom com fades |

Core (`packages/core/src`): `beatgrid.ts` (grade beat a beat, tempo map
variável, `buildBeatGrid`, `timeOfBar`, `positionAt`…), `sections.ts`,
`transition.ts` (`planSectionJump`, `planLoopWrap`, `dueAction`), `nudge.ts`,
`taptempo.ts`, `transitions.ts` (entre músicas), `keys.ts`, `offline.ts`,
`permissions.ts`, `processing.ts`. Testes em `packages/core/test`.

## 5. O que o dono testou e reprovou (prioridade máxima)

Teste com "Nívea Soares — Rio (Ao Vivo)" (8:32, gravação ao vivo):

1. **"Não separou instrumentos."** A demo só importa a gravação inteira como
   lane `Mix`. Separação em stems está no `services/audio-worker`
   (demucs), que **não está rodando**. Duas saídas, as duas devem existir:
   - **Importar faixas** (como o CueWee): upload de vários arquivos
     (`vocals.wav`, `drums.wav`, `bass.wav`, `guitar.wav`, `piano.wav`,
     `other.wav`) mapeados por nome para os stems. O dono já tem esses
     arquivos exportados do CueWee em
     `~/Downloads/nivea_soares_-_rio_ao_vivo_-_nivea_soares_youtube_stems_C_115bpm/`.
     Engine: um `AudioBufferSourceNode` por stem, mesmo relógio do `mix`.
   - **Worker demucs** rodando (local no Mac, Apple Silicon aguenta; ou
     Replicate). Ver `docs/CONECTAR.md` §2 e `services/audio-worker`.
2. **"O click não ficou certo."** O importador gera grade de **BPM fixo**.
   Gravação ao vivo tem andamento variável — medido na exportação do CueWee:
   só 71 de 992 tempos batem com BPM fixo. Precisa de **beat tracking**
   (programação dinâmica estilo Ellis sobre o envelope de onsets que já
   existe em `importer.ts`, com prior no BPM detectado) gerando `beats[]`
   com timestamps reais → `BeatGrid` direto (o core já suporta grade
   irregular). Downbeat pela energia grave por grupo de 4.
3. **"A separação da música (seções) ficou errada."** As seções default são
   blocos cegos de 8 compassos (Intro 4 / Verso 8 / Refrão 8 alternando).
   Precisa de **detecção de estrutura**: chroma por compasso (FFT própria,
   12 bins) + energia → matriz de auto-similaridade → novidade → limites
   (≥4 compassos) → agrupar segmentos parecidos; o grupo mais repetido e
   mais forte = Refrão, os outros = Verso, primeiro = Intro, último = Final.
   O editor de seções continua para correção manual.

Também dito pelo dono: "o player está horrível / muito distante do Playback"
— melhorou bastante, mas o refinamento visual continua pedido. Ver §7.

## 6. Medições da referência (para acertar click e guia)

Da exportação do CueWee (click.wav / guide.wav da mesma música):
- Click: um único **blip ~900 Hz, 22 ms** em todos os tempos, **sem acento**
  por padrão (botão `A` liga). Pico 0,58.
- Guia: fala o nome da seção **um compasso antes**; primeira seção em t=0;
  "Verso" 0,52 s, "Refrão" 0,59 s, "Instrumental" 0,97 s; RMS ≈ 0,31.
- Contagem: "um, dois, três, quatro" no último compasso antes da entrada.
- Layout do CueWee: controles 200 px, faixa 80 px (waveform 50), cabeçalho
  80 (40+40), cifras 40, régua 40, transporte 100, play 48. Paleta: fundo
  `#04060a`, painel `#13161f`, `#1e2330`, borda `#1e293b`, verde `#2fae57`,
  texto `#e5eaee`; faixas click `#64748b`, guia `#8b5cf6`, vocais `#f20d0d`,
  bateria `#f2b90d`, baixo `#94c20a`, guitarra `#0ac238`, piano `#0ac285`,
  outro `#f20d80`. Fonte Inter.

## 7. Backlog além dos 3 itens

- Live Mode mais perto do Playback: capas reais, faders com marcas, botões de
  transporte com contorno; testar no celular em paisagem.
- Pad por tom (grade de 12 teclas + LINK ao tom da música), mix por seção,
  gatilhos MIDI para letras, pedal MIDI — tudo mapeado em `REFERENCIAS.md`.
- Transposição de áudio importado (pitch-shift no aparelho; hoje só cifra/pad
  mudam).
- Mobile (Expo) ainda não conectado ao Supabase: `.env` + `npm run doctor`.

## 8. Regras do repo

- Comentários e docs em português; código em inglês; nada de framework na
  demo; tudo de tempo passa pelo `@kronilab/core`, nunca reimplementado na UI.
- Commits assinados `Guilherme Arke <guilhermemds85@gmail.com>`; quando feitos
  por IA, `Co-Authored-By` no rodapé.
- `.env` nunca entra no git. Amostras `.wav` estão commitadas por decisão do
  dono (commit `ae598c9`), mas o `.gitignore` as ignora para novos arquivos.

## 9. Contas e e-mails (para saber onde logar)

- `Kronilab@gmail.com`: Cloudflare, Supabase (projeto kronilab-gif),
  GitHub `kronilab-gif` (sem repos).
- `guilhermemds85@gmail.com`: Claude, Supabase (ArkeFormsIn/ArkeKeep/FukFuk),
  CueWee (teste gratuito).
- GitHub `Guilhermearke`: dono do repo; org `Arkegui`.
- Registro.br: usuário `GUMSI396`.
