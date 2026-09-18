"""
Analise ritmica e harmonica (itens 9 a 12).

librosa entra aqui e SO aqui. O resto do pipeline trabalha com listas de
numeros, para poder ser testado sem audio.
"""
from __future__ import annotations

from pathlib import Path

from .grid import Beat, build_grid, detect_downbeat_index, tempo_map, average_bpm

# Perfis Krumhansl-Schmuckler — deteccao de tom classica e barata.
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
PITCH_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]


def detect_key_from_chroma(chroma_mean: list[float]) -> tuple[str, str, float]:
    """
    Tom + modo + confianca a partir do chroma medio.
    A confianca vira numero na tela ("G Major, 91%") e libera correcao manual.
    """
    best = ("C", "major", -1.0)
    scores: list[float] = []
    for tonic in range(12):
        for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
            rotated = [profile[(i - tonic) % 12] for i in range(12)]
            score = _correlation(chroma_mean, rotated)
            scores.append(score)
            if score > best[2]:
                best = (PITCH_NAMES[tonic], mode, score)

    scores.sort(reverse=True)
    # Confianca = quanto o melhor se destaca do segundo colocado.
    margin = (scores[0] - scores[1]) if len(scores) > 1 else 0.0
    confidence = max(0.0, min(1.0, 0.5 + margin * 2))
    return best[0], best[1], round(confidence, 3)


def _correlation(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    ma = sum(a[:n]) / n
    mb = sum(b[:n]) / n
    num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    da = sum((a[i] - ma) ** 2 for i in range(n)) ** 0.5
    db = sum((b[i] - mb) ** 2 for i in range(n)) ** 0.5
    return num / (da * db) if da and db else 0.0


def guess_time_signature(onset_strength: list[float], beat_frames: list[int]) -> int:
    """
    4/4 vs 3/4 pela regularidade do acento. A maioria esmagadora do repertorio
    e 4/4 — na duvida, 4/4, e o Studio corrige.
    """
    if len(beat_frames) < 12:
        return 4
    best_bpb, best_score = 4, float("-inf")
    for bpb in (4, 3):
        phase_scores = []
        for phase in range(bpb):
            vals = [onset_strength[f] for f in beat_frames[phase::bpb] if f < len(onset_strength)]
            phase_scores.append(sum(vals) / len(vals) if vals else 0.0)
        if not phase_scores:
            continue
        # Um compasso real tem um tempo claramente mais forte que os outros.
        contrast = max(phase_scores) - (sum(phase_scores) - max(phase_scores)) / max(1, len(phase_scores) - 1)
        if contrast > best_score:
            best_bpb, best_score = bpb, contrast
    return best_bpb


def analyze(source: Path) -> dict:
    """Roda a analise completa sobre o audio. Requer librosa/numpy."""
    import librosa
    import numpy as np

    y, sr = librosa.load(str(source), mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, units="frames")
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

    beats_per_bar = guess_time_signature(onset_env.tolist(), list(beat_frames))
    downbeat_index = detect_downbeat_index(
        beat_times, [float(onset_env[f]) for f in beat_frames if f < len(onset_env)], beats_per_bar
    )
    grid = build_grid(beat_times, beats_per_bar, downbeat_index)

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = np.mean(chroma, axis=1).tolist()
    key, mode, key_conf = detect_key_from_chroma(chroma_mean)

    # Fronteiras de secao por auto-similaridade do chroma.
    boundaries = librosa.segment.agglomerative(chroma, k=_estimate_segments(duration))
    boundary_times = librosa.frames_to_time(boundaries, sr=sr).tolist()

    return {
        "duration": duration,
        "grid": grid,
        "beat_times": beat_times,
        "beats_per_bar": beats_per_bar,
        "bpm": average_bpm(grid) or round(float(tempo), 2),
        "bpm_confidence": _beat_confidence(grid),
        "tempo_map": tempo_map(grid),
        "key": key,
        "mode": mode,
        "key_confidence": key_conf,
        "boundary_times": boundary_times,
        "onset_env": onset_env.tolist(),
    }


def _estimate_segments(duration: float) -> int:
    """Uma secao a cada ~25s, entre 4 e 14 — faixa realista de louvor."""
    return max(4, min(14, int(duration // 25)))


def _beat_confidence(grid: list[Beat]) -> float:
    """Batida estavel = confianca alta. Grade tremida = pedir revisao humana."""
    spans = [b.timestamp - a.timestamp for a, b in zip(grid, grid[1:])]
    if len(spans) < 4:
        return 0.0
    mean = sum(spans) / len(spans)
    if mean <= 0:
        return 0.0
    sd = (sum((s - mean) ** 2 for s in spans) / len(spans)) ** 0.5
    return round(max(0.0, min(1.0, 1 - (sd / mean) * 6)), 3)


def label_boundaries(boundary_times: list[float], duration: float) -> list[tuple[str, float]]:
    """
    Rotula as fronteiras com uma forma tipica de louvor.
    E um chute honesto: o Studio existe justamente para o ministro ajustar.
    """
    shape = ["Intro", "Verse", "PreChorus", "Chorus", "Verse", "PreChorus",
             "Chorus", "Bridge", "Chorus", "Outro"]
    out: list[tuple[str, float]] = []
    times = [t for t in boundary_times if t < duration]
    for i, t in enumerate(times):
        out.append((shape[i] if i < len(shape) else "Instrumental", t))
    return out
