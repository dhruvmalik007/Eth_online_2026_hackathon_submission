"""Offline tests for reactor-video (no GCP/Gemini calls required)."""

import json
import sys
import unittest
from pathlib import Path

PKG_SRC = Path(__file__).resolve().parents[1] / "src"
if str(PKG_SRC) not in sys.path:
    sys.path.insert(0, str(PKG_SRC))

from reactor_video import Persona, Task, __version__  # noqa: E402
from reactor_video.engine import (  # noqa: E402
    default_location,
    default_project_id,
    parse_json_block,
    salvage_json,
)
from reactor_video.personas import available_personas, get_persona  # noqa: E402
from reactor_video.personas.vanguard import normalize_manifest  # noqa: E402
from reactor_video.spec import TaskKind  # noqa: E402


class TestPersonaRegistry(unittest.TestCase):
    """Registry surface: discovery, lookup, and persona self-consistency."""

    def test_personas_registered(self):
        self.assertIn("bloomberg", available_personas())
        self.assertIn("vanguard", available_personas())

    def test_lookup_is_case_insensitive(self):
        self.assertEqual(get_persona("Bloomberg").key, "bloomberg")

    def test_unknown_persona_raises_helpful_error(self):
        with self.assertRaisesRegex(KeyError, "available"):
            get_persona("does-not-exist")

    def test_every_registered_persona_validates(self):
        for key in available_personas():
            get_persona(key).validate()

    def test_vanguard_has_json_manifest_task_with_raw_copy(self):
        persona = get_persona("vanguard")
        json_tasks = [t for t in persona.tasks if t.kind is TaskKind.JSON]
        self.assertEqual(len(json_tasks), 1)
        self.assertTrue(json_tasks[0].save_raw)
        self.assertEqual(json_tasks[0].response_mime_type, "application/json")

    def test_bloomberg_has_single_markdown_task(self):
        persona = get_persona("bloomberg")
        self.assertEqual([t.kind for t in persona.tasks], [TaskKind.MARKDOWN])

    def test_planned_outputs_match_tasks(self):
        persona = get_persona("vanguard")
        out_dir = Path("some/out")
        planned = persona.planned_outputs(out_dir)
        self.assertEqual(
            [p.name for p in planned],
            [t.output_filename for t in persona.tasks],
        )
        self.assertTrue(all(p.parent == out_dir for p in planned))


class TestTaskValidation(unittest.TestCase):
    """Task.__post_init__ must fail fast on malformed personas."""

    def test_empty_name_rejected(self):
        with self.assertRaisesRegex(ValueError, "name"):
            Task(name="  ", prompt="p", output_filename="a.md")

    def test_empty_prompt_rejected(self):
        with self.assertRaisesRegex(ValueError, "prompt"):
            Task(name="t", prompt="   ", output_filename="a.md")

    def test_nested_output_filename_rejected(self):
        with self.assertRaisesRegex(ValueError, "flat"):
            Task(name="t", prompt="p", output_filename="sub/dir/a.md")

    def test_out_of_range_temperature_rejected(self):
        with self.assertRaisesRegex(ValueError, "temperature"):
            Task(name="t", prompt="p", output_filename="a.md", temperature=3.0)

    def test_save_raw_requires_json_kind(self):
        with self.assertRaisesRegex(ValueError, "save_raw"):
            Task(name="t", prompt="p", output_filename="a.md", save_raw=True)

    def test_valid_json_task_accepted(self):
        task = Task(
            name="t",
            prompt="p",
            output_filename="a.json",
            kind=TaskKind.JSON,
            response_mime_type="application/json",
            save_raw=True,
        )
        self.assertEqual(task.kind, TaskKind.JSON)


class TestPersonaValidation(unittest.TestCase):
    """Persona.validate() checks cross-task invariants."""

    def _persona(self, **overrides):
        defaults = dict(
            key="test",
            title="Test",
            description="d",
            gcs_uri="gs://bucket/v.mp4",
            mime_type="video/mp4",
            models=("model-a",),
            tasks=(
                Task(name="t1", prompt="p", output_filename="a.md"),
            ),
        )
        defaults.update(overrides)
        return Persona(**defaults)

    def test_valid_persona_passes(self):
        self._persona().validate()

    def test_empty_model_chain_rejected(self):
        with self.assertRaisesRegex(ValueError, "model"):
            self._persona(models=()).validate()

    def test_empty_task_list_rejected(self):
        with self.assertRaisesRegex(ValueError, "task"):
            self._persona(tasks=()).validate()

    def test_duplicate_artifact_names_rejected(self):
        tasks = (
            Task(name="t1", prompt="p", output_filename="a.md"),
            Task(name="t2", prompt="p", output_filename="a.md"),
        )
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self._persona(tasks=tasks).validate()

    def test_non_slug_key_rejected(self):
        with self.assertRaisesRegex(ValueError, "slug"):
            self._persona(key="NotASlug").validate()


class TestJsonHelpers(unittest.TestCase):
    def test_parse_json_block_strips_fences(self):
        self.assertEqual(parse_json_block("```json\n{\"a\": 1}\n```"), {"a": 1})

    def test_parse_json_block_plain(self):
        self.assertEqual(parse_json_block("[1, 2, 3]"), [1, 2, 3])

    def test_salvage_json_recovers_complete_object(self):
        payload = {"pov_frames": [{"id": "a"}], "timeline": [1, 2, 3]}
        self.assertEqual(
            salvage_json(json.dumps(payload) + "trailing model chatter"), payload
        )

    def test_salvage_json_gives_up_cleanly(self):
        with self.assertRaises(ValueError):
            salvage_json("not json at all }}{")


class TestVanguardManifestNormalization(unittest.TestCase):
    def test_dict_shape(self):
        out = normalize_manifest(
            {"pov_frames": [{"id": "x"}], "timeline": [{"t": 0}]},
            gcs_uri="gs://v",
            model="m1",
        )
        self.assertEqual(len(out["pov_frames"]), 1)
        self.assertEqual(len(out["timeline"]), 1)
        self.assertEqual(out["model"], "m1")
        self.assertEqual(out["gcs_uri"], "gs://v")

    def test_bare_list_with_embedded_timeline(self):
        out = normalize_manifest(
            [
                {"trader_profile": "sales", "timestamp": 1.2},
                {"timeline": [{"t": 0}], "pov_frames": []},
            ],
            gcs_uri="gs://v",
            model="m1",
        )
        self.assertEqual(len(out["pov_frames"]), 1)
        self.assertEqual(len(out["timeline"]), 1)

    def test_bare_list_fallback_keeps_profile_entries(self):
        out = normalize_manifest(
            [{"foo": "bar"}, {"trader_profile": "risk"}],
            gcs_uri="gs://v",
            model="m1",
        )
        self.assertEqual(len(out["pov_frames"]), 1)
        self.assertEqual(out["pov_frames"][0]["trader_profile"], "risk")


class TestPackageBasics(unittest.TestCase):
    def test_version(self):
        self.assertEqual(__version__, "0.1.0")

    def test_public_spec_exports(self):
        self.assertTrue(issubclass(Persona, object))
        self.assertTrue(issubclass(Task, object))

    def test_env_overrides(self):
        import os

        old = {k: os.environ.get(k) for k in ("REACTOR_GCP_PROJECT", "REACTOR_GCP_LOCATION")}
        try:
            os.environ["REACTOR_GCP_PROJECT"] = "proj-x"
            os.environ["REACTOR_GCP_LOCATION"] = "europe-west1"
            self.assertEqual(default_project_id(), "proj-x")
            self.assertEqual(default_location(), "europe-west1")
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
