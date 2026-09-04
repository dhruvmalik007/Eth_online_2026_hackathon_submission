# reactor-video

Persona-driven video analysis for the Reactor video rendering generation pipeline. This takes inspiration from the following:
1. Bloomberg's trading EMS advertisement.
2. The YouTube video explaining the day of a fixed income trader in the trading floor of the Sydney stock market


Uses One package, one entry point, many personas: each reference video of the project (Bloomberg
Trading EMS demo, Vanguard fixed income trading floor, ...) is analyzed by a
dedicated persona that bundles its prompts, model fallback chain, and output
artifacts.

This is the **initial step of the Reactor idea provenance**: every generated
video, shotlist, and frame manifest downstream traces back to the analysis
these personas produce from the reference videos.

## Package layout

```
packages/reactor-video/
├── pyproject.toml
├── README.md
├── src/reactor_video/
│   ├── __init__.py
│   ├── spec.py                 # Task + Persona dataclasses
│   ├── engine.py               # Gemini/Vertex engine: fallback chain, JSON salvage, outputs
│   ├── personas/
│   │   ├── __init__.py         # registry: get_persona(), available_personas()
│   │   ├── bloomberg.py        # Bloomberg Trading EMS persona
│   │   └── vanguard.py         # Vanguard fixed income floor persona (+ POV manifest)
│   └── cli.py                  # argparse CLI shared by script + console entry
└── tests/
    └── test_reactor_video.py   # offline unittests (no GCP calls)
```

## Personas

| Key         | Video                                        | Outputs |
| ----------- | -------------------------------------------- | ------- |
| `bloomberg` | Bloomberg Trading EMS screen recording (GCS) | `video_summarization_analysis.md` |
| `vanguard`  | Vanguard fixed income trading floor (GCS)    | `vanguard_video_analysis.md`, `vanguard_pov_frames_manifest.json` (+ `_raw.txt`) |

The Vanguard persona's POV manifest is **current-frame anchored**: every
timestamp describes what is visible at that exact instant, never "the view of
the past". The manifest feeds the downstream frame-extraction and cropping
steps (`extract_vanguard_pov_frames.py`, `enrich_vanguard_reactor.py`).

## Usage

From the repo root:

```bash
# list personas
python3 analyze_videos.py --list-personas

# inspect tasks + planned artifacts without touching GCP
python3 analyze_videos.py all --dry-run

# run one persona (writes to analysis/<persona>/)
python3 analyze_videos.py bloomberg
python3 analyze_videos.py vanguard

# run everything
python3 analyze_videos.py all

# overrides
python3 analyze_videos.py vanguard --gcs-uri gs://my-bucket/my.mp4 --out-dir out
```

## GCP / Vertex AI setup (required for real runs)

`--list-personas` and `--dry-run` are metadata-only and work on any machine.
Actually executing a persona calls **Vertex AI (Gemini) with the video as
input**, which requires a one-time Google Cloud setup. Anyone who wants to
run the analysis must complete all of the following steps — there is no
API-key fallback in this pipeline; it uses Vertex AI with Application
Default Credentials (ADC), exactly like the legacy scripts.

1. **Google Cloud account + project.** Create (or pick) a project with
   billing enabled at <https://console.cloud.google.com>. The default used
   by this package is `ultimate3dreconstructionstack` — override it with
   `--project` or `REACTOR_GCP_PROJECT` if you use your own.

2. **Install the Google Cloud CLI.**

   ```bash
   # macOS (Homebrew)
   brew install --cask google-cloud-sdk
   # or the official installer: https://cloud.google.com/sdk/docs/install
   gcloud --version   # verify
   ```

3. **Initialize and select the project.**

   ```bash
   gcloud init
   gcloud config set project ultimate3dreconstructionstack
   ```

4. **Enable the Vertex AI API** on that project:

   ```bash
   gcloud services enable aiplatform.googleapis.com
   ```

5. **Grant your account the Vertex AI User role** (needed to call Gemini
   models):

   ```bash
   gcloud projects add-iam-policy-binding ultimate3dreconstructionstack \
     --member="user:you@example.com" \
     --role="roles/aiplatform.user"
   ```

6. **Create Application Default Credentials** — this is what
   `google.genai` picks up automatically:

   ```bash
   gcloud auth application-default login
   ```

7. **Install the package** (pulls in `google-genai`):

   ```bash
   pip install -e packages/reactor-video
   ```

8. **Make sure the video is in GCS.** Personas reference `gs://` URIs;
   upload new videos with:

   ```bash
   gcloud storage cp my_video.mp4 gs://meghdoot-artifacts/video_analysis/
   ```

9. **Verify.** `--dry-run` still makes no calls; the first real run
   (`python3 analyze_videos.py bloomberg`) exercises credentials end to
   end. Location defaults to `us-central1` (`REACTOR_GCP_LOCATION` to
   override).

> Cost note: every real run consumes billable Vertex AI quota
> (long-context video analysis is not free). Prefer `--dry-run` while
> iterating on structure; run personas deliberately.

## Tests (offline, no API calls)

Or install the package for shell-wide use:

```bash
pip install -e packages/reactor-video
reactor-analyze vanguard
```

Environment overrides: `REACTOR_GCP_PROJECT`, `REACTOR_GCP_LOCATION`
(defaults: `ultimate3dreconstructionstack`, `us-central1`).
Gemini authentication uses Application Default Credentials (same as the
original scripts).

## Tests (offline, no API calls)

```bash
python3 -m unittest discover -s packages/reactor-video/tests -v
```

## Relationship to the legacy scripts

This package supersedes the one-off root scripts:

- `analyze_video.py` -> `personas/bloomberg.py`
- `analyze_vanguard_video.py` -> `personas/vanguard.py`

Prompts, model fallback chains, temperatures, and output naming are ported
verbatim; the shared machinery (client init, fallback, JSON parsing/salvage,
provenance headers) now lives once in `engine.py`. The legacy scripts stay in
the repo until their removal lands as its own commit/PR.

New personas (e.g. other reference videos) = one new module in
`reactor_video/personas/` + one registry line. No engine changes.

## Attribution

- Authored with AI assistance: **Claude (Command Code CLI agent)**, reviewed
  and directed by the repo owner.
- The AI model used per code change is disclosed in the commit messages /
  PR descriptions of the PR series that introduces this package.
