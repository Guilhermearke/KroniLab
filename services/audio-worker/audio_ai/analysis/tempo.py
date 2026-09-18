"""
Análise de tempo com andamento variável.

`beat_track_variable()` retorna timestamps reais de cada beat, não um BPM
único. Para gravações ao vivo com andamento variável (como um culto de louvor),
isso é a diferença entre um click que soa certo e um que deriva.

Algoritmo: programação dinâmica estilo Ellis (2007) — penaliza desvios do
período esperado com log²(Δt/τ), onde τ é o período medido pela autocorrelação
global. Librosa já implementa isso em `beat_track(tightness=...)`.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class Beat:
    """Beat concreto com timestamp real."""
    index: int
    bar: int
    beat: int
    timestamp: float
    downbeat: bool


def beat_track_variable(source: Path, tightness: float = 100.0) -> list[Beat]:
    """
    Rastreia beats com andamento variável.

    Args:
        source:    Arquivo de áudio (WAV normalizado).
        tightness: Parâmetro Ellis — quanto o algoritmo "resiste" a desvios
                   do período global. 100 = flexível (ao vivo); 400 = rígido
                   (estúdio). O padrão 100 é bom para música ao vivo.

    Returns:
        Lista de Beat com timestamps reais e marcação de downbeat.
    """
    import librosa
    import numpy as np

    y, sr = librosa.load(str(source), mono=True, sr=None)

    # Beat tracking com andamento variável (DP de Ellis, integrado no librosa)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, aggregate=np.median)
    # `tightness` controla o quanto o algoritmo aceita desvios do período global
    _, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr, units="frames", tightness=tightness
    )
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

    if not beat_times:
        return []

    # Estima compasso (4/4 vs 3/4)
    beats_per_bar = _guess_meter(onset_env.tolist(), list(beat_frames))

    # Encontra o downbeat (o "1" do compasso) pela energia grave
    low_env = _low_onset_envelope(y, sr)
    low_at_beats = [float(low_env[f]) if f < len(low_env) else 0.0 for f in beat_frames]
    downbeat_phase = _best_downbeat_phase(low_at_beats, beats_per_bar)

    beats: list[Beat] = []
    bar = 1
    beat_in_bar = downbeat_phase + 1  # compensa a fase: começa no "1" certo

    for i, t in enumerate(beat_times):
        # Ajusta a fase para começar no downbeat detectado
        beat_idx_in_bar = ((i - downbeat_phase) % beats_per_bar) + 1
        is_downbeat = beat_idx_in_bar == 1
        if is_downbeat and i > 0:
            bar += 1
        beats.append(Beat(
            index=i,
            bar=bar,
            beat=beat_idx_in_bar,
            timestamp=round(t, 6),
            downbeat=is_downbeat,
        ))

    return beats


def build_tempo_map(beats: list[Beat]) -> list[dict]:
    """
    Constrói um tempo map a partir dos beats rastreados.

    Detecta trechos de BPM estável por janela deslizante de 8 beats.
    Só cria um novo segmento quando a variação supera 5 BPM.

    Returns:
        Lista de dicts {"start_time": float, "bpm": float}
    """
    if len(beats) < 2:
        return [{"start_time": 0.0, "bpm": 120.0}]

    segments: list[dict] = []
    window = 8
    threshold_bpm = 5.0

    current_start = beats[0].timestamp
    current_bpm = _local_bpm(beats[:window])

    for i in range(window, len(beats)):
        local_bpm = _local_bpm(beats[max(0, i - window):i])
        if abs(local_bpm - current_bpm) > threshold_bpm:
            segments.append({"start_time": round(current_start, 4), "bpm": round(current_bpm, 2)})
            current_start = beats[i].timestamp
            current_bpm = local_bpm

    segments.append({"start_time": round(current_start, 4), "bpm": round(current_bpm, 2)})
    return segments


def average_bpm(beats: list[Beat]) -> float:
    """BPM médio da música a partir dos timestamps reais."""
    if len(beats) < 2:
        return 120.0
    spans = [b.timestamp - a.timestamp for a, b in zip(beats, beats[1:])]
    mean_span = sum(spans) / len(spans)
    return round(60.0 / mean_span, 2) if mean_span > 0 else 120.0


# ---------------------------------------------------------------------------
# Funções auxiliares (privadas)
# ---------------------------------------------------------------------------

def _guess_meter(onset_env: list[float], beat_frames: list[int]) -> int:
    """4/4 vs 3/4 pela regularidade do acento. Na dúvida, 4/4."""
    if len(beat_frames) < 12:
        return 4
    best_bpb, best_score = 4, float("-inf")
    for bpb in (4, 3):
        phase_scores = []
        for phase in range(bpb):
            vals = [onset_env[f] for f in beat_frames[phase::bpb] if f < len(onset_env)]
            phase_scores.append(sum(vals) / len(vals) if vals else 0.0)
        if not phase_scores:
            continue
        contrast = max(phase_scores) - (sum(phase_scores) - max(phase_scores)) / max(1, len(phase_scores) - 1)
        if contrast > best_score:
            best_bpb, best_score = bpb, contrast
    return best_bpb


def _low_onset_envelope(y: "np.ndarray", sr: int) -> list[float]:
    """Envelope de onset só na faixa grave (bumbo < 200 Hz)."""
    import librosa
    import numpy as np

    y_low = librosa.effects.preemphasis(y, coef=-0.97)  # passa-baixas grosseiro
    env = librosa.onset.onset_strength(y=y_low, sr=sr)
    return env.tolist()


def _best_downbeat_phase(low_at_beats: list[float], beats_per_bar: int) -> int:
    """
    Encontra a fase (0..beats_per_bar-1) que maximiza energia grave.
    O "1" do compasso é onde o bumbo bate mais forte.
    """
    best_phase, best_sum = 0, -1.0
    for phase in range(beats_per_bar):
        s = sum(low_at_beats[i] for i in range(phase, len(low_at_beats), beats_per_bar))
        if s > best_sum:
            best_sum = s
            best_phase = phase
    return best_phase


def _local_bpm(beats: list[Beat]) -> float:
    """BPM local de uma janela de beats."""
    if len(beats) < 2:
        return 120.0
    spans = [b.timestamp - a.timestamp for a, b in zip(beats, beats[1:]) if b.timestamp > a.timestamp]
    if not spans:
        return 120.0
    return 60.0 / (sum(spans) / len(spans))
