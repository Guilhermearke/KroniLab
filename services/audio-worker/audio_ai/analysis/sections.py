"""
Detecção de estrutura musical (seções).

Pipeline:
  chroma por compasso → matriz de auto-similaridade → curva de novidade
  (kernel Foote) → limites → agrupamento por cosseno → rótulos pt-BR.

O grupo mais repetido e mais energético = Refrão.
Primeiro segmento = Intro. Último = Final.
O resto são Versos, Pontes, etc.

Referência:
  Foote, J. (2000). Automatic Audio Segmentation Using a Measure of Audio
  Novelty. ICME 2000.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Section:
    """Seção da música em compassos (1-based)."""
    type: str    # "Intro" | "Verse" | "Chorus" | ...
    label: str   # rótulo em pt-BR exibido na guia e no Live Mode
    start_bar: int
    end_bar: int  # exclusivo: a seção cobre [start_bar, end_bar)


# Mapeamento tipo → rótulo pt-BR
PT_BR_LABEL: dict[str, str] = {
    "Intro": "Intro",
    "Verse": "Verso",
    "PreChorus": "Pré-refrão",
    "Chorus": "Refrão",
    "Bridge": "Ponte",
    "Instrumental": "Instrumental",
    "Solo": "Solo",
    "Break": "Break",
    "Outro": "Final",
}


def detect_sections(source_path: str, beats: list, min_bars: int = 4) -> list[Section]:
    """
    Detecta seções a partir do áudio e dos beats rastreados.

    Args:
        source_path: Caminho do áudio normalizado.
        beats:       Lista de Beat (resultado de beat_track_variable).
        min_bars:    Tamanho mínimo de seção em compassos.

    Returns:
        Lista de Section com rótulos pt-BR.
    """
    import librosa
    import numpy as np

    y, sr = librosa.load(source_path, mono=True, sr=None)

    # 1. Chroma por compasso (media sobre os frames de cada compasso)
    chroma_frames = librosa.feature.chroma_cqt(y=y, sr=sr, bins_per_octave=36)
    chroma_per_bar = _chroma_per_bar(chroma_frames, beats, sr)
    n_bars = len(chroma_per_bar)

    if n_bars < 4:
        # Música muito curta: retorna seção única
        return [Section(type="Verse", label="Música", start_bar=1, end_bar=n_bars + 1)]

    # 2. Matriz de auto-similaridade (cosseno)
    sim = _self_similarity(chroma_per_bar)

    # 3. Curva de novidade via kernel checker-board de Foote
    novelty = _novelty_curve(sim, kernel_size=min(8, n_bars // 4))

    # 4. Picos da novidade = limites de seção
    boundary_bars = _find_boundaries(novelty, min_bars=min_bars)
    # Garante que 1 e n_bars+1 estão nos limites
    if not boundary_bars or boundary_bars[0] != 1:
        boundary_bars = [1] + boundary_bars
    if boundary_bars[-1] != n_bars + 1:
        boundary_bars.append(n_bars + 1)

    # 5. Agrupa segmentos por similaridade de chroma
    segments = list(zip(boundary_bars[:-1], boundary_bars[1:]))  # [(start, end), ...]
    groups = _group_segments(segments, chroma_per_bar)

    # 6. Rotula grupos
    return _label_groups(segments, groups, chroma_per_bar, n_bars)


# ---------------------------------------------------------------------------
# Funções auxiliares
# ---------------------------------------------------------------------------

def _chroma_per_bar(chroma_frames: "np.ndarray", beats: list, sr: int) -> list["np.ndarray"]:
    """Agrega chroma frames em compasso (média dos frames do compasso)."""
    import librosa
    import numpy as np

    hop = 512  # padrão librosa
    frames_per_sec = sr / hop

    downbeats = [b for b in beats if b.downbeat]
    if not downbeats:
        return [np.mean(chroma_frames, axis=1)]

    chroma_bars: list[np.ndarray] = []
    for i, db in enumerate(downbeats):
        start_frame = int(db.timestamp * frames_per_sec)
        if i + 1 < len(downbeats):
            end_frame = int(downbeats[i + 1].timestamp * frames_per_sec)
        else:
            end_frame = chroma_frames.shape[1]
        segment = chroma_frames[:, start_frame:end_frame]
        if segment.shape[1] == 0:
            chroma_bars.append(chroma_bars[-1] if chroma_bars else np.zeros(12))
        else:
            chroma_bars.append(np.mean(segment, axis=1))

    return chroma_bars


def _cosine(a: "np.ndarray", b: "np.ndarray") -> float:
    """Similaridade de cosseno entre dois vetores."""
    import numpy as np
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na < 1e-8 or nb < 1e-8:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _self_similarity(chroma_bars: list["np.ndarray"]) -> "np.ndarray":
    """Matriz N×N de similaridade de cosseno entre compassos."""
    import numpy as np

    n = len(chroma_bars)
    sim = np.zeros((n, n), dtype=np.float32)
    for i in range(n):
        for j in range(i, n):
            v = _cosine(chroma_bars[i], chroma_bars[j])
            sim[i, j] = v
            sim[j, i] = v
    return sim


def _novelty_curve(sim: "np.ndarray", kernel_size: int = 8) -> list[float]:
    """
    Curva de novidade via kernel checker-board de Foote.
    Pico = transição entre seções.
    """
    import numpy as np

    n = sim.shape[0]
    k = kernel_size
    # Kernel checker-board k×k
    kernel = np.ones((k, k), dtype=np.float32)
    kernel[:k//2, :k//2] = 1
    kernel[k//2:, k//2:] = 1
    kernel[:k//2, k//2:] = -1
    kernel[k//2:, :k//2] = -1

    novelty = []
    for i in range(n):
        r0, r1 = max(0, i - k//2), min(n, i + k//2)
        c0, c1 = max(0, i - k//2), min(n, i + k//2)
        sub = sim[r0:r1, c0:c1]
        kr = kernel[:r1-r0, :c1-c0]
        novelty.append(float(np.sum(sub * kr)))

    # Normaliza 0..1
    v_min, v_max = min(novelty), max(novelty)
    rng = v_max - v_min
    if rng > 1e-8:
        novelty = [(v - v_min) / rng for v in novelty]
    return novelty


def _find_boundaries(novelty: list[float], min_bars: int = 4) -> list[int]:
    """
    Picos locais da curva de novidade = limites de seção.
    Retorna índices de compassos (1-based).
    """
    n = len(novelty)
    threshold = 0.3
    boundaries: list[int] = []
    last = 0

    for i in range(1, n - 1):
        if (novelty[i] > novelty[i-1] and novelty[i] > novelty[i+1]
                and novelty[i] > threshold
                and (i - last) >= min_bars):
            boundaries.append(i + 1)  # 1-based
            last = i

    return boundaries


def _group_segments(
    segments: list[tuple[int, int]],
    chroma_bars: list["np.ndarray"],
) -> list[int]:
    """
    Agrupa segmentos por similaridade de chroma.
    Retorna lista de IDs de grupo (0, 1, 2, ...) para cada segmento.
    """
    import numpy as np

    # Chroma médio de cada segmento
    seg_chroma = []
    for start, end in segments:
        bars = chroma_bars[start-1:end-1]
        if bars:
            seg_chroma.append(np.mean(bars, axis=0))
        else:
            seg_chroma.append(np.zeros(12))

    # Agrupamento guloso por cosseno (threshold 0.85)
    threshold = 0.85
    groups = [-1] * len(segments)
    next_group = 0

    for i, chroma_i in enumerate(seg_chroma):
        if groups[i] >= 0:
            continue
        groups[i] = next_group
        for j in range(i + 1, len(seg_chroma)):
            if groups[j] >= 0:
                continue
            if _cosine(chroma_i, seg_chroma[j]) >= threshold:
                groups[j] = next_group
        next_group += 1

    return groups


def _label_groups(
    segments: list[tuple[int, int]],
    groups: list[int],
    chroma_bars: list["np.ndarray"],
    total_bars: int,
) -> list[Section]:
    """
    Atribui rótulos semânticos aos grupos.

    Heurísticas:
    - Primeiro segmento → Intro
    - Último segmento → Final
    - Grupo mais frequente (e mais energético) → Refrão
    - Segmentos do mesmo grupo recebem numeração sequencial
    """
    import numpy as np
    from collections import Counter

    n = len(segments)
    if n == 0:
        return []

    # Conta ocorrências por grupo (exceto primeiro e último)
    inner_groups = groups[1:-1] if n > 2 else groups
    counts = Counter(inner_groups)

    # Energia por grupo (RMS do chroma)
    group_energy: dict[int, float] = {}
    for i, (start, end) in enumerate(segments):
        g = groups[i]
        bars = chroma_bars[start-1:end-1]
        energy = float(np.mean([np.linalg.norm(c) for c in bars])) if bars else 0.0
        group_energy[g] = group_energy.get(g, 0.0) + energy

    # Refrão = grupo mais repetido entre os internos, desempatado por energia
    chorus_group = -1
    if counts:
        max_count = max(counts.values())
        candidates = [g for g, c in counts.items() if c == max_count]
        chorus_group = max(candidates, key=lambda g: group_energy.get(g, 0.0))

    # Constrói seções
    sections: list[Section] = []
    group_seq: dict[int, int] = {}  # contador de repetições por grupo

    for i, (start, end) in enumerate(segments):
        g = groups[i]
        group_seq[g] = group_seq.get(g, 0) + 1
        seq = group_seq[g]

        if i == 0:
            stype = "Intro"
        elif i == n - 1:
            stype = "Outro"
        elif g == chorus_group:
            stype = "Chorus"
        else:
            # Alternância simples para os restantes
            stype = "Verse" if (seq % 2 == 1) else "Bridge"

        base = PT_BR_LABEL.get(stype, stype)
        label = f"{base} {seq}" if seq > 1 else base

        sections.append(Section(
            type=stype,
            label=label,
            start_bar=start,
            end_bar=end,
        ))

    return sections
