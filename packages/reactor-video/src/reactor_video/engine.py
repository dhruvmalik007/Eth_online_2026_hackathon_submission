"""Gemini/Vertex analysis engine shared by every persona.

The engine owns everything personas deliberately do not: client
construction, model fallback, response post-processing, and artifact
persistence. The Google GenAI import is deferred so that metadata-only
paths (``--list-personas``, ``--dry-run``, tests) work without the
dependency — and without GCP credentials — installed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from reactor_video.spec import Persona, Task, TaskKind

DEFAULT_PROJECT_ID = "ultimate3dreconstructionstack"
DEFAULT_LOCATION = "us-central1"
_SKIP_IF_EXISTS_MIN_BYTES = 1_000


def _genai():
    """Import and return ``(genai, types)`` lazily.

    Deferral keeps the package importable (and testable) on machines without
    the dependency; this is the only place that pays the import cost.

    Returns:
        The ``google.genai`` module and its ``types`` namespace.

    Raises:
        ImportError: With actionable setup guidance when ``google-genai`` is
            missing; follow the GCP setup section of the package README.
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:
        raise ImportError(
            "google-genai is required to run analysis. Install it with "
            "`pip install -e packages/reactor-video`, then complete the GCP "
            "setup in packages/reactor-video/README.md "
            "(gcloud init, enable aiplatform.googleapis.com, "
            "gcloud auth application-default login)."
        ) from exc
    return genai, types


def default_project_id() -> str:
    """Return the GCP project id, honoring ``REACTOR_GCP_PROJECT``."""
    return os.environ.get("REACTOR_GCP_PROJECT", DEFAULT_PROJECT_ID)


def default_location() -> str:
    """Return the GCP location, honoring ``REACTOR_GCP_LOCATION``."""
    return os.environ.get("REACTOR_GCP_LOCATION", DEFAULT_LOCATION)


def parse_json_block(text: str):
    """Extract the first JSON object/array from a Gemini response string.

    Models frequently wrap JSON in Markdown fences even when asked not to;
    this tolerates them.

    Raises:
        json.JSONDecodeError: If the response is not valid JSON after fence
            stripping.
    """
    text = text.strip()
    if text.startswith("```"):
        lines = [ln for ln in text.splitlines() if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()
    return json.loads(text)


def salvage_json(text: str):
    """Best-effort recovery of the first complete JSON value from a response.

    Long manifests can hit the token ceiling mid-object; this walks the text
    backwards and returns the shortest prefix that parses. Used only after
    :func:`parse_json_block` fails.

    Raises:
        ValueError: If no prefix parses — the raw text is still saved by the
            caller whenever the task sets ``save_raw``.
    """
    for cut in range(len(text), 0, -1):
        try:
            return json.loads(text[:cut])
        except Exception:  # noqa: BLE001 - any decode failure means "keep cutting"
            continue
    raise ValueError("Could not salvage any JSON from model output")


def generate_with_fallback(client, types, contents, models: tuple[str, ...], config):
    """Call the first Gemini model in ``models`` that answers successfully.

    Model names churn on the Gemini API; a static fallback chain makes the
    pipeline resilient without config changes.

    Args:
        client: Initialized ``google.genai`` client.
        types: The ``google.genai.types`` namespace.
        contents: Multimodal request contents (video part + prompt).
        models: Ordered model names to attempt.
        config: ``types.GenerateContentConfig`` for every attempt.

    Returns:
        Tuple ``(model_name, response)`` for the first successful model.

    Raises:
        RuntimeError: If every model fails; the last error is attached.
    """
    last_err: Exception | None = None
    for model_name in models:
        try:
            print(f"  -> trying model: {model_name}")
            resp = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=config,
            )
            return model_name, resp
        except Exception as exc:  # noqa: BLE001 - fallback must survive any API error
            last_err = exc
            print(f"  -> {model_name} failed: {exc}")
    raise RuntimeError(f"All Gemini models failed. Last error: {last_err}")


