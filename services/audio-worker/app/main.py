"""
API do processamento de audio.

Fica entre o app e a GPU: recebe o upload, responde na hora com um job e deixa
o worker fazer o trabalho pesado. O app acompanha por polling ou Realtime.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .config import get_settings
from .models import JobRequest, JobStatus, ProcessingState
from .pipeline.fingerprint import sha256_file
from .queue import MemoryQueue

app = FastAPI(title="KroniLab Audio Worker", version="0.1.0")
settings = get_settings()
queue = MemoryQueue()
_jobs: dict[str, JobStatus] = {}

ALLOWED = {".mp3", ".wav", ".m4a", ".aac", ".flac"}


@app.get("/health")
def health() -> dict:
    return {"ok": True, "queue_depth": queue.depth(), "provider": settings.separation_provider}


@app.post("/jobs", response_model=JobStatus)
async def create_job(
    song_id: str = Form(...),
    church_id: str = Form(...),
    click_sound: str = Form("digital"),
    file: UploadFile = File(...),
) -> JobStatus:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(400, f"Formato nao suportado: {suffix or 'desconhecido'}")

    work = Path(settings.work_dir) / "uploads"
    work.mkdir(parents=True, exist_ok=True)
    target = work / f"{uuid.uuid4()}{suffix}"
    with open(target, "wb") as fh:
        while chunk := await file.read(1024 * 1024):
            fh.write(chunk)

    job_id = str(uuid.uuid4())
    # O hash sai aqui para o app ja saber se e duplicata antes de gastar GPU.
    sha = sha256_file(target)
    queue.push(JobRequest(
        song_id=song_id, church_id=church_id, source_path=str(target),
        filename=file.filename or target.name, click_sound=click_sound,
    ))
    status = JobStatus(job_id=job_id, song_id=song_id, state=ProcessingState.queued, progress=0.0)
    _jobs[job_id] = status
    return status


@app.get("/jobs/{job_id}", response_model=JobStatus)
def get_job(job_id: str) -> JobStatus:
    status = _jobs.get(job_id)
    if status is None:
        raise HTTPException(404, "Job nao encontrado")
    return status
