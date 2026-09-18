"""
MockEngine — separação sem GPU para dev e CI.

Copia o arquivo original em cada stem. Permite exercitar TODO o pipeline
(análise, beat grid, click, guia, waveforms, upload) sem uma placa NVIDIA.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from ..engine import SeparationEngine, StemResult, STEMS_FOUR, STEMS_SIX


class MockEngine(SeparationEngine):
    """Copia o mix em cada stem — zero dependências extras."""

    name = "mock"

    def __init__(self, layout: str = "four") -> None:
        # "four" = 4 stems básicos; "six" = 6 stems
        self._layout = layout

    def available(self) -> bool:
        return True

    def separate(self, source: Path, out_dir: Path) -> StemResult:
        out_dir.mkdir(parents=True, exist_ok=True)
        stems_list = STEMS_SIX if self._layout == "six" else STEMS_FOUR
        paths: dict[str, Path] = {}
        for stem in stems_list:
            target = out_dir / f"{stem}.wav"
            shutil.copyfile(source, target)
            paths[stem] = target
        return StemResult(
            stems=paths,
            layout=self._layout,
            model_name="mock",
            model_version="1.0",
            provider="mock",
        )
