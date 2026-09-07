"""Persona registry: every available video-analysis persona.

Adding a persona is a data-only change: create a module exposing a
``PERSONA`` :class:`~reactor_video.spec.Persona` and register it here.
"""

from __future__ import annotations

from reactor_video.personas.bloomberg import PERSONA as BLOOMBERG
from reactor_video.personas.vanguard import PERSONA as VANGUARD
from reactor_video.spec import Persona

REGISTRY: dict[str, Persona] = {
    persona.key: persona for persona in (BLOOMBERG, VANGUARD)
}


def get_persona(key: str) -> Persona:
    """Return the registered persona for ``key`` (case-insensitive).

    Raises:
        KeyError: Naming the unknown key and the available alternatives.
    """
    try:
        return REGISTRY[key.lower()]
    except KeyError:
        raise KeyError(
            f"unknown persona {key!r}; available: {', '.join(available_personas())}"
        ) from None


def available_personas() -> list[str]:
    """Return the sorted registry keys."""
    return sorted(REGISTRY)
