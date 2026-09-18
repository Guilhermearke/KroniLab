"""Render de click, guia e waveform (itens 13, 14 e o Studio)."""
from __future__ import annotations

import math
import struct
import wave
from pathlib import Path
from typing import Sequence

SAMPLE_RATE = 44100

# Cada som de click e uma senoide com envelope curto. Acento = mais agudo e alto.
CLICK_SOUNDS = {
    "digital": {"accent": (1800.0, 0.9), "normal": (1200.0, 0.55), "decay": 0.045},
    "cowbell": {"accent": (835.0, 0.9), "normal": (587.0, 0.6), "decay": 0.09},
    "wood": {"accent": (2400.0, 0.8), "normal": (1600.0, 0.5), "decay": 0.025},
}


def render_click(events: Sequence[dict], duration: float, out: Path, sound: str = "digital") -> Path:
    """Gera a faixa de click a partir dos eventos do beat grid."""
    cfg = CLICK_SOUNDS.get(sound, CLICK_SOUNDS["digital"])
    total = int(duration * SAMPLE_RATE) + SAMPLE_RATE
    buf = [0.0] * total

    for ev in events:
        freq, amp = cfg["accent"] if ev["accent"] else cfg["normal"]
        start = int(ev["time"] * SAMPLE_RATE)
        length = int(cfg["decay"] * SAMPLE_RATE)
        for i in range(length):
            idx = start + i
            if idx >= total:
                break
            env = math.exp(-i / (cfg["decay"] * SAMPLE_RATE / 4))
            buf[idx] += amp * env * math.sin(2 * math.pi * freq * (i / SAMPLE_RATE))

    _write_wav(buf, out)
    return out


def render_guide(cues: Sequence[dict], grid: Sequence, duration: float, out: Path) -> Path:
    """
    Guia falada em pt-BR.

    Com TTS disponivel, sintetiza a voz; sem ele, gera marcadores tonais no
    lugar certo para nao travar o pipeline (a posicao e o que importa para
    sincronismo — a voz pode ser regerada depois).
    """
    times = _cue_times(cues, grid)
    try:
        return _render_tts(cues, times, duration, out)
    except Exception:
        return _render_markers(times, duration, out)


def _cue_times(cues: Sequence[dict], grid: Sequence) -> list[float]:
    by_bar = {b.bar: b.timestamp for b in grid if getattr(b, "downbeat", False)}
    return [by_bar.get(c["bar"], 0.0) for c in cues]


def _render_tts(cues: Sequence[dict], times: Sequence[float], duration: float, out: Path) -> Path:
    from TTS.api import TTS  # type: ignore

    import numpy as np
    import soundfile as sf

    tts = TTS("tts_models/pt/cv/vits")
    total = int(duration * SAMPLE_RATE) + SAMPLE_RATE
    track = np.zeros(total, dtype="float32")
    for cue, t in zip(cues, times):
        wav = np.array(tts.tts(cue["text"]), dtype="float32")
        start = int(t * SAMPLE_RATE)
        end = min(total, start + len(wav))
        track[start:end] += wav[: end - start] * 0.9
    sf.write(str(out), track, SAMPLE_RATE)
    return out


def _render_markers(times: Sequence[float], duration: float, out: Path) -> Path:
    total = int(duration * SAMPLE_RATE) + SAMPLE_RATE
    buf = [0.0] * total
    for t in times:
        start = int(t * SAMPLE_RATE)
        length = int(0.18 * SAMPLE_RATE)
        for i in range(length):
            idx = start + i
            if idx >= total:
                break
            env = math.exp(-i / (0.06 * SAMPLE_RATE))
            buf[idx] += 0.5 * env * math.sin(2 * math.pi * 660 * (i / SAMPLE_RATE))
    _write_wav(buf, out)
    return out


def _write_wav(buf: list[float], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for sample in buf:
            clipped = max(-1.0, min(1.0, sample))
            frames += struct.pack("<h", int(clipped * 32767))
        wf.writeframes(bytes(frames))


def compute_peaks(path: Path, samples_per_second: int = 20) -> list[float]:
    """Picos normalizados para o waveform do Studio."""
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    window = max(1, int(sr / samples_per_second))
    peaks = [
        float(np.abs(mono[i:i + window]).max())
        for i in range(0, len(mono), window)
    ]
    top = max(peaks) if peaks else 0.0
    return [round(p / top, 3) for p in peaks] if top > 0 else peaks
