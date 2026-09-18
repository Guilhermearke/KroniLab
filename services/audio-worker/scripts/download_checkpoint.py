"""
Baixa o checkpoint público BS-RoFormer (viperx edition) e a config MSST.

Uso:
  cd services/audio-worker
  python scripts/download_checkpoint.py

Após o download, adicione ao .env:
  KRONILAB_BSROFORMER_CKPT=<caminho>/model_bs_roformer_ep_317_sdr_12.9755.ckpt
  KRONILAB_BSROFORMER_CFG=<caminho>/training/configs/bs_roformer_viperx.yaml

⚠️  AVISO DE LICENÇA:
    O checkpoint é distribuído pela comunidade sem licença explícita nos pesos.
    Usar apenas para desenvolvimento. Para produto comercial, treine pesos
    próprios com training/configs/kroni_base_4stem.yaml.
"""
from __future__ import annotations

import sys
from pathlib import Path

CHECKPOINT_URL = (
    "https://github.com/TRvlvr/model_repo/releases/download/"
    "all_public_uvr_models/model_bs_roformer_ep_317_sdr_12.9755.ckpt"
)
CONFIG_URL = (
    "https://raw.githubusercontent.com/ZFTurbo/Music-Source-Separation-Training/"
    "main/configs/viperx/model_bs_roformer_ep_317_sdr_12.9755.yaml"
)

HERE = Path(__file__).parent.parent
MODELS_DIR = HERE / "models"
CONFIGS_DIR = HERE / "training" / "configs"

CKPT_NAME = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
CFG_NAME  = "bs_roformer_viperx.yaml"


def download(url: str, dest: Path) -> None:
    import urllib.request

    def reporthook(n, size, total):
        if total <= 0:
            return
        pct = min(100, n * size * 100 // total)
        bar = "█" * (pct // 2) + "░" * (50 - pct // 2)
        print(f"\r  [{bar}] {pct:3d}%", end="", flush=True)

    print(f"Baixando {dest.name}…")
    urllib.request.urlretrieve(url, dest, reporthook=reporthook)
    print(f"\n  ✅ Salvo em {dest}")


def main() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    CONFIGS_DIR.mkdir(parents=True, exist_ok=True)

    ckpt_path = MODELS_DIR / CKPT_NAME
    cfg_path  = CONFIGS_DIR / CFG_NAME

    if ckpt_path.exists():
        print(f"✅ Checkpoint já existe: {ckpt_path}")
    else:
        print("\n⚠️  Aviso de Licença:")
        print("   Checkpoint distribuído pela comunidade (viperx) sem licença explícita.")
        print("   Use apenas para desenvolvimento.\n")
        resp = input("   Continuar? [s/N] ").strip().lower()
        if resp not in ("s", "sim", "y", "yes"):
            print("Cancelado.")
            sys.exit(0)
        download(CHECKPOINT_URL, ckpt_path)

    if cfg_path.exists():
        print(f"✅ Config já existe: {cfg_path}")
    else:
        download(CONFIG_URL, cfg_path)

    print("\n✅ Pronto! Adicione ao .env:")
    print(f"  KRONILAB_BSROFORMER_CKPT={ckpt_path.resolve()}")
    print(f"  KRONILAB_BSROFORMER_CFG={cfg_path.resolve()}")
    print("\nDepois:")
    print("  KRONILAB_SEPARATION_PROVIDER=bs_roformer uvicorn app.main:app --reload")


if __name__ == "__main__":
    main()
