"""Configuracao do worker. Tudo por env — a imagem de GPU e efemera."""
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Storage (Cloudflare R2, API S3)
    r2_endpoint: str = ""
    r2_bucket: str = "levita"
    r2_access_key: str = ""
    r2_secret_key: str = ""

    # Supabase
    supabase_url: str = ""
    supabase_service_key: str = ""

    # Fila
    redis_url: str = "redis://localhost:6379/0"
    queue_name: str = "levita:audio-jobs"

    # Separacao: 'demucs' (GPU), 'replicate' (API) ou 'mock' (dev/CI)
    separation_provider: str = "mock"
    separation_model: str = "htdemucs_6s"
    # Se o modelo nao der qualidade em guitarra/keys, cai para 4 stems.
    stem_layout: str = "six"

    # A GPU nao fica ligada 24h: o worker sobe, drena a fila e morre.
    idle_shutdown_seconds: int = 300

    work_dir: str = "/tmp/levita"

    class Config:
        env_prefix = "LEVITA_"


@lru_cache
def get_settings() -> Settings:
    return Settings()
