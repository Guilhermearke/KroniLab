"""
Registry de engines de separação.

O pipeline chama `get_engine(name)` e nunca instancia engines diretamente.
Isso centraliza a lógica de fallback:

  "bs_roformer" → BSRoFormerEngine
    ↓ se não disponível (sem GPU, sem checkpoint)
  "mock"        → MockEngine
"""
from __future__ import annotations

import logging

from .engine import SeparationEngine
from .providers.mock import MockEngine
from .providers.bs_roformer import BSRoFormerEngine
from .providers.replicate import ReplicateEngine

log = logging.getLogger(__name__)


def get_engine(name: str, **kwargs) -> SeparationEngine:
    """
    Retorna o engine solicitado, com fallback automático para MockEngine.

    Args:
        name: "bs_roformer" | "replicate" | "mock"

    Returns:
        Instância de SeparationEngine pronta para usar.
    """
    engine: SeparationEngine

    if name == "bs_roformer":
        engine = BSRoFormerEngine()
        if not engine.available():
            log.warning(
                "BSRoFormerEngine não disponível — usando MockEngine. "
                "Defina KRONILAB_BSROFORMER_CKPT e KRONILAB_BSROFORMER_CFG "
                "e instale torch para ativar a separação real."
            )
            engine = MockEngine(**kwargs)

    elif name == "replicate":
        engine = ReplicateEngine(**kwargs)
        if not engine.available():
            log.warning("ReplicateEngine não disponível — usando MockEngine.")
            engine = MockEngine(**kwargs)

    else:
        # "mock" explícito ou nome desconhecido
        if name != "mock":
            log.warning("Engine desconhecido '%s' — usando MockEngine.", name)
        engine = MockEngine(**kwargs)

    return engine
