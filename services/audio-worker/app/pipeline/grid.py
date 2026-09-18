"""
Beat grid, tempo map, secoes, click e guia.

Este modulo e PURO de proposito: nada de torch, librosa ou rede. E aqui que
mora a decisao musical do produto, entao precisa rodar em CI sem GPU e ser
testavel linha a linha.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from statistics import median
from typing import Iterable, Sequence

PT_BR_LABEL = {
    "Intro": "Intro",
    "Verse": "Verso",
    "PreChorus": "Pre-refrao",
    "Chorus": "Refrao",
    "Bridge": "Ponte",
    "Instrumental": "Instrumental",
    "Solo": "Solo",
    "Break": "Break",
    "Outro": "Final",
}


@dataclass
class Beat:
    index: int
    bar: int
    beat: int
    timestamp: float
    downbeat: bool

    def dict(self) -> dict:
        return asdict(self)


@dataclass
class Section:
    type: str
    label: str
    start_bar: int
    end_bar: int


def build_grid(
    beat_times: Sequence[float],
    beats_per_bar: int = 4,
    downbeat_index: int = 0,
) -> list[Beat]:
    """
    Converte os instantes de beat detectados no audio em uma grade com compasso.

    `downbeat_index` e o indice do primeiro beat que cai no tempo 1. Sem isso a
    grade fica deslocada e TODO o resto (click, guia, saltos) erra junto.
    """
    grid: list[Beat] = []
    for i, t in enumerate(beat_times):
        offset = i - downbeat_index
        beat_in_bar = offset % beats_per_bar
        bar = offset // beats_per_bar + 1
        grid.append(
            Beat(
                index=i,
                bar=bar,
                beat=beat_in_bar + 1,
                timestamp=round(float(t), 4),
                downbeat=beat_in_bar == 0,
            )
        )
    return grid


def detect_downbeat_index(
    beat_times: Sequence[float],
    onset_strength: Sequence[float],
    beats_per_bar: int = 4,
) -> int:
    """
    Escolhe qual das `beats_per_bar` fases e o tempo 1: a que acumula mais
    energia de ataque. Heuristica simples e robusta; o Studio deixa corrigir.
    """
    if not beat_times or not onset_strength:
        return 0
    n = min(len(beat_times), len(onset_strength))
    best_phase, best_score = 0, float("-inf")
    for phase in range(beats_per_bar):
        score = sum(onset_strength[i] for i in range(phase, n, beats_per_bar))
        count = len(range(phase, n, beats_per_bar))
        avg = score / count if count else 0
        if avg > best_score:
            best_phase, best_score = phase, avg
    return best_phase


def tempo_map(grid: Sequence[Beat], tolerance_bpm: float = 0.75) -> list[dict]:
    """BPM variavel: um segmento novo so quando o andamento realmente muda."""
    segments: list[dict] = []
    for a, b in zip(grid, grid[1:]):
        span = b.timestamp - a.timestamp
        if span <= 0:
            continue
        bpm = round(60.0 / span, 2)
        if not segments or abs(segments[-1]["bpm"] - bpm) > tolerance_bpm:
            segments.append({"start_time": a.timestamp, "bpm": bpm})
    return segments


def average_bpm(grid: Sequence[Beat]) -> float:
    spans = [b.timestamp - a.timestamp for a, b in zip(grid, grid[1:]) if b.timestamp > a.timestamp]
    if not spans:
        return 0.0
    return round(60.0 / median(spans), 2)


def bar_of_time(grid: Sequence[Beat], time: float) -> int:
    """Compasso que contem `time`. Fora da grade, devolve o primeiro/ultimo."""
    if not grid:
        return 1
    if time <= grid[0].timestamp:
        return grid[0].bar
    last = grid[0]
    for beat in grid:
        if beat.timestamp > time:
            return last.bar
        last = beat
    return last.bar


def nearest_downbeat_bar(grid: Sequence[Beat], time: float) -> int:
    """Compasso cujo downbeat esta mais perto de `time`."""
    downbeats = [b for b in grid if b.downbeat]
    if not downbeats:
        return 1
    return min(downbeats, key=lambda b: abs(b.timestamp - time)).bar


def snap_sections(
    raw: Iterable[tuple[str, float]],
    grid: Sequence[Beat],
    min_bars: int = 2,
) -> list[Section]:
    """
    Converte fronteiras em segundos (saida do analisador) em secoes em COMPASSO.

    Secoes em timestamp solto sao inutilizaveis ao vivo: um salto para "Refrao"
    tem que cair no downbeat, nao 180ms antes dele.
    """
    items = sorted(raw, key=lambda x: x[1])
    if not grid or not items:
        return []

    total_bars = grid[-1].bar + 1
    boundaries: list[tuple[str, int]] = []
    for kind, t in items:
        bar = nearest_downbeat_bar(grid, t)
        if boundaries and bar <= boundaries[-1][1]:
            # Duas fronteiras no mesmo compasso: mantem a primeira.
            continue
        boundaries.append((kind, bar))

    sections: list[Section] = []
    counts: dict[str, int] = {}
    for i, (kind, start_bar) in enumerate(boundaries):
        end_bar = boundaries[i + 1][1] if i + 1 < len(boundaries) else total_bars
        if end_bar - start_bar < min_bars:
            # Secao curta demais para ser util: absorve na anterior.
            if sections:
                sections[-1].end_bar = end_bar
            continue
        counts[kind] = counts.get(kind, 0) + 1
        n = counts[kind]
        base = PT_BR_LABEL.get(kind, kind)
        sections.append(
            Section(type=kind, label=f"{base} {n}" if n > 1 else base,
                    start_bar=start_bar, end_bar=end_bar)
        )
    return sections


def click_events(grid: Sequence[Beat]) -> list[dict]:
    """
    Click com o primeiro tempo acentuado.
    4/4 -> 1 forte, 2 3 4 normais.
    """
    return [
        {"time": b.timestamp, "accent": b.downbeat, "bar": b.bar, "beat": b.beat}
        for b in grid
    ]


def guide_cues(
    sections: Sequence[Section],
    grid: Sequence[Beat],
    count_in_beats: int = 0,
) -> list[dict]:
    """
    Guia em pt-BR, posicionada pelo beat grid.

    A guia fala ANTES da secao comecar (um compasso de antecedencia), porque
    avisar em cima do downbeat nao serve para a banda.
    """
    cues: list[dict] = []
    if count_in_beats and grid:
        for i in range(count_in_beats):
            if i < len(grid):
                cues.append({"bar": grid[i].bar, "text": str(i + 1)})

    for section in sections:
        cue_bar = max(1, section.start_bar - 1)
        cues.append({"bar": cue_bar, "text": section.label})
    return cues


def bars_to_seconds(grid: Sequence[Beat], bar: int) -> float:
    """Inicio do compasso em segundos (para render de audio e waveform)."""
    for b in grid:
        if b.bar == bar and b.downbeat:
            return b.timestamp
    return grid[-1].timestamp if grid else 0.0
