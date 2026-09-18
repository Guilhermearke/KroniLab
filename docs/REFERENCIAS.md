# Referências de produto

Produtos que fazem parte do que o KroniLab quer fazer. O objetivo aqui não é
copiar tela: é anotar **o que cada um resolve bem** e **o que deixa em aberto**,
para o KroniLab saber onde se diferencia.

---

## Referência 1 — CueWee (studio.cuewee.app)

Capturas de 18/09/2026, música "Nívea Soares - Rio (Ao Vivo)" importada do
YouTube e separada em stems.

### O que ele faz

**Studio multitrack** — uma música aberta mostra, de cima para baixo:

| Faixa | O que é | Controles |
|---|---|---|
| Click | metrônomo gerado | som (Cowbell...), subdivisão 0.5x / 1x / 2x |
| Guia | seções faladas (REFRÃO, VERSO...) | idioma da voz (PT-BR), editar seção |
| Vocais / Bateria / Baixo / Guitarra | stems separados por IA | M (mute), S (solo), fader, pan |

Acima das faixas, uma régua de compassos (1, 5, 9...) e uma **linha de
acordes** detectados por compasso (C, Fm, F, Fm, C, F, G, Am, Eaug...). Cada
stem tem botão de download e um ícone de "ramificar".

**Cabeçalho da música**: tom (C), BPM (115), duração (8:32), botões
*Exportar Música* e *Modo ao Vivo* (destaque roxo — é o CTA principal).

**Transporte** (rodapé): play, início, retroceder, avançar, fim, loop, marcador,
posição `0:00 / 8:32`. À direita, três chips que abrem popovers:

- **Tom** → `Tom: 0 semitons` com stepper ↑↓ (transposição em tempo real)
- **BPM** → `− 115 BPM +` e um botão **Tap**
- **Pré-contagem** → toggle, `2 compassos`, *contagens por compasso* `4 AUTO`

**Editar seção da Guia**: popover com contador, link, lixeira, seletor de tipo
e uma lista "GUIAS" (Refrão ▾, botão +). Ou seja: as seções são editáveis e
podem ter mais de uma guia falada.

**Informações da Música**: modal com capa, título (limite 100), artista e tom.

**Biblioteca**: lista por data (ONTEM), colunas título / TOM / BPM / DURAÇÃO.

**Upload**: duas vias — *Separar faixas* (sobe um áudio inteiro, a IA separa)
e *Importar faixas* (sobe stems já prontos). MP3, WAV, M4A, FLAC, OGG, máx
15 min e 150 MB. Apps para macOS, iOS e Android. Plano gratuito com cota de
armazenamento (2 GB).

### O que isso confirma no KroniLab

- A hierarquia **Click → Guia → stems** é a mesma que o schema já modela
  (`song_stems` com `stem_id` incluindo `click` e `guide`).
- Seções por compasso com guia falada = `song_sections` + `guide_cues`.
- Transposição por semitons e BPM ajustável por música = `event_song_settings`
  (`selected_key`, `selected_tempo`) — no KroniLab isso muda **por culto**, sem
  tocar na música original. É uma diferença real: no CueWee o ajuste parece
  ser da música.
- Linha de acordes por compasso: hoje não existe no schema. Vale um campo em
  `song_analysis` ou uma tabela `song_chords (song_id, bar, chord)`.
- Pré-contagem configurável (compassos + contagens) é um requisito do Live
  Mode que a demo ainda não tem.
- Limite de 15 min / 150 MB por arquivo é uma referência de custo de GPU.

### Medições feitas na exportação (18/09/2026)

Da exportação de "Nívea Soares — Rio (Ao Vivo)" (click.wav, guide.wav) e do
DOM da tela:

- **Click**: um único som em todos os tempos — *blip* de ~900 Hz, 22 ms, sem
  acento por padrão (o botão `A` liga o acento). Pico 0,58. Só 71 dos 992
  tempos batem com BPM fixo: a grade deles é de **andamento variável**
  (gravação ao vivo). Confirma o desenho do nosso beat grid beat a beat.
- **Guia**: fala o nome da seção **um compasso antes** dela (2,08 s → seção em
  4,21 s a 115 BPM); na primeira seção fala em t=0. "Verso" ≈ 0,52 s,
  "Refrão" ≈ 0,59 s, "Instrumental" ≈ 0,97 s. Nível RMS ≈ 0,31 (≈ −5 dB
  abaixo do click).
- **Contagem falada**: "um, dois, três, quatro", um por tempo, no último
  compasso antes da seção que abre a música.
- **Layout**: coluna de controles 200 px; faixa 80 px (waveform 50 px);
  cabeçalho 80 px (ferramentas 40 + M/S 40); cifras 40 px; régua 40 px;
  transporte 100 px, play 48 px. Paleta: fundo `#04060a`, painel `#13161f`,
  painel-2 `#1e2330`, borda `#1e293b`, verde `#2fae57`, texto `#e5eaee`.
  Faixas: click `#64748b`, guia `#8b5cf6`, vocais `#f20d0d`, bateria
  `#f2b90d`, baixo `#94c20a`, guitarra `#0ac238`, piano `#0ac285`, outro
  `#f20d80`. Fonte Inter.

> **Amostras** (`apps/web-demo/samples/`: blip, Verso/Refrão/Instrumental/
> Saída, contagem 1–4): a engine toca qualquer WAV com esses nomes; sem eles,
> síntese e TTS cobrem. Os recortes da exportação da CueWee ficam **fora do
> git** (`.gitignore`) — são áudio de terceiro. Para o deploy, gravar amostras
> próprias com esses nomes (ou subir os recortes por conta própria).

### O que o CueWee não faz (e o KroniLab faz)

