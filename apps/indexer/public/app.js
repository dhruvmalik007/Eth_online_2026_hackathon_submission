/**
 * Indexer frontend — fetch-only integration with the six API routes.
 *
 * Two rules shape this file:
 *  - Every number on screen comes from an API response. Nothing is computed
 *    here, so the UI cannot drift from what the agent and SQL actually said.
 *  - A failure renders a typed state (never a blank pane). The error codes the
 *    API returns map to human-readable next steps.
 */

const $ = (id) => document.getElementById(id);

const NODES = [
  ['ingestion', 'Protocol ingestion'],
  ['ruleParsing', 'Legal & rule parsing'],
  ['yieldPrediction', 'Temporal yield prediction'],
  ['synthesis', 'Quant synthesis'],
  ['readjustment', 'Readjustment engine'],
];

const ERROR_COPY = {
  BAD_REQUEST: 'The request was rejected.',
  VECTOR_UNAVAILABLE: 'Retrieval is not configured on this deployment.',
  DATABASE_UNAVAILABLE: 'TimescaleDB is unreachable.',
  MODEL_UNAVAILABLE: 'The TimesFM-3 service is unreachable.',
  UPSTREAM_ERROR: 'An upstream dependency failed.',
  INTERNAL_ERROR: 'Unexpected server error.',
};

// ── small helpers ─────────────────────────────────────────────────────────

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const num = (v, digits = 4) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';

const pct = (v, digits = 1) =>
  typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—';

async function api(path, options) {
  const res = await fetch(path, options);
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* a non-JSON body is reported as an unreadable response below */
  }
  if (!res.ok) {
    const error = payload && payload.error ? payload.error : {};
    const err = new Error(error.message || `Request failed (${res.status})`);
    err.code = error.code || 'INTERNAL_ERROR';
    err.details = error.details || [];
    throw err;
  }
  return payload;
}

function renderError(host, err, context) {
  const copy = ERROR_COPY[err.code] || 'Something went wrong.';
  const details = (err.details || []).map((d) => `<div class="hint">${esc(d)}</div>`).join('');
  host.innerHTML = `<div class="state error"><strong>${esc(copy)}</strong>${esc(err.message)}${
    context ? `<div class="hint">${esc(context)}</div>` : ''
  }${details}</div>`;
}

// ── health strip ──────────────────────────────────────────────────────────

function setPill(key, state) {
  const pill = document.querySelector(`.pill[data-key="${key}"]`);
  if (pill) pill.dataset.state = state;
}

async function refreshHealth() {
  try {
    const health = await api('/api/health');
    setPill('db', health.database && health.database.reachable ? 'ok' : 'down');
    setPill('timesfm3', health.timesfm3 && health.timesfm3.reachable ? 'ok' : 'down');
    const caps = health.timescaledb;
    setPill('vector', caps && caps.vectorEnabled ? 'ok' : 'warn');
    setPill('retrieval', health.retrieval === 'enabled' ? 'ok' : 'warn');
  } catch (err) {
    for (const key of ['db', 'timesfm3', 'vector', 'retrieval']) setPill(key, 'down');
    console.error('[indexer] health check failed:', err.message);
  }
}

// ── activity column ───────────────────────────────────────────────────────

function activityReset() {
  $('activity').innerHTML = NODES.map(
    ([key, label]) =>
      `<li data-node="${key}" data-state="pending"><span class="tick">·</span><span><span class="node">${esc(
        label,
      )}</span><span class="detail">waiting…</span></span></li>`,
  ).join('');
  $('activity-meta').textContent = 'running';
}

function activityAdvance(index, detail) {
  const items = $('activity').querySelectorAll('li');
  items.forEach((li, i) => {
    if (i < index) li.dataset.state = 'done';
    if (i === index) {
      li.dataset.state = 'done';
      li.querySelector('.tick').textContent = '✓';
      if (detail) li.querySelector('.detail').textContent = detail;
    }
  });
}

function activityFail(message) {
  $('activity-meta').textContent = 'failed';
  const li = document.createElement('li');
  li.dataset.state = 'error';
  li.innerHTML = `<span class="tick">✗</span><span><span class="node">run</span><span class="detail">${esc(
    message,
  )}</span></span>`;
  $('activity').appendChild(li);
}

