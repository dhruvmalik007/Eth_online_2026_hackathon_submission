"""Core specification types shared by personas and the analysis engine.

A :class:`Persona` is a frozen, self-describing bundle that couples one
reference video to the ordered list of :class:`Task` jobs that analyze it.
Personas are pure data — prompts, model fallback chains, and output artifact
names — while :mod:`reactor_video.engine` owns execution. Mirroring the
Rust CLI's typed command specs, every field is statically typed, validated
at construction time, and documented so that adding a persona is a
data-only change.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Callable

_SAFE_FILENAME_BAD_CHARS = ("/", "\\", "\x00")


class TaskKind(str, Enum):
    """Response post-processing contract of a task.

    Values double as stable identifiers in logs and manifests; the string
    subclass keeps serialization (``TaskKind.JSON.value == "json"``) trivial.
    """

    MARKDOWN = "markdown"
    """Free-form response, persisted verbatim under a provenance header."""

    JSON = "json"
    """Response parsed as JSON (with truncation salvage) and pretty-printed."""


@dataclass(frozen=True)
class Task:
    """A single Gemini generation job inside a persona's pipeline.

    Attributes:
        name: Human-readable task name, used in progress logs and in the
            provenance header of Markdown artifacts.
        prompt: Full instruction sent to the model alongside the video part.
        output_filename: Artifact file name, relative to the persona's output
            directory. Must be a flat name (no path separators).
        kind: Post-processing contract applied to the model response. Accepts
            a :class:`TaskKind` member or its string value; stored as the
            enum member either way.
        temperature: Sampling temperature forwarded to Gemini.
        max_output_tokens: Response budget forwarded to Gemini.
        response_mime_type: Optional response MIME constraint, e.g.
            ``"application/json"`` to force JSON-shaped output.
        skip_if_exists: Skip execution when the artifact already exists and is
            non-trivial (> 1 KiB). Used to make expensive passes idempotent.
        save_raw: Additionally persist the un-parsed model response next to the
            artifact as ``<stem>_raw.txt``. Raw output is source data and must
            never be lost to a parse failure.

    Raises:
        ValueError: If the field combination is inconsistent (empty name or
            prompt, nested output path, out-of-range temperature, or
            ``save_raw`` on a non-JSON task).
    """

    name: str
    prompt: str
    output_filename: str
    kind: TaskKind = TaskKind.MARKDOWN
    temperature: float = 0.2
    max_output_tokens: int = 8192
    response_mime_type: str | None = None
    skip_if_exists: bool = False
    save_raw: bool = False

    def __post_init__(self) -> None:
        """Normalize ``kind`` to a :class:`TaskKind`, then validate.

        Accepts the raw string form (``"json"``) for authoring convenience —
        ``TaskKind`` is a ``str`` enum, so both spellings hash and compare
        identically — but stores the enum member so downstream checks can
        use identity comparison.
        """
        if not isinstance(self.kind, TaskKind):
            try:
                object.__setattr__(self, "kind", TaskKind(self.kind))
            except ValueError as exc:
                raise ValueError(
                    f"Task {self.name!r}: unknown kind {self.kind!r}; "
                    f"expected one of {[k.value for k in TaskKind]}"
                ) from exc
        self.validate()

    def validate(self) -> None:
        """Check the task's own invariants at construction time.

        Failing fast here means a malformed persona surfaces as an obvious
        construction error instead of a confusing mid-run API failure.

        Raises:
            ValueError: Describing the first violated invariant.
        """
        if not self.name.strip():
            raise ValueError("Task.name must not be empty")
        if not self.prompt.strip():
            raise ValueError(f"Task {self.name!r}: prompt must not be empty")
        if not self.output_filename or any(
            ch in self.output_filename for ch in _SAFE_FILENAME_BAD_CHARS
        ):
            raise ValueError(
                f"Task {self.name!r}: output_filename must be a flat file name, "
                f"got {self.output_filename!r}"
            )
        if not 0.0 <= self.temperature <= 2.0:
            raise ValueError(
                f"Task {self.name!r}: temperature {self.temperature} outside [0, 2]"
            )
        if self.max_output_tokens <= 0:
            raise ValueError(
                f"Task {self.name!r}: max_output_tokens must be positive"
            )
        if self.save_raw and self.kind is not TaskKind.JSON:
            raise ValueError(
                f"Task {self.name!r}: save_raw is only meaningful for JSON tasks"
            )


@dataclass(frozen=True)
class Persona:
    """A named analysis persona bound to one reference video.

    Attributes:
        key: Stable registry key (lowercase slug), e.g. ``"bloomberg"``.
        title: Display name used in report headers.
        description: One-paragraph summary of the video and the analysis it
            produces; rendered by ``--list-personas``.
        gcs_uri: Default video asset as a Google Cloud Storage URI.
        mime_type: MIME type of the video asset (e.g. ``"video/quicktime"``).
        models: Ordered Gemini model fallback chain; the first model that
            answers wins (see :func:`reactor_video.engine.generate_with_fallback`).
        tasks: Ordered pipeline of :class:`Task` jobs.
        normalize_manifest: Optional post-processor for JSON task results,
            invoked as ``fn(data, gcs_uri=..., model=...) -> dict``. Used to
            coerce free-form model JSON into a stable manifest shape.
    """

    key: str
    title: str
    description: str
    gcs_uri: str
    mime_type: str
    models: tuple[str, ...]
    tasks: tuple[Task, ...]
    normalize_manifest: Callable[..., dict] | None = None

    def planned_outputs(self, out_dir: Path) -> tuple[Path, ...]:
        """Return the artifact paths this persona would write under ``out_dir``.

        Pure path arithmetic — no filesystem access — which is what makes the
        CLI's ``--dry-run`` possible without touching GCP.
        """
        return tuple(out_dir / task.output_filename for task in self.tasks)

    def validate(self) -> None:
        """Check cross-task invariants that a lone :class:`Task` cannot see.

        Guarantees the persona is runnable: a non-empty model fallback chain,
        at least one task, and no two tasks writing the same artifact (a later
        task would silently overwrite an earlier one).

        Raises:
            ValueError: On the first violated invariant, naming the persona.
        """
        if not self.key or self.key != self.key.lower().strip():
            raise ValueError(f"Persona key must be a lowercase slug, got {self.key!r}")
        if not self.models:
            raise ValueError(f"Persona {self.key!r} needs at least one fallback model")
        if not self.tasks:
            raise ValueError(f"Persona {self.key!r} needs at least one task")
        filenames = [task.output_filename for task in self.tasks]
        duplicates = {name for name in filenames if filenames.count(name) > 1}
        if duplicates:
            raise ValueError(
                f"Persona {self.key!r}: duplicate output artifacts {sorted(duplicates)}"
            )
