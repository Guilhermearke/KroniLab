# Audio Worker

Pipeline que transforma um MP3 em VS completa.

```
Upload -> Normalizacao -> Hash -> Deduplicacao -> Separacao de stems
       -> Analise ritmica -> Beat grid -> BPM -> Compasso -> Tom
       -> Deteccao de secoes -> Click -> Guia -> Waveforms -> Persistencia
```

## Rodar sem GPU

Todo o pipeline roda com `LEVITA_SEPARATION_PROVIDER=mock`, que copia o audio
original em cada stem. Serve para desenvolver o app inteiro (estudo, download,
live) antes de existir uma GPU.

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload          # API
python -m app.worker                   # consumidor da fila
python -m unittest discover -s tests   # 15 testes, sem GPU e sem rede
```

## Decisoes

- **A decisao musical mora em codigo puro** (`pipeline/grid.py`). Beat grid,
  secoes em compasso, click e guia nao dependem de torch nem de librosa, entao
  rodam em CI e sao testaveis linha a linha.
- **O modelo de separacao e trocavel** (`pipeline/separation.py`). Demucs,
  RoFormer ou API externa entram pela mesma interface. Se o modelo nao entrega
  guitarra/teclado com qualidade, ele declara `layout='four'` e o app se adapta.
- **Deduplicacao por SHA-256** do arquivo original. O mesmo audio nunca gasta
  GPU duas vezes na mesma igreja.
- **A GPU nao fica ligada 24h**: o worker drena a fila e se desliga sozinho.
