https://docs.reactor.inc/model-api-reference/fast-h3/schema



> ## Documentation Index
> Fetch the complete documentation index at: https://docs.reactor.inc/llms.txt
> Use this file to discover all available pages before exploring further.

> ## Agent Instructions
> Reactor hosts multiple models, each with its own connect slug (modelName) and command/event schema. The catalog of every model — slug, typed SDK package, and links to its schema — is at /model-api-reference/overview. Some models expose one slug per experience (e.g. HappyOyster); always take the slug from the model's own pages, never guess it.
> Fastest path to a working app: `npx create-reactor-app my-app --model=<slug>` scaffolds a complete app with secure auth wired up. Typed TypeScript SDKs are published as @reactor-models/<model>; Python uses the base reactor-sdk package.
> Auth: exchange an API key (rk_...) for a JWT via POST https://api.reactor.inc/tokens from your server. Never put the API key in client-side code.
> Append .md to any docs URL for clean Markdown. Search these docs via the MCP server at https://docs.reactor.inc/mcp.

# FastH3 schema

> Tracks, session lifecycle, every command, and every message for FastH3 sessions.

This page documents the complete FastH3 wire surface: the two media tracks the model produces, the
session lifecycle, every command you can send, and every message the model emits back. For what
FastH3 is and a quick start, see the [overview](/model-api-reference/fast-h3/overview).

## Tracks

| Direction | Name         | Type  | Format                     | Rate                  |
| --------- | ------------ | ----- | -------------------------- | --------------------- |
| Outbound  | `main_video` | Video | RGB frames, session canvas | 24 fps, fixed         |
| Outbound  | `main_audio` | Audio | 48 kHz mono                | frame-locked to video |

**There are no inbound tracks**: the model reads no camera and no microphone. The video track keeps
one size for the length of a queue — `set_canvas` chooses it and is only accepted while the queue is
empty and nothing plays, since queued clips are already built at the size in force. The audio track
is generated jointly with the video on every clip, so the two never drift.

## Session lifecycle

Once the connection reaches **ready**, the session begins *idle* against a black output. Adding
clips doesn't start any playback: a built clip only reaches the tracks when a `play` (or, with
`set_autoplay` on, the playout queue's front-most ready clip) asks for it.

By default the stream **flushes to black** the moment a clip ends or is stopped and holds there
until the next play. Two things change that boundary behavior, and they're separate:

* `set_flush_on_clip_end` with `enabled: false` makes the stream *hold the last frame* across a
  normal end or stop instead of going black.
* A clip enqueued with `continue_from_clip_id` chains off its source clip — when autoplay moves from
  the source into it, the hand-off is seamless regardless of the flush setting: the model builds the
  sequel to open on the source's last frame, so there is no boundary to see.

```
  session starts (no clients yet)
    |
    v
  client connects       -> state_update + queue_update (to this client)
    |
  ┌───────────────────────────────────────────────────────────────┐
  │ IDLE (black screen, or last frame if flush is off)            │
  │ Examples: enqueue, pop, move, set_* (canvas queue-empty only) │
  │ Builds consume the generation queue in the background         │
  └───────────────────────────┬───────────────────────────────────┘
                              v  play
  ┌───────────────────────────────────────────────────────────────┐
  │ PLAYING one clip                                              │
  │ Examples: enqueue, stop, pop, move, chain a continuation      │
  │ Messages: clip_started, then clip_finished or clip_stopped    │
  │ Builds keep running behind the playout                        │
  └───────────────────────────┬───────────────────────────────────┘
                              v  clip ends / stop / reset
              (flush to black — or hold last frame — back to IDLE)
```

**Single session, shared state.** Several clients may attach to one session and they all see the
same queues and the same stream: an `enqueue` or a `stop` from any client affects everyone, and
every client receives every `state_update` and `queue_update`. Generation is gated on having an
audience — with nobody connected no new build starts, though a build already underway finishes into
the queue.

