"""
Processo do worker de GPU.

Sobe, drena a fila, e desliga sozinho depois de `idle_shutdown_seconds` sem
trabalho. E isso que mantem o custo de GPU sob controle (item 31).
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

from .config import get_settings
from .models import ProcessingState
from .pipeline.run import PipelineDeps, run_pipeline
from .queue import MemoryQueue, RedisQueue
from .storage import LocalStorage, R2Storage

log = logging.getLogger("kronilab.worker")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()

    queue = RedisQueue(settings.redis_url, settings.queue_name) if settings.redis_url else MemoryQueue()
    storage = (
        R2Storage(settings.r2_endpoint, settings.r2_bucket, settings.r2_access_key, settings.r2_secret_key)
        if settings.r2_endpoint
        else LocalStorage(Path(settings.work_dir) / "storage")
    )
    deps = PipelineDeps(
        provider_name=settings.separation_provider,
        work_dir=Path(settings.work_dir),
        upload=storage.upload,
    )

    idle_since = time.time()
    while True:
        job = queue.pop(timeout=30)
        if job is None:
            if time.time() - idle_since > settings.idle_shutdown_seconds:
                log.info("fila vazia ha %ss — desligando", settings.idle_shutdown_seconds)
                return
            continue

        idle_since = time.time()
        log.info("processando song=%s", job.song_id)
        try:
            run_pipeline(job, deps, on_progress=lambda s, p: log.info("  %s %.0f%%", s.value, p * 100))
            log.info("song=%s pronta", job.song_id)
        except Exception:
            log.exception("song=%s falhou", job.song_id)
            # Falha e estado do job, nao crash do worker: a fila continua.
            _mark_failed(job.song_id)


def _mark_failed(song_id: str) -> None:
    log.error("job marcado como %s para song=%s", ProcessingState.failed.value, song_id)


if __name__ == "__main__":
    main()
