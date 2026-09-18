"""
Orquestracao do pipeline (itens 6 e 30).

Upload -> normalizacao -> hash -> dedup -> stems -> analise -> beat grid ->
BPM -> compasso -> tom -> secoes -> click -> guia -> waveforms -> persistencia.

Cada etapa publica estado e progresso: o app mostra "Separando instrumentos"
em tempo real, nao uma barra falsa.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..models import Analysis, Beat as BeatModel, GuideCue, JobRequest, JobResult, ProcessingState, Section as SectionModel, StemFile, TempoSegment
from .analysis import analyze, label_boundaries
from .fingerprint import sha256_file
from .grid import click_events, guide_cues, snap_sections
from .render import compute_peaks, render_click, render_guide
from .separation import get_provider

log = logging.getLogger(__name__)

ProgressFn = Callable[[ProcessingState, float], None]


@dataclass
class PipelineDeps:
    """Injetadas para o pipeline rodar em CI sem GPU, sem R2 e sem Supabase."""
    provider_name: str = "mock"
    work_dir: Path = Path("/tmp/levita")
    find_existing_by_hash: Callable[[str, str], JobResult | None] = lambda church, sha: None
    upload: Callable[[Path, str], str] = lambda path, key: f"local://{key}"
    click_sound: str = "digital"


def run_pipeline(job: JobRequest, deps: PipelineDeps, on_progress: ProgressFn = lambda s, p: None) -> JobResult:
    work = deps.work_dir / job.song_id
    work.mkdir(parents=True, exist_ok=True)

    # --- preparing: normaliza e identifica -----------------------------------
    on_progress(ProcessingState.preparing, 0.0)
    source = Path(job.source_path)
    normalized = normalize(source, work / "source.wav")
    sha = sha256_file(source)

    existing = deps.find_existing_by_hash(job.church_id, sha)
    if existing is not None:
        # Mesmo audio ja processado nesta igreja: reaproveita tudo.
        log.info("dedup hit sha=%s song=%s", sha[:12], job.song_id)
        on_progress(ProcessingState.completed, 1.0)
        return existing.model_copy(update={"song_id": job.song_id, "deduplicated": True})
    on_progress(ProcessingState.preparing, 1.0)

    # --- separating ----------------------------------------------------------
    on_progress(ProcessingState.separating, 0.0)
    provider = get_provider(deps.provider_name)
    stems = provider.separate(normalized, work / "stems")
    on_progress(ProcessingState.separating, 1.0)

    # --- analyzing -----------------------------------------------------------
    on_progress(ProcessingState.analyzing, 0.0)
    a = analyze(normalized)
    grid = a["grid"]
    sections = snap_sections(label_boundaries(a["boundary_times"], a["duration"]), grid)
    on_progress(ProcessingState.analyzing, 1.0)

    # --- click ---------------------------------------------------------------
    on_progress(ProcessingState.generating_click, 0.0)
    click_path = render_click(click_events(grid), a["duration"], work / "click.wav", deps.click_sound)
    on_progress(ProcessingState.generating_click, 1.0)

    # --- guia ----------------------------------------------------------------
    cues = guide_cues(sections, grid)
    guide_path = None
    if job.generate_guide:
        on_progress(ProcessingState.generating_guide, 0.0)
        guide_path = render_guide(cues, grid, a["duration"], work / "guide.wav")
        on_progress(ProcessingState.generating_guide, 1.0)

    # --- upload --------------------------------------------------------------
    on_progress(ProcessingState.uploading, 0.0)
    files: dict[str, Path] = dict(stems.paths)
    files["click"] = click_path
    if guide_path:
        files["guide"] = guide_path

    stem_files: list[StemFile] = []
    waveforms: dict[str, list[float]] = {}
    for i, (stem, path) in enumerate(files.items()):
        key = f"songs/{job.song_id}/{stem}{path.suffix}"
        deps.upload(path, key)
        stem_files.append(StemFile(
            stem=stem, path=key, bytes=path.stat().st_size, sha256=sha256_file(path)
        ))
        try:
            waveforms[stem] = compute_peaks(path)
        except Exception as exc:  # waveform e cosmetico: nunca derruba o job
            log.warning("waveform falhou para %s: %s", stem, exc)
        on_progress(ProcessingState.uploading, (i + 1) / len(files))

    result = JobResult(
        song_id=job.song_id,
        sha256=sha,
        duration_sec=a["duration"],
        analysis=Analysis(
            key=a["key"], mode=a["mode"], key_confidence=a["key_confidence"],
            bpm=a["bpm"], bpm_confidence=a["bpm_confidence"],
            beats_per_bar=a["beats_per_bar"], beat_unit=4,
        ),
        beats=[BeatModel(**b.dict()) for b in grid],
        tempo_map=[TempoSegment(**s) for s in a["tempo_map"]],
        sections=[SectionModel(type=s.type, label=s.label, start_bar=s.start_bar, end_bar=s.end_bar) for s in sections],
        guide_cues=[GuideCue(**c) for c in cues],
        stems=stem_files,
        waveforms=waveforms,
    )
    on_progress(ProcessingState.completed, 1.0)
    return result


def normalize(source: Path, out: Path) -> Path:
    """
    Converte para WAV mono-preservado 44.1k e nivela o volume.

    Sem isso, MP3 de 128k e WAV de estudio produzem analises diferentes para a
    mesma musica — e a dedup por hash nao ajuda quando o arquivo e outro.
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
