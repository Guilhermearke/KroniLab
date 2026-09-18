"""
Detecção de tom (key detection) via Krumhansl-Schmuckler.

Isolado do pipeline para poder ser testado sem áudio.
"""
from __future__ import annotations

# Perfis Krumhansl-Schmuckler — correlação com escala maior/menor
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
PITCH_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]


def detect_key(chroma_mean: list[float]) -> tuple[str, str, float]:
    """
    Tom, modo e confiança a partir do chroma médio.

    Returns:
        ("G", "major", 0.91)
    """
    best: tuple[str, str, float] = ("C", "major", -1.0)
    scores: list[float] = []

    for tonic in range(12):
        for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
            rotated = [profile[(i - tonic) % 12] for i in range(12)]
            score = _pearson(chroma_mean, rotated)
            scores.append(score)
            if score > best[2]:
                best = (PITCH_NAMES[tonic], mode, score)

    scores.sort(reverse=True)
    margin = (scores[0] - scores[1]) if len(scores) > 1 else 0.0
    confidence = max(0.0, min(1.0, 0.5 + margin * 2))
    return best[0], best[1], round(confidence, 3)


def _pearson(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    ma = sum(a[:n]) / n
    mb = sum(b[:n]) / n
    num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    da = (sum((a[i] - ma) ** 2 for i in range(n))) ** 0.5
    db = (sum((b[i] - mb) ** 2 for i in range(n))) ** 0.5
    return num / (da * db) if da and db else 0.0
