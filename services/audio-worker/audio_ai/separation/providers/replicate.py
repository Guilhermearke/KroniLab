"""
ReplicateEngine — separação via Replicate.com (fallback cloud).

Útil quando não há GPU local e o volume é baixo. Para produção com
volume alto, preferir BSRoFormerEngine local.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from ..engine import SeparationEngine, StemResult, STEMS_SIX, STEMS_FOUR

log = logging.getLogger(__name__)

# Modelo Replicate padrão (demucs htdemucs_6s)
DEFAULT_MODEL = "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953"


class ReplicateEngine(SeparationEngine):
    """Separação via API do Replicate (cloud, sem GPU local)."""

    name = "replicate"

    def __init__(self, model_version: str = DEFAULT_MODEL) -> None:
        self._model_version = model_version

    def available(self) -> bool:
        try:
            import replicate  # noqa: F401
            import os
            return bool(os.environ.get("REPLICATE_API_TOKEN"))
        except ImportError:
            return False

    def separate(self, source: Path, out_dir: Path) -> StemResult:
        import replicate
        import requests

        out_dir.mkdir(parents=True, exist_ok=True)
        with open(source, "rb") as fh:
            output = replicate.run(self._model_version, input={"audio": fh})

        paths: dict[str, Path] = {}
        for stem, url in dict(output).items():
            if stem not in STEMS_SIX:
                continue
            target = out_dir / f"{stem}.wav"
            with requests.get(url, stream=True, timeout=600) as r:
                r.raise_for_status()
                with open(target, "wb") as fh:
                    shutil.copyfileobj(r.raw, fh)
            paths[stem] = target

        layout = "six" if all(s in paths for s in STEMS_SIX) else "four"
        return StemResult(
            stems=paths,
            layout=layout,
            model_name="replicate",
            model_version=self._model_version,
            provider="replicate",
        )
