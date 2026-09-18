# KroniLab — Treinamento e Fine-tune

## Arquitetura: BS-RoFormer via MSST

- **Framework:** [Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) (MIT)
- **Modelo:** BS-RoFormer (atenção por bandas de frequência e tempo)
- **GPU recomendada:** RTX 4090 24 GB (treinamento) ou A6000/A100 para batches maiores

## Configurações disponíveis

| Config | Stems | Status |
|---|---|---|
| `kroni_base_4stem.yaml` | vocals, drums, bass, other | Pronto para treinar |
| `kroni_worship_6stem.yaml` | vocals, drums, bass, guitar, keys, other | Aguarda dataset próprio |

## Como baixar o checkpoint inicial

```bash
python scripts/download_checkpoint.py
```

Isso baixa `model_bs_roformer_ep_317_sdr_12.9755.ckpt` e a config MSST
correspondente para `models/`.

⚠️ **Licença dos pesos:** O checkpoint público (viperx edition) não tem
licença explícita nos pesos. Usar apenas para desenvolvimento e pesquisa.
Para comercialização, treinar com pesos próprios ou obter licença.

## Como treinar

```bash
# Clone o MSST no diretório de trabalho
git clone https://github.com/ZFTurbo/Music-Source-Separation-Training msst

# Instale dependências
pip install torch torchaudio soundfile ml_collections wandb

# Treine (4 stems)
cd msst
python train.py \
  --config ../training/configs/kroni_base_4stem.yaml

# Valide
python valid.py \
  --config ../training/configs/kroni_base_4stem.yaml

# Inferência
python inference.py \
  --config ../training/configs/kroni_base_4stem.yaml \
  --model_type bs_roformer \
  --start_check_point ../models/kroni_base_4stem_best.ckpt \
  --input_folder /path/para/audio \
  --store_dir /path/para/saida
```

## Como montar o dataset próprio

```
dataset/kroni/
  001/
    mix.wav      # gravação completa (o que a igreja tem)
    vocals.wav   # separado pelo dono (exportado do CueWee ou gravado separado)
    drums.wav
    bass.wav
    guitar.wav
    keys.wav
    other.wav
  002/
    ...
```

Com ≥50 faixas, o fine-tune do `kroni_worship_6stem` já produz ganhos
mensuráveis em SDR para o repertório de louvor brasileiro.

## Registro de modelos (Model Registry)

Cada versão treinada deve ser registrada em `supabase/migrations/` e no
banco `ai_models` para rastreabilidade. Ver `0002_ai_models.sql`.
