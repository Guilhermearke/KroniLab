"""
Orquestração do pipeline de processamento de áudio.

Upload → normalização → hash → dedup → stems (SeparationEngine) →
beat tracking variável → tom → seções → click → guia → waveforms → upload.

Cada etapa reporta estado e progresso: o app mostra "Separando instrumentos"
em tempo real, não uma barra falsa.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..models import (
    Analysis, Beat as BeatModel, GuideCue, JobRequest, JobResult,
    ProcessingState, Section as SectionModel, StemFile, TempoSegment,
)
from .fingerprint import sha256_file
from .grid import click_events, guide_cues, snap_sections, build_grid
from .render import compute_peaks, render_click, render_guide

# Importa do novo módulo audio_ai
from audio_ai.separation.registry import get_engine
from audio_ai.analysis.tempo import beat_track_variable, build_tempo_map, average_bpm
from audio_ai.analysis.sections import detect_sections
from audio_ai.analysis.key import detect_key

log = logging.getLogger(__name__)

ProgressFn = Callable[[ProcessingState, float], None]


@dataclass
class PipelineDeps:
    """Injetadas para o pipeline rodar em CI sem GPU, sem R2 e sem Supabase."""
    provider_name: str = "mock"
    work_dir: Path = Path("/tmp/kronilab")
    find_existing_by_hash: Callable[[str, str], JobResult | None] = lambda church, sha: None
    upload: Callable[[Path, str], str] = lambda path, key: f"local://{key}"
    click_sound: str = "digital"


def run_pipeline(
    job: JobRequest,
    deps: PipelineDeps,
    on_progress: ProgressFn = lambda s, p: None,
) -> JobResult:
    work = deps.work_dir / job.song_id
    work.mkdir(parents=True, exist_ok=True)

    # --- preparing: normaliza e identifica -----------------------------------
    on_progress(ProcessingState.preparing, 0.0)
    source = Path(job.source_path)
    normalized = normalize(source, work / "source.wav")
    sha = sha256_file(source)

    existing = deps.find_existing_by_hash(job.church_id, sha)
    if existing is not None:
        log.info("dedup hit sha=%s song=%s", sha[:12], job.song_id)
        on_progress(ProcessingState.completed, 1.0)
        return existing.model_copy(update={"song_id": job.song_id, "deduplicated": True})
    on_progress(ProcessingState.preparing, 1.0)

    # --- separating: BS-RoFormer ou mock -------------------------------------
    on_progress(ProcessingState.separating, 0.0)
    engine = get_engine(deps.provider_name)
    stem_result = engine.separate(normalized, work / "stems")
    log.info(
        "Separação concluída: engine=%s model=%s version=%s stems=%s",
        stem_result.provider, stem_result.model_name, stem_result.model_version,
        list(stem_result.stems.keys()),
    )
    on_progress(ProcessingState.separating, 1.0)

    # --- analyzing: beat tracking variável + tom + seções --------------------
    on_progress(ProcessingState.analyzing, 0.0)

    # Beat tracking com andamento variável (Ellis DP via librosa)
    beats = beat_track_variable(normalized)
    beats_per_bar = 4  # A maioria do louvor é 4/4
    duration_sec = _audio_duration(normalized)

    # Converte para o formato usado pelo restante do pipeline
    from .grid import Beat as GridBeat
    grid = [
        GridBeat(
            index=b.index, bar=b.bar, beat=b.beat,
            timestamp=b.timestamp, downbeat=b.downbeat,
        )
        for b in beats
    ]

    # Tom via chroma
    import librosa, numpy as np
    y, sr = librosa.load(str(normalized), mono=True, sr=None)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = np.mean(chroma, axis=1).tolist()
    key, mode, key_confidence = detect_key(chroma_mean)

    # Seções via auto-similaridade
    sections_raw = detect_sections(str(normalized), beats)
    sections = [
        type("Section", (), {
            "type": s.type, "label": s.label,
            "start_bar": s.start_bar, "end_bar": s.end_bar,
        })()
        for s in sections_raw
    ]

    # Tempo map (segmentos de BPM estável)
    tempo_segs = build_tempo_map(beats)
    bpm = average_bpm(beats)
    bpm_confidence = _beat_confidence(grid)

    on_progress(ProcessingState.analyzing, 1.0)

    # --- click ---------------------------------------------------------------
    on_progress(ProcessingState.generating_click, 0.0)
    click_path = render_click(
        click_events(grid), duration_sec, work / "click.wav", deps.click_sound
    )
    on_progress(ProcessingState.generating_click, 1.0)

    # --- guia ----------------------------------------------------------------
    cues = guide_cues(sections, grid)
    guide_path = None
    if job.generate_guide:
        on_progress(ProcessingState.generating_guide, 0.0)
        guide_path = render_guide(cues, grid, duration_sec, work / "guide.wav")
        on_progress(ProcessingState.generating_guide, 1.0)

    # --- upload --------------------------------------------------------------
    on_progress(ProcessingState.uploading, 0.0)
    files: dict[str, Path] = dict(stem_result.stems)
    files["click"] = click_path
    if guide_path:
        files["guide"] = guide_path

    stem_files: list[StemFile] = []
    waveforms: dict[str, list[float]] = {}
    for i, (stem, path) in enumerate(files.items()):
        key_r2 = f"songs/{job.song_id}/{stem}{path.suffix}"
        deps.upload(path, key_r2)
        stem_files.append(StemFile(
            stem=stem, path=key_r2,
            bytes=path.stat().st_size, sha256=sha256_file(path),
        ))
        try:
            waveforms[stem] = compute_peaks(path)
        except Exception as exc:
            log.warning("waveform falhou para %s: %s", stem, exc)
        on_progress(ProcessingState.uploading, (i + 1) / len(files))

    result = JobResult(
        song_id=job.song_id,
        sha256=sha,
        duration_sec=duration_sec,
        analysis=Analysis(
            key=key, mode=mode, key_confidence=key_confidence,
            bpm=bpm, bpm_confidence=bpm_confidence,
            beats_per_bar=beats_per_bar, beat_unit=4,
        ),
        beats=[BeatModel(**{
            "index": b.index, "bar": b.bar, "beat": b.beat,
            "timestamp": b.timestamp, "downbeat": b.downbeat,
        }) for b in beats],
        tempo_map=[TempoSegment(start_time=s["start_time"], bpm=s["bpm"]) for s in tempo_segs],
        sections=[
            SectionModel(
                type=s.type, label=s.label,
                start_bar=s.start_bar, end_bar=s.end_bar,
            )
            for s in sections_raw
        ],
        guide_cues=[GuideCue(**c) for c in cues],
        stems=stem_files,
        waveforms=waveforms,
        # Registro do modelo usado (para o Model Registry)
        model_name=stem_result.model_name,
        model_version=stem_result.model_version,
    )
    on_progress(ProcessingState.completed, 1.0)
    return result


def normalize(source: Path, out: Path) -> Path:
    """
    Converte para WAV 44.1 kHz estéreo e nivela o volume (loudnorm).

    Sem isso, MP3 de 128k e WAV de estúdio produzem análises diferentes
    para a mesma música — e a dedup por hash não ajuda.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    if shutil.which("ffmpeg") is None:
        shutil.copyfile(source, out)
        return out
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(source), "-ar", "44100", "-ac", "2",
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", str(out)],
        check=True, capture_output=True,
    )
    return out


def _audio_duration(path: Path) -> float:
    """Duração do áudio em segundos."""
    import soundfile as sf
    info = sf.info(str(path))
    return float(info.duration)


def _beat_confidence(grid) -> float:
    """Batida estável = confiança alta."""
    spans = [b.timestamp - a.timestamp for a, b in zip(grid, grid[1:])]
    if len(spans) < 4:
        return 0.0
    mean = sum(spans) / len(spans)
    if mean <= 0:
        return 0.0
    sd = (sum((s - mean) ** 2 for s in spans) / len(spans)) ** 0.5
    return round(max(0.0, min(1.0, 1 - (sd / mean) * 6)), 3)
