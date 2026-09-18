# KroniLab

Plataforma de ministerio de louvor. Um produto so, integrado de ponta a ponta:

```
Igreja -> Culto -> Escala -> Repertorio -> IA gera a VS -> Ministro define o tom
      -> Equipe estuda -> Culto e baixado -> Live Check -> Live Mode
      -> Playback com salto de secao / loop / nudge / tap
```

A IA de VS nao e um projeto separado. Ela nasce ligada a `Song`, que alimenta
`EventSong`, `StudySession`, `OfflineSession` e `LiveSession`.

## Estrutura

```
packages/core/          Dominio + logica musical (TypeScript puro, 67 testes)
apps/mobile/            App React Native / Expo, organizado por dominio
services/audio-worker/  Pipeline de IA: MP3 -> VS (Python, 15 testes)
supabase/migrations/    Schema PostgreSQL com RLS por igreja
```

## As cinco decisoes que sustentam o resto

**1. A musica e imutavel; o culto e que varia.**
`Santo Pra Sempre` tem um tom original (B). Domingo ela vai em C, no congresso
em Bb. Isso vive em `event_song_settings`, nunca na musica. Um arquivo de audio,
infinitas configuracoes de culto.

**2. O beat grid e a fonte da verdade do tempo.**
Nada no produto guarda "BPM = 72" solto. Guardamos compasso, tempo, timestamp e
downbeat, beat a beat. E isso que permite BPM variavel, salto quantizado, loop
no lugar certo, nudge e tap tempo — todos lendo a mesma grade.

**3. Tocar um botao nunca pula na hora.**
No Live Mode, escolher uma secao enfileira o destino. A troca acontece no ponto
musical (proximo compasso, por padrao). Um salto imediato soa como erro da
banda; um salto quantizado soa como arranjo.

**4. Nudge e mudanca temporaria de tempo, nao seek.**
Para ganhar 120 ms, a VS anda 2% mais rapido por 6 segundos e volta. O publico
nao ouve. Um seek, ouve.

**5. O Live Mode nao depende de rede.**
Cloud -> Sync -> SQLite -> Live Mode. O culto inteiro desce antes (stems, click,
guia, grid, secoes, tom) e o palco trabalha em cima do disco local.

## Rodar

```bash
# Logica musical (sem dependencias)
cd packages/core && npm test

# Pipeline de IA (sem GPU, com provider mock)
cd services/audio-worker && python3 -m unittest discover -s tests

# App (exige development build: Expo Go nao carrega a engine de audio)
cd apps/mobile && npm install && npm start
```

## Estado atual

Prontos e testados: dominio, matematica musical do palco, pipeline de IA,
schema do banco, engine de audio (interface + adapter JS + ponte nativa),
camada local-first e o controlador do Live Mode.

Em construcao: telas do app, sync com Supabase, Studio de edicao, MIDI e
Follow Band (a arquitetura ja reserva o lugar dos dois).
