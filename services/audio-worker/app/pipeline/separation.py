"""
Separacao de stems.

O produto NAO pode ficar preso a um modelo. Demucs hoje, RoFormer amanha, API
externa quando a GPU estiver cara: tudo entra por esta interface. Se o modelo
nao entrega qualidade em guitarra/teclado, o provider declara `layout='four'` e
o app inteiro (mixer, presets, live) se adapta — a decisao e do provider, nao
da UI.
"""
from __future__ import annotations

import shutil
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

SIX = ["vocals", "drums", "bass", "guitar", "keys", "other"]
FOUR = ["vocals", "drums", "bass", "other"]


@dataclass
class StemResult:
    layout: str          # 'six' | 'four'
    paths: dict[str, Path]
    provider: str
    model: str


class StemSeparationProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    def separate(self, source: Path, out_dir: Path) -> StemResult:
        ...

    @abstractmethod
    def available(self) -> bool:
        ...


class DemucsProvider(StemSeparationProvider):
    """htdemucs_6s na GPU. 6 stems quando o modelo suporta, 4 como fallback."""

    name = "demucs"

    def __init__(self, model: str = "htdemucs_6s", device: str = "cuda"):
        self.model = model
        self.device = device

    def available(self) -> bool:
        try:
            import torch  # noqa: F401
            import demucs.separate  # noqa: F401
        except ImportError:
            return False
        return True

    def separate(self, source: Path, out_dir: Path) -> StemResult:
        import demucs.separate

        out_dir.mkdir(parents=True, exist_ok=True)
        demucs.separate.main([
            "-n", self.model,
            "-d", self.device,
            "-o", str(out_dir),
            "--filename", "{stem}.{ext}",
            str(source),
        ])

        produced = {p.stem: p for p in out_dir.rglob("*.wav")}
        expected = SIX if self.model.endswith("6s") else FOUR
        paths = {stem: produced[stem] for stem in expected if stem in produced}

        # Se o modelo prometeu 6 e entregou menos, nao mentimos para o app.
        layout = "six" if all(s in paths for s in SIX) else "four"
        if layout == "four":
            paths = _fold_to_four(paths, out_dir)
        return StemResult(layout=layout, paths=paths, provider=self.name, model=self.model)


class ReplicateProvider(StemSeparationProvider):
    """Separacao via API — util antes de valer a pena manter GPU propria."""

    name = "replicate"

    def __init__(self, model_version: str, token: str):
        self.model_version = model_version
        self.token = token

    def available(self) -> bool:
        return bool(self.token)

    def separate(self, source: Path, out_dir: Path) -> StemResult:
        import replicate
        import requests

        out_dir.mkdir(parents=True, exist_ok=True)
        with open(source, "rb") as fh:
            output = replicate.run(self.model_version, input={"audio": fh})

        paths: dict[str, Path] = {}
        for stem, url in dict(output).items():
            if stem not in SIX:
                continue
            target = out_dir / f"{stem}.wav"
            with requests.get(url, stream=True, timeout=600) as r:
                r.raise_for_status()
                with open(target, "wb") as fh:
                    shutil.copyfileobj(r.raw, fh)
            paths[stem] = target

        layout = "six" if all(s in paths for s in SIX) else "four"
        return StemResult(layout=layout, paths=paths, provider=self.name, model=self.model_version)


class MockProvider(StemSeparationProvider):
    """
    Dev e CI: copia o original em cada stem. Permite exercitar TODO o pipeline
    (analise, click, guia, upload, app) sem GPU.
    """

    name = "mock"

    def __init__(self, layout: str = "six"):
        self.layout = layout

    def available(self) -> bool:
        return True

    def separate(self, source: Path, out_dir: Path) -> StemResult:
        out_dir.mkdir(parents=True, exist_ok=True)
        stems = SIX if self.layout == "six" else FOUR
        paths = {}
        for stem in stems:
            target = out_dir / f"{stem}{source.suffix}"
            shutil.copyfile(source, target)
            paths[stem] = target
        return StemResult(layout=self.layout, paths=paths, provider=self.name, model="mock")


def _fold_to_four(paths: dict[str, Path], out_dir: Path) -> dict[str, Path]:
    """Dobra guitarra/keys em `other` quando o modelo nao separou os seis."""
    return {k: v for k, v in paths.items() if k in FOUR}


def get_provider(name: str, **kwargs) -> StemSeparationProvider:
    if name == "demucs":
        provider = DemucsProvider(**kwargs)
        # Nunca falhar o job por falta de GPU: cai para mock e sinaliza.
        return provider if provider.available() else MockProvider()
    if name == "replicate":
        return ReplicateProvider(**kwargs)
    return MockProvider(**kwargs)