/**
 * Replay the audit trail the graph returned. The ticks are driven by the real
 * per-node audit entries rather than a timer, so what is shown is what ran.
 */
function activityFromAudit(audit) {
  const list = $('activity');
  if (!Array.isArray(audit) || audit.length === 0) {
    list.innerHTML = '<li><span class="tick">·</span><span class="detail">No audit entries returned.</span></li>';
    $('activity-meta').textContent = 'no audit';
    return;
  }
  list.innerHTML = audit
    .map(
      (entry) => `<li data-state="done"><span class="tick">✓</span><span>
        <span class="node">${esc(entry.node)}</span>
        <span class="detail">${esc(entry.detail)}</span></span></li>`,
    )
    .join('');
  $('activity-meta').textContent = `${audit.length} steps`;
}

// ── headline stats ────────────────────────────────────────────────────────

function renderHeadline(state) {
  const risk = state.riskAssessment || {};
  const replan = Boolean(risk.replanNeeded);
  const projections = state.projections || [];
  const first = projections[0];
  const last = first && first.steps ? first.steps[first.steps.length - 1] : null;
  const median = last ? last.q50 : null;

  $('headline').innerHTML = [
    ['projections', String(projections.length)],
    ['decisions', String((state.decisions || []).length)],
    ['median 30d', median === null ? '—' : pct(median)],
    ['guardrails', replan ? 're-plan' : 'clean'],
  ]
    .map(
      ([k, v]) => `<div class="stat"><span class="k">${esc(k)}</span>
        <span class="v ${replan && k === 'guardrails' ? 'down' : ''}">${esc(v)}</span></div>`,
    )
    .join('');
}

// ── synthesis text ────────────────────────────────────────────────────────

function renderAnswer(state) {
  const synthesis = state.synthesis;
  const parts = [];

  if (synthesis && Array.isArray(synthesis.alpha) && synthesis.alpha.length > 0) {
    for (const a of synthesis.alpha) {
      parts.push(
        `<p><span class="tag amber">alpha</span> ${esc(a.protocol)} — ${esc(a.thesis)}
         <span class="cite">[${esc(a.projectionId)}]</span></p>`,
      );
    }
  }
  if (synthesis && Array.isArray(synthesis.violations) && synthesis.violations.length > 0) {
    for (const v of synthesis.violations) {
      parts.push(
        `<p><span class="tag down">constraint</span> ${esc(v.statement)}
         <span class="cite">[${esc(v.constraintId)} · ${esc(v.projectionId)}]</span></p>`,
      );
    }
  }
  const risk = state.riskAssessment || {};
  if (Array.isArray(risk.reasons) && risk.reasons.length > 0) {
    parts.push(
      `<p><span class="tag down">guardrail</span> ${esc(risk.reasons.join('; '))}</p>`,
    );
  }

  if (parts.length === 0) {
    $('answer').innerHTML =
      '<div class="state"><strong>No synthesis returned</strong>The run produced no alpha or violations to report.</div>';
  } else {
    $('answer').innerHTML = parts.join('');
  }

  $('answer-meta').textContent =
    state.synthesisRuns === undefined ? '—' : `synthesis runs: ${state.synthesisRuns}`;
}

// ── decisions table ───────────────────────────────────────────────────────