`state_update.valid_commands` names exactly what the session would accept at that moment, so a
frontend enables and greys out controls from the snapshot instead of re-deriving these rules. The
diagram above shortens the valid lists to illustrative commands for that reason — the snapshot, not
this page, is the authoritative listing at runtime; see the
[`state_update` payload table](#state_update-payload) for what it carries.

## Commands

Send commands with `reactor.sendCommand()` on the base SDK. Commands that have a reply resolve their
awaited call with it (`enqueue` → `clip_queued`, `move` → `clip_moved`, and so on); commands without
one take effect silently, the change visible in the next broadcast `state_update` / `queue_update`.
Any rejected command has no effect and is answered by a broadcast [`command_error`](#messages)
naming the command and the reason.

| Command                 | Description                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| `enqueue`               | Add a prompt to the generation queue; answered `clip_queued`                 |
| `move`                  | Reposition a clip within whichever queue holds it                            |
| `play`                  | Stream the playout queue's front clip, or a named `clip_id`                  |
| `pop`                   | Remove a clip from its queue                                                 |
| `stop`                  | Cut the playing clip (a skip, if autoplay is on)                             |
| `get_queue`             | Reply with both queues plus the build history — the `queue_update` payload   |
| `set_autoplay`          | Play the playout front automatically whenever nothing is playing             |
| `set_clip_seconds`      | Default clip length for enqueues that carry no `seconds`                     |
| `set_seed`              | Default seed for enqueues that carry none                                    |
| `set_canvas`            | Video size for the session (idle-gated)                                      |
| `set_flush_on_clip_end` | Whether the stream cuts to black at a clip boundary, or holds the last frame |
| `reset`                 | Drop all queues and history, cut any playing clip, restore defaults          |
| `get_state`             | Reply with the full `state_update` snapshot                                  |

### `enqueue`

Enter a prompt into the generation queue. Each request snapshots the session's conditions
(`set_clip_seconds`, `set_seed`, `set_canvas`) as they stand, receives a UUID, and joins the queue —
at the back, or at `position` if given (0 = next build). The reply, `clip_queued`, carries the full
[`ClipInfo`](#clipinfo-payload). The generation queue is bounded (default 20); full, the command is
rejected.

A plain `enqueue` opens a clip from text alone. Two optional fields open it from a picture instead —
**at most one** of them may be set on any enqueue:

* `starting_frame` opens the clip from an uploaded still (image-to-video). The frame is fitted to
  the session canvas and animates forward.
* `continue_from_clip_id` opens the clip from the last frame of another clip, chaining the two into
  a continuing scene. The source can sit in either queue or in `queue_update.history`, including a
  clip that hasn't built yet — the sequel then waits for its anchor and builds out of order relative
  to strict queue position, without blocking the builds behind it.

**Parameters:**

| Parameter               | Type    | Required | Description                                                                                                                    |
| ----------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `prompt`                | string  | Yes      | Scene description, ≤ 800 characters (see the prompt guide)                                                                     |
| `metadata`              | string  | No       | Opaque client string (≤ 2000 chars) echoed on every clip message                                                               |
| `starting_frame`        | FileRef | No       | An uploaded still the clip opens from (I2V). Mutually exclusive with `continue_from_clip_id`                                   |
| `continue_from_clip_id` | string  | No       | UUID of a clip whose last frame this one opens from. Mutually exclusive with `starting_frame`                                  |
| `seed`                  | int     | No       | This clip's seed (≥ 0); otherwise the session's advancing default                                                              |
| `seconds`               | float   | No       | Between `state_update.clip_seconds_min` and `clip_seconds_max` (live values), snapped to a legal length; otherwise the default |
| `position`              | int     | No       | ≥ 0; 0 = next build. Omitted = back of the generation queue                                                                    |

`starting_frame` is a [`FileRef`](/sdk-reference/types#fileref) — the object
[`uploadFile()`](/sdk-reference/reactor-class) returns, with `upload_id`, `name`, `mime_type`,
`size`, and optional `width` / `height`. Upload first, then embed the reference:

<CodeGroup>
  ```typescript JavaScript theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  const ref = await reactor.uploadFile(seedImageFile);
  const reply = await reactor.sendCommand("enqueue", {
    prompt: "A waxed yellow coat on a lighthouse stair, lantern swinging. Handheld follow.",
    starting_frame: ref,
  });
  // reply === { type: "clip_queued", data: { clip: ClipInfo } }
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  ref = await reactor.upload_file("seed.png")
  reply = await reactor.send_command("enqueue", {
      "prompt": "A waxed yellow coat on a lighthouse stair, lantern swinging. Handheld follow.",
      "starting_frame": ref,
  })
  # reply == {"type": "clip_queued", "data": {"clip": {…ClipInfo…}}}
  ```
</CodeGroup>

**Rejected with `command_error` when:** the prompt is empty or over 800 characters; the generation
queue is full; both picture fields come in the same request ("a clip opens from one picture"); or
`continue_from_clip_id` names a clip that is in neither queue nor `queue_update.history` (the id
doesn't exist anywhere the model can reference).

**`metadata` is for the frontend, not the model.** The model stores it and echoes it back on every
message that references the clip; it never parses it. Carry whatever your application needs to track
— which request produced the clip, who asked for it, text to show while it plays. JSON fits if you
want structure.

### `move`

Reposition a clip within whichever queue holds it. `position` 0 is the front; a value past the back
is clamped. The reply, `clip_moved`, names the queue and the landing position.

| Parameter  | Type   | Required | Description                         |
| ---------- | ------ | -------- | ----------------------------------- |
| `clip_id`  | string | Yes      | UUID of the clip to move            |
| `position` | int    | Yes      | ≥ 0; 0 = front, clamped to the back |

Rejected with `command_error` when the `clip_id` is unknown.

### `play`

Stream a built clip. With no `clip_id`, `play` takes the playout queue's front; a `clip_id` plays
that specific clip. Playing consumes the entry — the clip leaves the queue when it starts.
`clip_started` fires as the first frames reach the tracks. Rejected with `command_error` if another
clip is playing, the id is unknown, or the named clip is still generating.

| Parameter | Type   | Required | Description                                        |
| --------- | ------ | -------- | -------------------------------------------------- |
| `clip_id` | string | No       | Omitted = the playout queue's frontmost ready clip |

### `pop`

Remove a clip from whichever queue holds it, freeing its slot; a build in flight for it is discarded
when it finishes (the GPUs cannot abandon mid-build). Replies `clip_popped`.

Rejected when the id is unknown — *or* when a queued (unbuilt) clip is the source of another queued
clip's `continue_from_clip_id` chain. Popping the source would leave the dependent scene nothing to
open from, so the model refuses until you've popped the dependents first (back-to-front for a bulk
clear). Built clips don't hit this: they persist in `queue_update.history` after being popped and
can still anchor continuations.

| Parameter | Type   | Required | Description              |
| --------- | ------ | -------- | ------------------------ |
| `clip_id` | string | Yes      | UUID of the clip to drop |

### `stop`

Cut the playing clip. Both queues are untouched; whatever the transport held is discarded. With
autoplay on, `stop` acts as a *skip* — the next ready clip starts on its own. Emits `clip_stopped`.
What the stream shows next depends on `set_flush_on_clip_end`: black by default, the stopped clip's
last frame if flush is off. Rejected when nothing is playing.

### `get_queue`

Replies with both queues plus the retained build history — the same payload as `queue_update`. Front
first, each entry a full `ClipInfo`.

### `set_autoplay`

When `enabled` is `true`, the playout queue's front clip starts on its own whenever nothing is
playing; `stop` then acts as a skip. When `false` (the default), playback waits for an explicit
`play`. Replies `autoplay_accepted`.

| Parameter | Type | Required | Description        |
| --------- | ---- | -------- | ------------------ |
| `enabled` | bool | Yes      | Autoplay on or off |

### `set_clip_seconds`

Default clip length for enqueues that carry no `seconds`. The value snaps to what the model can
produce; the reply, `clip_length_accepted`, carries the effective value — read it back before
assuming a duration.

| Parameter | Type  | Required | Description                                                                                          |
| --------- | ----- | -------- | ---------------------------------------------------------------------------------------------------- |
| `seconds` | float | Yes      | Requested default length, between `state_update.clip_seconds_min` and `clip_seconds_max` (read live) |

### `set_seed`

Default seed for enqueues that carry none. Each such enqueue advances the default by one, so seeds
are per-clip, not per-session. `enqueue` with an explicit `seed` leaves the default untouched.
Replies `seed_accepted`.

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `seed`    | int  | Yes      | ≥ 0         |

Re-enqueueing the same prompt with the same seed, length, and canvas reproduces the same clip
(approximately — compiled kernels can reorder floating-point operations).

### `set_canvas`

Video size for the session, by aspect (`16:9`, `1:1`, `9:16`, `4:3`). Only accepted while the queue
is empty and nothing is playing, since queued clips were built at the size in force. Replies
`canvas_accepted` carrying the exact pixel `width` and `height`. Rejected with `command_error`
otherwise, or on an unsupported aspect.

| Parameter | Type   | Required | Description                         |
| --------- | ------ | -------- | ----------------------------------- |
| `aspect`  | string | Yes      | One of `16:9`, `1:1`, `9:16`, `4:3` |

### `set_flush_on_clip_end`

Whether the stream cuts to black the moment a clip ends, is stopped, or is followed by a
*non-continuing* clip — `enabled: true` is the default. With `enabled: false`, those transitions
hold the clip's last frame instead.

This toggle has no say in a genuine continuation: when autoplay moves from a clip into one enqueued
with `continue_from_clip_id` pointing at it, the sequel opens on the source's last frame by
construction and the boundary has no cut either way. `set_flush_on_clip_end` is what you set for
every boundary that *isn't* a hand-off. Replies `flush_accepted`.

| Parameter | Type | Required | Description                                    |
| --------- | ---- | -------- | ---------------------------------------------- |
| `enabled` | bool | Yes      | Cut to black at boundaries vs. hold last frame |

### `reset`

Drop the generation queue, the playout queue, and the retained build history; cut any playing clip;
and restore every session default (canvas, seed, clip length, autoplay, flush). Replies
`session_reset`, carrying how many clips were dropped and whether a clip was playing.

### `get_state`

Replies with the full `state_update` snapshot.

## Messages

Every message arrives as JSON `{ "type": "<name>", "data": { … } }`. The **Reaches** column says
whether a message is delivered to every connected client (everyone) or only to the client whose
command produced it (the caller).

| Message                | Reaches    | When                                                                                          |
| ---------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `state_update`         | everyone   | On connect, and after every change (full snapshot minus queue contents)                       |
| `queue_update`         | everyone   | On connect, and whenever either queue changes; carries both queues plus the build history     |
| `clip_queued`          | the caller | Reply to `enqueue`; the full `ClipInfo`, UUID included                                        |
| `clip_generated`       | everyone   | A build finished; the clip crossed from the generation queue to the back of the playout queue |
| `clip_moved`           | the caller | Reply to `move`; names the queue and the landing position                                     |
| `clip_started`         | everyone   | A clip's first frames reach the tracks                                                        |
| `clip_finished`        | everyone   | A clip was fully played out                                                                   |
| `clip_stopped`         | everyone   | `stop` (or `reset`) cut the playing clip; the rest is discarded                               |
| `clip_failed`          | everyone   | A build failed; the clip left the generation queue and builds continue                        |
| `clip_popped`          | the caller | Reply to `pop`; the clip left its queue and the slot is free                                  |
| `clip_length_accepted` | the caller | Reply to `set_clip_seconds`; carries the snapped value                                        |
| `seed_accepted`        | the caller | Reply to `set_seed`                                                                           |
| `autoplay_accepted`    | the caller | Reply to `set_autoplay`                                                                       |
| `canvas_accepted`      | the caller | Reply to `set_canvas`; carries the exact pixel size                                           |
| `flush_accepted`       | the caller | Reply to `set_flush_on_clip_end`                                                              |
| `session_reset`        | the caller | Reply to `reset`; says how many clips were dropped and whether one was playing                |

A rejected command has no effect and is answered by a broadcast `command_error`
(`{ command: string, reason: string }`) naming the command and the reason — it reaches every
connected client, not just the caller.

### `queue_update` payload

Carries everything a client needs to render the queue: `generation` (clips waiting to build, front
first), `playout` (built clips waiting to play, front first), and `history` (built clips no longer
queued — played, stopped, or popped — whose last frame is still retained, oldest first). `history`
entries are *not* playable again (`play` refuses them), but each is a legal `continue_from_clip_id`
source. The oldest history entries are evicted as new builds finish.

### `state_update` payload

A full snapshot of everything observable except the queue's contents, so a client can render UI from
this alone. Used by a scheduling client to steer; also carries every deployment-published live bound
a writer must not hardcode.

| Field                       | Type                   | Meaning                                                                                           |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| `playing`                   | `bool`                 | A clip is streaming on the output tracks.                                                         |
| `playing_clip_id`           | `string \| null`       | UUID of the clip now playing, or `null` when idle.                                                |
| `autoplay`                  | `bool`                 | `true` = the playout front starts on its own when nothing plays. Off by default.                  |
| `flush_on_clip_end`         | `bool`                 | `true` (default) = boundaries between clips cut to black; `false` = hold the last frame.          |
| `generation_queued`         | `int`                  | Clips in the generation queue.                                                                    |
| `generation_capacity`       | `int`                  | Maximum the generation queue holds; `enqueue` refuses beyond it. Deployment-published live.       |
| `playout_queued`            | `int`                  | Built clips in the playout queue, playable now.                                                   |
| `playout_capacity`          | `int`                  | Maximum built clips the playout queue holds. Generation pauses while it is full.                  |
| `clip_seconds`              | `float`                | Default scene/clips length in effect.                                                             |
| `clip_seconds_min`          | `float`                | Shortest clip length `set_clip_seconds` accepts. Read live; the value is deployment-published.    |
| `clip_seconds_max`          | `float`                | Longest clip length `set_clip_seconds` accepts. Read live.                                        |
| `seed`                      | `int`                  | Default seed for `enqueue`s that carry none. Advances by one per seedless enqueue.                |
| `aspect`, `width`, `height` | `string`, `int`, `int` | Canvas geometry in effect (`aspect` like `16:9`).                                                 |
| `clips_played`              | `int`                  | Clips finished or stopped since the session began.                                                |
| `seconds_sent`              | `float`                | Seconds of video and audio sent since the session began.                                          |
| `valid_commands`            | `string[]`             | Names of the commands the session would accept right now. The live answer; re-deriving it drifts. |

### `ClipInfo` payload

Every message that references a clip embeds the full `ClipInfo`, so a client never has to join a
UUID against an earlier message.

| Field                   | Type           | Meaning                                                                                                                                                            |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clip_id`               | string         | UUID assigned at `enqueue`; every later reference uses it                                                                                                          |
| `prompt`                | string         | What the clip shows, exactly as enqueued                                                                                                                           |
| `metadata`              | string         | Opaque client string, echoed untouched                                                                                                                             |
| `frames`                | int            | Clip length in frames, fixed at enqueue time                                                                                                                       |
| `seconds`               | float          | The same length in seconds (`frames / 24`)                                                                                                                         |
| `seed`                  | int            | The seed this clip generates from                                                                                                                                  |
| `continue_from_clip_id` | string \| null | The clip whose last frame this one opens from, or `null`                                                                                                           |
| `has_starting_frame`    | bool           | Whether this clip opens from an uploaded image                                                                                                                     |
| `ready`                 | bool           | Build completion (`false` = still in generation, `true` = built). Whether a built clip is *playable* is positional, read from which `queue_update` list carries it |

**Example handler (broadcasts only):**

<CodeGroup>
  ```typescript JavaScript theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  reactor.on("message", (msg) => {
    switch (msg.type) {
      case "state_update":
        console.log(`valid: ${msg.data.valid_commands.join(", ")}`);
        break;
      case "queue_update": {
        const { generation, playout, history } = msg.data;
        console.log(
          `generating: ${generation.length}, ready: ${playout.length}, history: ${history.length}`,
        );
        break;
      }
      case "clip_started":
        console.log(`now playing: ${msg.data.clip.prompt.slice(0, 50)}`);
        break;
      case "command_error":
        console.error(`${msg.data.command} rejected: ${msg.data.reason}`);
        break;
    }
  });
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  @reactor.on_message
  def handle(msg):
      data = msg["data"]
      if msg["type"] == "queue_update":
          print(
              f"generating: {len(data['generation'])}, "
              f"ready: {len(data['playout'])}, "
              f"history: {len(data['history'])}"
          )
      elif msg["type"] == "command_error":
          print(f"{data['command']} rejected: {data['reason']}")
  ```
</CodeGroup>

## Complete example

Enqueue a base scene, then chain a continuation off it so the two play as one shot. Autoplay drives
both; the `continue_from_clip_id` hand-off is seamless.

<CodeGroup>
  ```typescript JavaScript theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  import { Reactor } from "@reactor-team/js-sdk";

  const reactor = new Reactor({ modelName: "reactor/fast-h3" });

  reactor.on("message", (msg) => {
    if (msg.type === "command_error") {
      console.error(`${msg.data.command}: ${msg.data.reason}`);
      return;
    }
    if (msg.type === "clip_started") {
      console.log(`▶ ${msg.data.clip.prompt.slice(0, 60)}`);
    }
  });

  reactor.on("statusChanged", async (status) => {
    if (status !== "ready") return;

    await reactor.sendCommand("set_clip_seconds", { seconds: 8 });
    await reactor.sendCommand("set_autoplay", { enabled: true });

    const base = await reactor.sendCommand("enqueue", {
      prompt:
        "Foothills at first light, mist draining off a pine ridge line. Slow aerial glide. Bird calls, a river murmur.",
    });
    const baseId = base.data.clip.clip_id;

    await reactor.sendCommand("enqueue", {
      prompt:
        "Hard cut to a wide shot: the mist thickens into rain over the same foothills, the ridgeline darkening under rolling clouds. Sheets of rain sweep the pines, the flock scatters low, thunder rolls far off.",
      continue_from_clip_id: baseId,
    });
  });

  const jwt = await getToken();
  await reactor.connect(jwt);
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  import asyncio
  import os
  from reactor_sdk import Reactor, ReactorStatus

  async def main():
      reactor = Reactor(model_name="reactor/fast-h3",
                        api_key=os.environ["REACTOR_API_KEY"])

      @reactor.on_message
      def log(msg):
          if msg["type"] == "clip_started":
              print(f"▶ {msg['data']['clip']['prompt'][:60]}")

      @reactor.on_status(ReactorStatus.READY)
      async def on_ready(status):
          await reactor.send_command("set_clip_seconds", {"seconds": 8})
          await reactor.send_command("set_autoplay", {"enabled": True})

          base = await reactor.send_command("enqueue", {
              "prompt": "Foothills at first light, mist draining off a pine ridge line. Slow aerial glide. Bird calls, a river murmur.",
          })
          base_id = base["data"]["clip"]["clip_id"]

          await reactor.send_command("enqueue", {
              "prompt": "Hard cut to a wide shot: the mist thickens into rain over the same foothills, the ridgeline darkening under rolling clouds. Sheets of rain sweep the pines, the flock scatters low, thunder rolls far off.",
              "continue_from_clip_id": base_id,
          })

      await reactor.connect()
      await asyncio.Event().wait()

  asyncio.run(main())
  ```
</CodeGroup>

<Note>
  The continuation prompt re-describes the setting from scratch ("the same foothills… rain") and
  opens on a described hard cut rather than inheriting the take — continuity carries the *frame*,
  not the description or the camera; the discipline is the whole [prompt
  guide](/model-api-reference/fast-h3/prompt-guide).
</Note>
