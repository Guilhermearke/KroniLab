"""
Importacao a partir de um link.

O que ENTRA daqui e metadado: titulo e autor, para a musica ja nascer
identificada e para a deduplicacao ter com que trabalhar. O AUDIO nao vem do
link — ele e enviado pela igreja, que e quem tem (ou compra) o direito de usar
aquela gravacao.

Essa fronteira e deliberada: extrair o audio de um link copiaria a gravacao
original e violaria os termos da plataforma. O produto nao pode ser construido
em cima disso.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"}


@dataclass
class LinkMetadata:
    title: str
    artist: str | None
    source: str
    source_id: str | None
    thumbnail_url: str | None


def video_id(url: str) -> str | None:
    """Extrai o id do video, aceitando as formas curtas e longas."""
    parsed = urlparse(url)
    if parsed.hostname not in YOUTUBE_HOSTS:
        return None
    if parsed.hostname == "youtu.be":
        return parsed.path.lstrip("/") or None
    if parsed.path.startswith("/shorts/"):
        return parsed.path.split("/")[2] if len(parsed.path.split("/")) > 2 else None
    values = parse_qs(parsed.query).get("v")
    return values[0] if values else None


def split_title(raw: str, channel: str | None) -> tuple[str, str | None]:
    """
    Separa "Artista - Musica (Ao Vivo)" em artista e titulo.
    Quando nao da para separar com seguranca, devolve o titulo inteiro e o
    canal como artista — chutar errado e pior do que nao chutar.
    """
    cleaned = re.sub(r"\s*[\(\[](ao vivo|oficial|official|lyric[s]?|clipe|video)[^\)\]]*[\)\]]",
                     "", raw, flags=re.I).strip()
    for sep in (" - ", " – ", " — ", " | "):
        if sep in cleaned:
            left, right = cleaned.split(sep, 1)
            return right.strip(), left.strip()
    return cleaned, channel


async def fetch_link_metadata(url: str) -> dict:
    """
    Busca titulo e autor pelo oEmbed publico. Nao baixa midia, nao precisa de
    chave e nao burla nada: e a mesma informacao que um link colado mostra.
    """
    # httpx entra aqui e so aqui: assim as funcoes puras acima continuam
    # importaveis e testaveis sem nenhuma dependencia de rede.
    import httpx

    vid = video_id(url)
    if vid is None:
        raise ValueError("Link nao reconhecido. Cole um link do YouTube.")

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={vid}", "format": "json"},
        )
    if response.status_code == 404:
        raise ValueError("Video nao encontrado ou privado.")
    response.raise_for_status()
    data = response.json()

    title, artist = split_title(data.get("title", ""), data.get("author_name"))
    return {
        "title": title,
        "artist": artist,
        "source": "youtube",
        "source_id": vid,
        "thumbnail_url": data.get("thumbnail_url"),
        # A igreja ainda precisa enviar o audio: o link identifica a musica,
        # nao entrega a gravacao.
        "needs_audio_upload": True,
    }