- Nada de igreja, escala, culto, quem toca o quê. É uma ferramenta de músico
  solo; o KroniLab é de **equipe**.
- Sem noção de "revisão do culto": mudou o tom → a equipe é avisada. Isso é
  regra de negócio do KroniLab (trigger `notify_key_change`).
- Sem pacote offline por culto (`offline_manifests`).

---

## Referência 2 — Playback (MultiTracks) — **a referência máxima do Live Mode**

Capturas da página do app na App Store (iOS), 18/09/2026. É o padrão de
mercado para tocar VS ao vivo em igreja; o Live Mode do KroniLab precisa
chegar nesse nível de confiança antes de pensar em qualquer coisa a mais.

### A tela principal (paisagem, uma mão)

Três zonas, da esquerda para a direita:

1. **Transporte** (coluna fina): tempo `00:00 / 8:34`, `70 / 4/4` (BPM e
   fórmula), botões grandes ▷ (play), ▷| (próxima), rampa (fade), `PAD`,
   `EDITAR`, menu. Tudo tocável sem olhar.
2. **Setlist** ("Meu Repertório do Playback"): cartões com capa e
   `Título (Tom)` — *A Bênção (B)*, *Levanto Um Aleluia (Db)*, *Outro Na
   Fornalha (C)*, *Glorioso Dia (D)*, *Indescribable*. Entre um cartão e outro
   há um ícone verde de **transição** (⊕ com seta) e, em um deles, `⤮`
   (crossfade). A música atual tem borda destacada.
3. **Mixer**: um fader por stem com `S` (solo), *Master* no topo, botões
   `MUTE MIDI`, `C` (click) e `S` (guia?) como toggles rápidos, e pontinhos
   de paginação (o mixer tem mais de uma página de faixas).

Stems vistos numa música real: *Guide, Drums, Perc, Loop, Bass, SBass, AG*
(+ Click e Pad). Bem mais granular que os 6 do CueWee.

### Os recursos que cada tela vende

| Tela | O que é | Equivalente no KroniLab |
|---|---|---|
| **Use tracks ao vivo com confiança** | a tela principal acima | `LiveMode`, `stage view` |
| **Salve Repertórios e Arranjos** | repertórios nomeados, com data, nº de músicas e duração total; *Atualização Disponível* e *Salvar no Cloud* | `setlists`, `events` + `offline_manifests` (revisão) |
| **Pad Player** | pad ambiente contínuo por tom (grade de 12 teclas, C…B), botão `LINK` para seguir o tom da música, fader próprio | não existe — **gap** |
| **Crie transições perfeitas** | por música: *Preparar Próxima Música*, *Continuar na Música*, *Continuar Pad*, *AutoLink*, *Sobreposição*, *Transição Cruzada* | parcialmente: o commit "song transitions" tem o modelo, sem UI de escolha |
| **Automatize letras com Gatilhos MIDI** | marcadores na forma de onda disparam MIDI (`Nota G-1, vel 5`) para o projetor de letras, com *Desabilitar Loop* e descrição | não existe — **gap** (integração com Holyrics/ProPresenter passa por aqui) |
| **Total flexibilidade ao vivo** | arrastar da seção atual para outra (`S` → seção alvo, linha pontilhada) — salto quantizado ao vivo; marcadores de seção `V`, `C`, `R1`, `Cv` na waveform | o coração do `@kronilab/core` — já existe |
| **Controlador MIDI** | botões de transporte mapeados (setas, círculo, PRONTO) — pedal | não existe — **gap**, mas simples (MIDI/Bluetooth) |
| **Automatize suas tracks e pads** | automação de fader por seção (marcadores vermelhos `|` nos faders) — por ex. "sem baixo no verso 1" | `event_song_settings` cobre tom/tempo; **falta** mix por seção |
| **Interface de áudio** | escolha do dispositivo (iConnectAUDIO4+), saídas separadas para click/guia (fones) × PA | `stage view` deve prever roteamento: click só nos fones |
| **Mudança de tom e andamento offline** | modal *Atualizando Música* com Tom `D` e Andamento `82.0`, barra de progresso — reprocessa localmente | `selected_key`/`selected_tempo` — e o app precisa fazer o pitch/tempo shift **no aparelho**, sem servidor |

### O que isso decide para o KroniLab

1. **A tela ao vivo é paisagem, três zonas, botões grandes.** Não é uma DAW.
   O CueWee (Ref. 1) é a tela de *preparar*; o Playback é a tela de *tocar*.
   São duas telas diferentes e as duas precisam existir.
2. **Setlist com transições entre músicas é núcleo, não extra.** O ícone
   verde entre cartões é o que faz o culto fluir sem silêncio.
3. **Pad por tom é esperado.** Vale entrar como stem sintetizado (o worker já
   gera click e guia; um pad por tom é o mesmo tipo de geração).
4. **Mix por seção** ("verso só com pad e voz") é uma coluna a mais em
   `event_song_settings` ou uma tabela `section_mix (event_song_setting_id,
   section_id, stem, gain_db, muted)`.
5. **Tom/andamento mudam no aparelho, offline.** O manifesto offline leva os
   stems originais; o app faz o shift. Isso é requisito de arquitetura do
   mobile, não do worker.
6. **MIDI (gatilhos de letra + pedal) fica para depois do MVP**, mas o modelo
   de marcadores na waveform (`guide_cues` com `bar`) já é o gancho certo:
   um cue pode carregar um evento MIDI além de texto.

### O que o Playback não faz (e o KroniLab faz)

- Não separa stems de um áudio qualquer: o catálogo é o da MultiTracks,
  pago por música. O KroniLab gera a VS de qualquer gravação da igreja.
- Não tem escala, confirmação de presença, nem "quem toca o quê".
- A mudança de tom é da música no aparelho de quem mudou; não avisa a equipe.
