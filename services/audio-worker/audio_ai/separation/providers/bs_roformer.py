"""
BSRoFormerEngine — separação de stems via MSST + BS-RoFormer.

Usa o framework Music-Source-Separation-Training (ZFTurbo, MIT).
O checkpoint e a config são definidos por variáveis de ambiente:

  KRONILAB_BSROFORMER_CKPT  — caminho do arquivo .ckpt
  KRONILAB_BSROFORMER_CFG   — caminho do arquivo .yaml (config MSST)

Sem esses dois, o engine reporta `available() = False` e o registry
faz fallback automático para MockEngine.

⚠️  LICENÇA DOS PESOS:
    O código MSST e BS-RoFormer são MIT. O checkpoint público
    model_bs_roformer_ep_317_sdr_12.9755.ckpt (viperx edition) é
    distribuído pela comunidade sem licença explícita nos pesos.
    Usar apenas para desenvolvimento. Para comercialização, substituir
    por checkpoint com licença clara ou treinar pesos próprios.
"""
from __future__ import annotations

import logging
import os
import shutil
import soundfile as sf
import numpy as np
from pathlib import Path
from typing import TYPE_CHECKING

from ..engine import SeparationEngine, StemResult, STEMS_FOUR
from ..inference import separate_with_overlap

if TYPE_CHECKING:
    pass

log = logging.getLogger(__name__)

# Modelo inicial: 4 stems (vocals, drums, bass, other)
# Troca para STEMS_SIX quando o modelo kroni-worship estiver disponível.
DEFAULT_STEMS = list(STEMS_FOUR)

# Tamanho do chunk em segundos para overlap-add (memória GPU)
# 15 s ≈ 3 GB VRAM numa RTX 3090 com modelo padrão
CHUNK_SEC = float(os.environ.get("KRONILAB_CHUNK_SEC", "15"))
OVERLAP_SEC = 1.0


class BSRoFormerEngine(SeparationEngine):
    """
    Engine de separação via BS-RoFormer (MSST framework).

    Carrega o modelo na primeira chamada a `separate()` (lazy load)
    para não bloquear o boot da API quando não há GPU.
    """

    name = "bs_roformer"

    def __init__(self) -> None:
        self._ckpt = os.environ.get("KRONILAB_BSROFORMER_CKPT", "")
        self._cfg = os.environ.get("KRONILAB_BSROFORMER_CFG", "")
        self._model = None  # carregado sob demanda
        self._stems: list[str] = DEFAULT_STEMS

    def available(self) -> bool:
        """True se checkpoint, config e PyTorch existem."""
        if not self._ckpt or not Path(self._ckpt).exists():
            log.warning("BSRoFormer: checkpoint não encontrado em KRONILAB_BSROFORMER_CKPT=%s", self._ckpt)
            return False
        if not self._cfg or not Path(self._cfg).exists():
            log.warning("BSRoFormer: config não encontrada em KRONILAB_BSROFORMER_CFG=%s", self._cfg)
            return False
        try:
            import torch  # noqa: F401
            return True
        except ImportError:
            log.warning("BSRoFormer: torch não instalado")
            return False

    def _load_model(self):
        """Carrega modelo e config do MSST. Chamado uma única vez."""
        if self._model is not None:
            return

        import torch
        import yaml
        from ml_collections import ConfigDict

        # Carrega config MSST
        with open(self._cfg) as fh:
            raw_cfg = yaml.safe_load(fh)
        cfg = ConfigDict(raw_cfg)

        # Detecta stems do config
        if hasattr(cfg, "training") and hasattr(cfg.training, "instruments"):
            self._stems = list(cfg.training.instruments)

        # Importa modelo conforme a arquitetura declarada no config
        model_type = getattr(cfg, "model_type", "bs_roformer")
        if model_type in ("bs_roformer", "bsroformer"):
            from models.bs_roformer import BSRoformer
            self._model = BSRoformer(**dict(cfg.model))
        elif model_type in ("mel_band_roformer", "melband_roformer"):
            from models.mel_band_roformer import MelBandRoformer
            self._model = MelBandRoformer(**dict(cfg.model))
        else:
            raise ValueError(f"Tipo de modelo não suportado: {model_type}")

        # Carrega checkpoint
        device = "cuda" if torch.cuda.is_available() else "cpu"
        state = torch.load(self._ckpt, map_location=device, weights_only=False)
        if isinstance(state, dict) and "state_dict" in state:
            state = state["state_dict"]
        self._model.load_state_dict(state)
        self._model.to(device)
        self._model.eval()
        self._device = device
        log.info("BSRoFormer carregado: %s stems=%s device=%s", self._ckpt, self._stems, device)

    def _infer_chunk(self, chunk: "np.ndarray", sr: int) -> dict[str, "np.ndarray"]:
        """Inferência em um chunk de áudio."""
        import torch

        # chunk: [2, samples] float32
        with torch.no_grad():
            x = torch.from_numpy(chunk).unsqueeze(0).to(self._device)  # [1, 2, T]
            # O BS-RoFormer retorna [1, n_stems, 2, T]
            out = self._model(x)
            if out.dim() == 4:
                # Formato [batch, stems, channels, time]
                results = {}
                for i, stem in enumerate(self._stems):
                    results[stem] = out[0, i].cpu().numpy()  # [2, T]
                return results
            elif out.dim() == 3:
                # Alguns checkpoints retornam [stems, channels, time] sem batch
                results = {}
                for i, stem in enumerate(self._stems):
                    results[stem] = out[i].cpu().numpy()
                return results
            else:
                # Fallback: assume saída única = vocal
                return {self._stems[0]: out[0].cpu().numpy()}

    def separate(self, source: Path, out_dir: Path) -> StemResult:
        out_dir.mkdir(parents=True, exist_ok=True)
        self._load_model()

        # Carrega áudio
        audio, sr = sf.read(str(source), dtype="float32", always_2d=True)
        audio = audio.T  # [channels, samples]
        if audio.shape[0] == 1:
            audio = np.tile(audio, (2, 1))  # mono → estéreo

        # Separação com overlap-add
        separated = separate_with_overlap(
            self._infer_chunk, audio, sr,
            stems=self._stems,
            chunk_sec=CHUNK_SEC,
            overlap_sec=OVERLAP_SEC,
        )

        # Grava stems
        paths: dict[str, Path] = {}
        for stem, data in separated.items():
            target = out_dir / f"{stem}.wav"
            sf.write(str(target), data.T, sr, subtype="PCM_24")
            paths[stem] = target

        layout = "six" if len(self._stems) >= 6 else "four"
        return StemResult(
            stems=paths,
            layout=layout,
            model_name="bs_roformer",
            model_version=Path(self._ckpt).stem,
            provider="bs_roformer",
        )
