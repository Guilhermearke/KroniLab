"""Contratos do worker. Espelham packages/core/src/types.ts."""
from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class ProcessingState(str, Enum):
    queued = "queued"
    preparing = "preparing"
    separating = "separating"
    analyzing = "analyzing"
    generating_click = "generating_click"
    generating_guide = "generating_guide"
    uploading = "uploading"
    completed = "completed"
    failed = "failed"


StemId = Literal["vocals", "drums", "bass", "guitar", "keys", "other", "click", "guide"]
SectionType = Literal[
    "Intro", "Verse", "PreChorus", "Chorus", "Bridge",
    "Instrumental", "Solo", "Break", "Outro",
]


class Beat(BaseModel):
    index: int
    bar: int
    beat: int
    timestamp: float
    downbeat: bool


class TempoSegment(BaseModel):
    start_time: float
    bpm: float


class Section(BaseModel):
    type: SectionType
    label: str
    start_bar: int
    end_bar: int


class GuideCue(BaseModel):
    bar: int
    text: str


class Analysis(BaseModel):
    key: str
    mode: Literal["major", "minor"]
    key_confidence: float = Field(ge=0, le=1)
    bpm: float
    bpm_confidence: float = Field(ge=0, le=1)
    beats_per_bar: int = 4
    beat_unit: int = 4


class StemFile(BaseModel):
    stem: StemId
    path: str
    bytes: int
    sha256: str


class JobRequest(BaseModel):
    song_id: str
    church_id: str
    source_path: str
    filename: str
    click_sound: Literal["cowbell", "digital", "wood"] = "digital"
    generate_guide: bool = True


class JobResult(BaseModel):
    song_id: str
    sha256: str
    duration_sec: float
    deduplicated: bool = False
    analysis: Analysis | None = None
    beats: list[Beat] = []
    tempo_map: list[TempoSegment] = []
    sections: list[Section] = []
    guide_cues: list[GuideCue] = []
    stems: list[StemFile] = []
    waveforms: dict[str, list[float]] = {}


class JobStatus(BaseModel):
    job_id: str
    song_id: str
    state: ProcessingState
    progress: float = 0.0
    error: str | None = None