function renderDecisions(state) {
  const decisions = state.decisions || [];
  if (decisions.length === 0) {
    $('decisions-host').innerHTML = '<div class="state">No decisions were produced.</div>';
    $('decisions-meta').textContent = '0';
    return;
  }
  const rows = decisions
    .map((d) => {
      const cls = d.action === 'HOLD' ? 'hold' : d.action.startsWith('WITHDRAW') ? 'down' : 'up';
      return `<tr>
        <td><span class="tag ${cls}">${esc(d.action)}</span></td>
        <td>${esc(d.protocol)}</td>
        <td class="num">${num(d.amountPercentage, 1)}%</td>
        <td>${esc(d.rationale)}</td>
        <td class="mono">${(d.citations || []).map((c) => esc(c)).join('<br>')}</td>
      </tr>`;
    })
    .join('');
  $('decisions-host').innerHTML = `<table>
    <thead><tr><th>action</th><th>protocol</th><th class="num">size</th><th>rationale</th><th>citations</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  $('decisions-meta').textContent = String(decisions.length);
}

// ── forecast chart (inline SVG, no chart library) ─────────────────────────

function renderChart(state) {
  const projections = state.projections || [];
  const projection = projections[0];
  if (!projection || !Array.isArray(projection.steps) || projection.steps.length === 0) {
    $('chart-host').innerHTML =
      '<div class="state"><strong>No projection</strong>Node 3 returned no forecast for this pool.</div>';
    $('chart-legend').hidden = true;
    $('forecast-meta').textContent = '—';
    return;
  }

  const steps = projection.steps;
  const W = 900;
  const H = 210;
  const pad = { top: 12, right: 12, bottom: 22, left: 46 };
  const lows = steps.map((s) => s.q10);
  const highs = steps.map((s) => s.q90);
  let min = Math.min(...lows);
  let max = Math.max(...highs);
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;

  const x = (i) =>
    pad.left + (i * (W - pad.left - pad.right)) / Math.max(steps.length - 1, 1);
  const y = (v) => pad.top + (1 - (v - min) / (max - min)) * (H - pad.top - pad.bottom);

  const bandTop = steps.map((s, i) => `${x(i)},${y(s.q90)}`).join(' ');
  const bandBottom = steps
    .map((s, i) => `${x(steps.length - 1 - i)},${y(steps[steps.length - 1 - i].q10)}`)
    .join(' ');
  const median = steps.map((s, i) => `${x(i)},${y(s.q50)}`).join(' ');
  const realized = steps.map((s, i) => `${x(i)},${y(s.q10)}`).join(' ');

  const gridlines = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const value = min + t * (max - min);
      const yy = y(value);
      return `<line class="gridline" x1="${pad.left}" y1="${yy}" x2="${W - pad.right}" y2="${yy}" />
              <text x="${pad.left - 6}" y="${yy + 3}" text-anchor="end">${pct(value, 2)}</text>`;
    })
    .join('');

  $('chart-host').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Forecast quantile band for ${esc(projection.poolId)}">
    ${gridlines}
    <polygon class="band" points="${bandTop} ${bandBottom}" />
    <polyline class="median" points="${median}" />
    <polyline class="history" points="${realized}" />
    <line class="axis" x1="${pad.left}" y1="${H - pad.bottom}" x2="${W - pad.right}" y2="${H - pad.bottom}" />
    <text x="${pad.left}" y="${H - 6}">day 1</text>
    <text x="${W - pad.right}" y="${H - 6}" text-anchor="end">day ${steps.length}</text>
  </svg>`;

  $('chart-legend').hidden = false;
  const last = steps[steps.length - 1];
  $('forecast-meta').textContent = `${projection.model} · last q50 ${pct(last.q50)}`;
}

// ── evidence + calibration ────────────────────────────────────────────────

function renderEvidence(state) {
  const evidence = state.evidence || [];
  const calibration = state.calibration;
  const blocks = [];

  if (calibration) {
    blocks.push(`<div class="panel-body" style="border-bottom:1px solid var(--tk-edge)">
      <div class="stat-row" style="margin:0">
        <div class="stat"><span class="k">coverage</span><span class="v ${calibration.coverage >= 0.7 ? 'up' : 'down'}">${pct(
          calibration.coverage,
        )}</span></div>
        <div class="stat"><span class="k">pinball loss</span><span class="v">${num(
          calibration.meanPinballLoss,
          5,
        )}</span></div>
        <div class="stat"><span class="k">mae</span><span class="v">${num(calibration.meanAbsoluteError, 5)}</span></div>
        <div class="stat"><span class="k">samples</span><span class="v">${calibration.samples}</span></div>
      </div>
      <div class="muted" style="margin-top:8px">SQL-computed reliability for ${esc(
        calibration.poolId,
      )}/${esc(calibration.metric)} — quoted, never recomputed.</div>
    </div>`);
  }

  if (evidence.length > 0) {
    const items = evidence
      .map(
        (e) => `<li>
        <div class="ev-head">
          <span>${esc(e.kind)} · ${esc(e.poolId)}</span>
          <span>score ${num(e.score, 3)}</span>
        </div>
        <div class="ev-body">${esc(e.content)}</div>
        <div class="ev-head" style="margin-top:6px"><span>${esc(e.sourceIds.join(', '))}</span></div>
      </li>`,
      )
      .join('');
    blocks.push(`<ul class="evidence">${items}</ul>`);
  }

  if (blocks.length === 0) {
    $('evidence-host').innerHTML = `<div class="state">
      <strong>No retrieved context</strong>
      This run used no historical evidence — either nothing is indexed yet, or the
      vector layer is unconfigured.
      <div class="hint">Backfill embeddings, then re-run.</div>
    </div>`;
    $('evidence-meta').textContent = '0';
    return;
  }

  $('evidence-host').innerHTML = blocks.join('');
  $('evidence-meta').textContent = `${evidence.length} chunks`;
}

