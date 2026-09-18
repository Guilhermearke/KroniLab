# Amostras do click e da guia

A engine (`src/samples.ts`) carrega daqui, por nome:

| Arquivo | Uso |
|---|---|
| `click-blip.wav` | som "Blip" do click (um golpe curto; o acento é a mesma amostra um pouco mais alta) |
| `guia-verso.wav`, `guia-refrao.wav`, `guia-instrumental.wav`, `guia-saida.wav` | voz da guia para essas seções |
| `conta-1.wav` … `conta-4.wav` | "um, dois, três, quatro" da pré-contagem |

Mono ou estéreo, 44,1 kHz, WAV 16-bit, começando **no ataque** (sem silêncio
antes — senão o click atrasa). Sem um arquivo, a engine usa síntese (click) ou
TTS pt-BR (guia).

Os `.wav` não entram no git: são de quem grava. Ver `docs/REFERENCIAS.md`.
