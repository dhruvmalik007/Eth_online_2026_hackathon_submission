# Container image for the risk-data collection worker.
#
# Deployed as a **Cloud Run Job**, not a Service: the work is a bounded batch that
# runs every six hours and exits, which is exactly what a Job is for. Two
# consequences follow, and both are deliberate:
#
#   * No HTTP server and no `$PORT` binding. Cloud Run's "listen on 0.0.0.0"
#     requirement applies to Services, which must answer requests; a Job runs to
#     completion and its exit code is the result.
#   * `--task-timeout` and `--max-retries` bound a run at the platform level, in
#     addition to the per-source timeout inside the worker. A scrape that hangs
#     cannot bill indefinitely.
#
# ## Why this is not on Vercel
#
# A Vercel Function is capped at 250 MB unzipped and cannot run a process tree, so
# a Firefox-based browser is impossible there. The read path stays on Vercel; the
# collection runs here.
#
# ## The browser install location, which is not where you would guess
#
# Camoufox does **not** honour `PLAYWRIGHT_BROWSERS_PATH`. Its install directory is
# `platformdirs.user_cache_dir("camoufox")`, which on Linux resolves through
# `XDG_CACHE_HOME`. Getting this wrong is silent at build time and fatal at
# runtime: a fetch as `root` lands in `/root/.cache/camoufox`, the process then runs
# as `scraper`, finds nothing, and tries to re-download the browser on every sweep.
# `XDG_CACHE_HOME` is therefore pinned to a fixed path that the build and the
# runtime user share.
#
# ## Layer order
#
# Dependencies, then the browser, then the code — least- to most-frequently
# changed. Editing a parser therefore reuses the system libraries and the ~1.3 GB
# browser download, so a fix costs a few seconds of rebuild rather than a full
# image fetch.
#
# ## Why the user is created before anything is copied
#
# A container layer is the set of changes to the previous layer, and `chown` is a
# change to every file's metadata. Creating the user first and using `COPY --chown`
# keeps ownership correct without a trailing `chown -R`, which in this image would
# duplicate the browser and the virtualenv into an extra layer (~330 MB measured).

FROM python:3.12-slim-bookworm AS base

# Firefox's runtime dependencies. Installed before anything Python so a code
# change never invalidates them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        # Firefox / GTK runtime
        libgtk-3-0 \
        libdbus-glib-1-2 \
        libxt6 \
        libasound2 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libpango-1.0-0 \
        libcairo2 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxshmfence1 \
        # fonts, so rendered text is not blocks of tofu
        fonts-liberation \
        fonts-dejavu-core \
        # tini reaps zombie Firefox child processes; without it a crashed
        # browser can leave the container unable to exit.
        tini \
    && rm -rf /var/lib/apt/lists/*

# The runtime identity, created up front so every later layer can be written with
# the right ownership (`COPY --chown`) instead of being corrected afterwards.
RUN useradd --create-home --uid 10001 scraper

# `uv` only for installation; the runtime is plain CPython.
COPY --from=ghcr.io/astral-sh/uv:0.12.1 /uv /usr/local/bin/uv

WORKDIR /app
RUN mkdir -p /app/cache && chown -R scraper:scraper /app

# Fixed, shared locations. Both survive into the running container, so the browser
# fetched at build time is the one the worker finds.
ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    XDG_CACHE_HOME=/app/cache \
    HOME=/home/scraper

# Everything below runs as the unprivileged user, so no layer needs a later
# metadata rewrite. The browser is the least trusted component here; it never gets
# root.
USER scraper

# ── Layer 1: Python dependencies ─────────────────────────────────────────────
# Only the manifest and lockfile, so this layer survives every code change.
COPY --chown=scraper:scraper scraper/pyproject.toml scraper/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# ── Layer 2: the browser ─────────────────────────────────────────────────────
# The single largest and slowest step (~1.3 GB), and the one most worth caching:
# kept above the source copy so a parser fix does not re-download it.
RUN uv run --no-sync python -m camoufox fetch

# ── Layer 3: the code ────────────────────────────────────────────────────────
# Most frequently changed, so it sits last.
COPY --chown=scraper:scraper scraper/risk_pipeline ./risk_pipeline
COPY --chown=scraper:scraper scraper/scripts ./scripts
COPY --chown=scraper:scraper roster.json ./roster.json

# Install the project itself now that its sources exist.
RUN uv sync --frozen --no-dev

# ── Runtime posture ──────────────────────────────────────────────────────────
ENV RISK_LOG_FORMAT=json \
    RISK_HEADLESS=true \
    RISK_SOURCE_TIMEOUT_S=45 \
    PYTHONUNBUFFERED=1

# `tini` as PID 1 so a signal reaches Firefox rather than being swallowed.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/.venv/bin/python", "-m", "risk_pipeline"]

# Cloud Run overrides this with a `--args` list; the default runs the full sweep.
CMD ["--no-cloud", "--out", "/tmp/risk", "--cadence-hours", "6"]