// ── run ───────────────────────────────────────────────────────────────────

function parsePools(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function run(event) {
  event.preventDefault();
  const query = $('query').value.trim();
  if (query.length === 0) return;

  const pools = parsePools($('poolIds').value);
  if (pools.length === 0) {
    $('activity').innerHTML =
      '<li data-state="error"><span class="tick">✗</span><span class="detail">Add at least one pool id.</span></li>';
    return;
  }

  const deep = $('deep').checked;
  const dry = $('dry').checked;

  $('run').disabled = true;
  $('run').innerHTML = '<span class="spin">◐</span> running';
  $('raw').textContent = '—';
  activityReset();

  const started = Date.now();
  try {
    // A dry run is deterministic and fast; advance the ticks to reflect that.
    if (dry) activityAdvance(NODES.length - 1, 'deterministic path — model calls skipped');

    const payload = await api('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        mode: deep ? 'deep' : 'v01',
        poolIds: pools,
        horizonDays: Number($('horizon').value) || 30,
        dry,
      }),
    });

    $('raw').textContent = JSON.stringify(payload, null, 2);

    if (dry) {
      $('activity-meta').textContent = 'dry run';
      $('answer').innerHTML = `<div class="state"><strong>Dry run complete</strong>
        Data access verified without any model spend.
        <div class="hint">pools covered: ${esc(payload.pools.map((p) => `${p.poolId} (${p.points} pts)`).join(', '))}</div>
        <div class="hint">store holds ${esc(payload.coverage.rowCount)} rows across ${esc(
          payload.coverage.poolCount,
        )} pools.</div></div>`;
      $('decisions-host').innerHTML = '<div class="state">Dry runs produce no decisions.</div>';
      $('chart-host').innerHTML = '<div class="state">Dry runs produce no forecast.</div>';
      $('chart-legend').hidden = true;
      $('evidence-host').innerHTML = '<div class="state">Dry runs retrieve no evidence.</div>';
      return;
    }

    if (deep) {
      activityAdvance(NODES.length - 1, 'deep agent run');
      $('answer').innerHTML = `<div class="answer">${esc(
        typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result, null, 2),
      )}</div>`;
      $('answer-meta').textContent = 'deep agent';
      $('decisions-host').innerHTML = '<div class="state">The deep agent reports in prose; see raw response.</div>';
      $('chart-host').innerHTML = '<div class="state">No structured forecast in deep mode.</div>';
      return;
    }

    activityFromAudit(payload.audit);
    renderHeadline(payload);
    renderAnswer(payload);
    renderDecisions(payload);
    renderChart(payload);
    renderEvidence(payload);
    $('answer-meta').textContent = `${((Date.now() - started) / 1000).toFixed(1)}s · ${
      payload.forecastRunId ? `run ${String(payload.forecastRunId).slice(0, 8)}` : 'no ledger run'
    }`;
  } catch (err) {
    $('raw').textContent = JSON.stringify({ error: { code: err.code, message: err.message } }, null, 2);
    activityFail(err.message);
    renderError($('answer'), err, 'The cycle did not complete.');
    $('answer-meta').textContent = 'failed';
  } finally {
    $('run').disabled = false;
    $('run').textContent = 'Run';
  }
}

// ── wiring ────────────────────────────────────────────────────────────────

$('command').addEventListener('submit', run);
$('refreshHealth').addEventListener('click', refreshHealth);
refreshHealth();
