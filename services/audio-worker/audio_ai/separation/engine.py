"""
Interface abstrata do Kroni Separation Engine.

O resto do sistema (pipeline, API, testes) só conhece SeparationEngine e
StemResult — nunca importa BS-RoFormer ou qualquer outra implementação
diretamente. Isso permite:

  Hoje:  SeparationEngine ← BSRoFormerEngine (checkpoint público)
  Amanhã: SeparationEngine ← KroniWorshipEngine (pesos próprios treinados)

Sem alterar uma linha fora deste pacote.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


# Stems suportados em cada layout.
STEMS_FOUR: tuple[str, ...] = ("vocals", "drums", "bass", "other")
STEMS_SIX: tuple[str, ...] = ("vocals", "drums", "bass", "guitar", "keys", "other")


@dataclass
class StemResult:
    """Resultado de uma separação de stems."""

    # {"vocals": Path("/work/stems/vocals.wav"), ...}
    stems: dict[str, Path] = field(default_factory=dict)
    # "four" | "six" — layout do modelo usado
    layout: str = "four"
    # Nome do engine/modelo que gerou o resultado
    model_name: str = "unknown"
    # Versão do checkpoint
    model_version: str = "unknown"
    # Flag para o pipeline saber que é resultado de cache/mock
    provider: str = "unknown"


class SeparationEngine(ABC):
    """
    Interface que todo provider de separação de stems deve implementar.

    Regras:
    - `separate()` é síncrono: o caller roda em thread/processo separado.
    - `separate()` nunca modifica o arquivo `source`.
    - `out_dir` pode não existir; o engine deve criá-lo se necessário.
    - Exceções propagam normalmente; o pipeline decide se faz fallback.
    """

    #: Nome único do engine (usado no registry e no banco).
    name: str = "base"

    @abstractmethod
    def available(self) -> bool:
        """True se o engine pode rodar no ambiente atual (GPU, dependências...)."""

    @abstractmethod
    def separate(self, source: Path, out_dir: Path) -> StemResult:
        """
        Separa `source` em stems e salva em `out_dir`.

        Args:
            source: Arquivo de áudio normalizado (WAV 44.1 kHz estéreo).
            out_dir: Diretório de saída (criado pelo engine se não existir).

        Returns:
            StemResult com os caminhos dos stems gerados.
        """