def run_persona(
    persona: Persona,
    out_dir: Path,
    gcs_uri: str | None = None,
    project_id: str | None = None,
    location: str | None = None,
) -> list[Path]:
    """Execute every task of ``persona`` against its video.

    Runs the tasks in declared order, applies each task's post-processing
    contract (:class:`TaskKind`), and writes artifacts into ``out_dir``.

    Args:
        persona: The persona to execute (validated before any API call).
        out_dir: Directory that receives the persona's artifacts; created on
            demand.
        gcs_uri: Overrides the persona's default video asset.
        project_id: GCP project; falls back to ``REACTOR_GCP_PROJECT``.
        location: GCP location; falls back to ``REACTOR_GCP_LOCATION``.

    Returns:
        The artifact paths written by this run (skipped tasks excluded).

    Raises:
        RuntimeError: If any task exhausts its model fallback chain.
        ValueError: If the persona fails cross-field validation.
    """
    persona.validate()
    genai, types = _genai()
    resolved_project = project_id or default_project_id()
    resolved_location = location or default_location()
    client = genai.Client(
        vertexai=True, project=resolved_project, location=resolved_location
    )
    uri = gcs_uri or persona.gcs_uri
    print(
        f"[{persona.key}] initialized Gemini client "
        f"(project={resolved_project}, location={resolved_location})"
    )
    print(f"[{persona.key}] video: {uri}")

    video_part = types.Part.from_uri(file_uri=uri, mime_type=persona.mime_type)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    for task in persona.tasks:
        target = out_dir / task.output_filename
        if task.skip_if_exists and target.exists() and target.stat().st_size > _SKIP_IF_EXISTS_MIN_BYTES:
            print(f"[{persona.key}] skip {task.name} (already present: {target})")
            continue
        print(f"[{persona.key}] running {task.name} ...")
        model_used, resp = generate_with_fallback(
            client,
            types,
            [video_part, task.prompt],
            persona.models,
            types.GenerateContentConfig(
                temperature=task.temperature,
                max_output_tokens=task.max_output_tokens,
                response_mime_type=task.response_mime_type,
            ),
        )
        if task.kind is TaskKind.JSON:
            content = _render_json_artifact(
                persona, task, out_dir, resp.text, gcs_uri=uri, model_used=model_used
            )
        else:
            content = _render_markdown_artifact(persona, task, resp.text, gcs_uri=uri, model_used=model_used)
        target.write_text(content)
        written.append(target)
        print(f"[{persona.key}] saved {target}")
    return written


def _render_markdown_artifact(
    persona: Persona, task: Task, text: str, gcs_uri: str, model_used: str
) -> str:
    """Prepend a provenance header to a Markdown response.

    Every Markdown artifact records which model produced it and from which
    video, so downstream consumers can trace the analysis provenance.
    """
    header = (
        f"# {persona.title} — {task.name}\n\n"
        f"_Model: {model_used} | Video: {gcs_uri}_\n\n---\n\n"
    )
    return header + text


def _render_json_artifact(
    persona: Persona,
    task: Task,
    out_dir: Path,
    text: str,
    gcs_uri: str,
    model_used: str,
) -> str:
    """Parse, normalize, and pretty-print a JSON response.

    The un-parsed model output is persisted next to the artifact when
    ``save_raw`` is set — raw model output is source data and must never be
    lost to a parse failure. Parse failures fall back to
    :func:`salvage_json`; the persona's ``normalize_manifest`` (when
    present) then coerces the result into a stable manifest shape with
    provenance fields attached.
    """
    if task.save_raw:
        raw_path = out_dir / (Path(task.output_filename).stem + "_raw.txt")
        raw_path.write_text(text)
        print(f"[{persona.key}] kept raw model output at {raw_path}")
    try:
        data = parse_json_block(text)
    except Exception:
        print("WARNING: raw JSON parse failed; salvaging the un-truncated prefix...")
        data = salvage_json(text)
    if persona.normalize_manifest is not None:
        data = persona.normalize_manifest(data, gcs_uri=gcs_uri, model=model_used)
    return json.dumps(data, indent=2)
