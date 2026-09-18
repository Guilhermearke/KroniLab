"""
Lógica de inferência reutilizável entre providers.

Chunking com sobreposição (overlap-add): divide o áudio em pedaços de
`chunk_sec` segundos com `overlap_sec` de sobreposição. Cada chunk é
processado separadamente e os resultados são somados na região de
sobreposição com um fade linear.

Isso permite processar músicas longas sem estourar a VRAM e reduz
artefatos de borda.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np

log = logging.getLogger(__name__)


def separate_with_overlap(
    model_fn,
    audio: "np.ndarray",
    sr: int,
    stems: list[str],
    chunk_sec: float = 15.0,
    overlap_sec: float = 1.0,
) -> dict[str, "np.ndarray"]:
    """
    Aplica `model_fn` em chunks com overlap-add.

    Args:
        model_fn:    callable(chunk_np, sr) → dict[stem, np.ndarray]
        audio:       array [channels, samples] float32 normalizado
        sr:          taxa de amostragem (ex: 44100)
        stems:       lista de stems esperados na saída
        chunk_sec:   tamanho de cada chunk em segundos
        overlap_sec: sobreposição entre chunks em segundos

    Returns:
        dict[stem, np.ndarray] com os stems separados
    """
    import numpy as np

    chunk_size = int(chunk_sec * sr)
    overlap_size = int(overlap_sec * sr)
    hop_size = chunk_size - overlap_size
    n_samples = audio.shape[-1]
    n_ch = audio.shape[0] if audio.ndim == 2 else 1

    # Buffers de saída zerados
    outputs: dict[str, np.ndarray] = {
        s: np.zeros((n_ch, n_samples), dtype=np.float32) for s in stems
    }
    counts = np.zeros(n_samples, dtype=np.float32)

    # Janela de triangular para overlap suave
    fade = np.ones(chunk_size, dtype=np.float32)
    fade[:overlap_size] = np.linspace(0, 1, overlap_size)
    fade[-overlap_size:] = np.linspace(1, 0, overlap_size)

    start = 0
    chunk_idx = 0
    while start < n_samples:
        end = min(start + chunk_size, n_samples)
        chunk = audio[:, start:end] if audio.ndim == 2 else audio[start:end]

        # Pad até chunk_size se o último pedaço for menor
        pad = chunk_size - (end - start)
        if pad > 0:
            chunk = np.pad(chunk, ((0, 0), (0, pad)) if chunk.ndim == 2 else (0, pad))

        try:
            chunk_out = model_fn(chunk, sr)
        except Exception as exc:
            log.error("Erro no chunk %d (start=%d): %s", chunk_idx, start, exc)
            # Continua com zeros — não derruba o job por um chunk ruim
            chunk_out = {s: np.zeros_like(chunk) for s in stems}

        seg_len = end - start
        w = fade[:seg_len]
        for stem in stems:
            stem_chunk = chunk_out.get(stem, np.zeros_like(chunk))
            stem_seg = stem_chunk[:, :seg_len] if stem_chunk.ndim == 2 else stem_chunk[:seg_len]
            outputs[stem][:, start:end] += stem_seg * w
        counts[start:end] += w

        start += hop_size
        chunk_idx += 1

    # Normaliza pelo peso acumulado
    counts = np.maximum(counts, 1e-8)
    for stem in stems:
        outputs[stem] /= counts[np.newaxis, :]

    return outputs
