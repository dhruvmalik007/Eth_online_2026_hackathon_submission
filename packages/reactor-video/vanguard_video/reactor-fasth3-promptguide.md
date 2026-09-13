> ## Documentation Index
> Fetch the complete documentation index at: https://docs.reactor.inc/llms.txt
> Use this file to discover all available pages before exploring further.

> ## Agent Instructions
> Reactor hosts multiple models, each with its own connect slug (modelName) and command/event schema. The catalog of every model — slug, typed SDK package, and links to its schema — is at /model-api-reference/overview. Some models expose one slug per experience (e.g. HappyOyster); always take the slug from the model's own pages, never guess it.
> Fastest path to a working app: `npx create-reactor-app my-app --model=<slug>` scaffolds a complete app with secure auth wired up. Typed TypeScript SDKs are published as @reactor-models/<model>; Python uses the base reactor-sdk package.
> Auth: exchange an API key (rk_...) for a JWT via POST https://api.reactor.inc/tokens from your server. Never put the API key in client-side code.
> Append .md to any docs URL for clean Markdown. Search these docs via the MCP server at https://docs.reactor.inc/mcp.

# FastH3 prompt guide

> How to write prompts FastH3 renders well — self-contained scenes with a soundscape.

FastH3 generates video *and audio in the same pass*. That one fact shapes every prompt on this page:
the model renders speech, ambience, and effects natively, so prompts that only describe the picture
come back flat. The rules below are the same constraints the launch-day livestream runs on.

Three working rules govern everything:

1. **Every clip has no memory.** Whether two prompts are separated by one queue slot or an hour, the
   second clip does not inherit anything from the first. Re-describe the world from scratch in every
   prompt, every time.
2. **800 characters is the hard cap.** `enqueue` refuses anything longer. Spend the budget on
   subjects and setting, not adjectives — the model gives the most space to what you give the most
   space.
3. **Picture and sound are co-equal.** A prompt that describes a scene but not its sound leaves the
   model to guess. Write the soundscape the same way you write the camera.

<Note>
  A continuing clip still has to stand on its own. `continue_from_clip_id` hands over the source's
  last *frame*, not its description — the new clip's prompt still has to re-establish everything, or
  the scene drifts.
</Note>

## Anatomy of a clip prompt

Four building blocks, in the order they pay off: **scene and subject**, **camera**, then **sound** —
and finally the implicit rule that everything is present tense, described as what the camera sees
and the microphone hears right now.

### 1. Scene and subject (mandatory, from scratch)

Re-establish the entire setting in every prompt: subjects and how they look, the environment, the
light, the palette, the style. Anything you omit vanishes or mutates. "The same diner" will not
render the same diner.

<div className="rea-example rea-example-dont">
  The same couple keeps arguing at the counter.
</div>

<div className="rea-example rea-example-do">
  A dim 24-hour diner at 3 a.m., teal and sodium-orange neon through rain-streaked windows. A woman in
  a mustard raincoat and a man in a cook's apron lean across a chipped laminate counter, mid argument.
  Static medium wide shot, eye-level, shallow depth of field.
</div>

### 2. Camera (one clear instruction)

One motion, one angle, one framing is plenty. The model honors plain words: static, slow push, drone
pullback, handheld; close-up, medium, wide; eye-level, overhead.

<div className="rea-example rea-example-dont">
  Cinematic camera work, dramatic angle changes, smooth but dynamic movement.
</div>

<div className="rea-example rea-example-do">
  Slow push-in from medium shot to close-up, eye-level, shallow depth of field.
</div>

Adjectives like "cinematic" or "dynamic" are wishes about the output, not descriptions of the shot;
translate each into what the camera literally does.

### 3. Soundscape (every prompt, one clause — richer if you can afford it)

End every prompt with a short clause of what the microphone hears: ambience, music mood, or effects.
Clips come out flat without it. Keep it to what sound *is*, not what it looks like.

<div className="rea-example rea-example-dont">
  …in the diner. Quiet and moody audio.
</div>

<div className="rea-example rea-example-do">
  …in the diner. Rain on glass, a coffee machine hiss, low late-night radio murmur.
</div>

When the single clause is fighting you for room, see the two lanes below.

### 4. Dialogue (only when someone speaks — always quoted)

When a scene implies speech, write the dialogue out exactly: name who speaks, give the words in
quotes, and describe the voice. Unguided, the model invents delivery you cannot predict.

<div className="rea-example rea-example-dont">
  The cook tells her to leave, angrily.
</div>

<div className="rea-example rea-example-do">
  The cook says in a low, tired voice: "Last orders were an hour ago." He does not look up from the
  pass.
</div>

#### Two or more voices: speaker tags

When a clip carries two or more speakers, give each a stable tag at first mention and reuse the tag
at every later line. The checkpoint was trained on prompts that do exactly that, and the tag is what
keeps the voices separate:

<div className="rea-example rea-example-dont">
  The cook tells her to leave and she says she just wants coffee. Both of them sound tired.
</div>

<div className="rea-example rea-example-do">
  S1 (the cook, low tired voice): "Last orders were an hour ago." S2 (the woman, softer): "Just
  coffee, then I'll go." Rain on the window behind them.
</div>

### Negative space

Don't write what should be absent. "No crowds, no text" renders crowds and text. Instead name the
positive state: "an empty platform," "a bare brick wall." Text overlays, UI, and scene numbers are
off-limits in both directions: don't ask for them, and don't be surprised when the model can't draw
them.

## Putting it together

A complete FastH3 prompt, \~340 characters, that would sit in one `enqueue`:

> A fog-laden lighthouse cliff at blue hour, waves breaking black on jagged rocks far below. A
> keeper in a waxed yellow coat climbs the spiral stair, lantern swinging. Handheld following shot,
> medium, shallow depth of field. Wind howl, gull cries, the lantern's rattle, his wet boots on
> iron.

And its continuing-scene counterpart: a *second* clip enqueued with `continue_from_clip_id` naming
the first. The continuation prompt itself is still a complete, self-contained description of a scene
— the chain carries the frame, and the fresh prompt still re-establishes what the scene is. See
"Opening from a picture" below.

## Opening from a picture

Two fields on `enqueue` change where a clip opens from, and each rewards a slightly different
prompt. At most one can sit on any one enqueue.

### `starting_frame` (image-to-video)

`starting_frame` opens the clip from an uploaded still; the model then animates *that picture*, not
the picture's subject abstractly. Write the prompt to name the motion the still needs — the still
already carries the setting, so the prompt spends its characters on what moves and what it sounds
like:

<div className="rea-example rea-example-dont">
  A lighthouse keeper climbing stairs, foggy night, blue hour. (With a still already showing exactly
  that.)
</div>

<div className="rea-example rea-example-do">
  The keeper keeps climbing, lantern swinging against the railing. Handheld continue-upward. Wind
  howl, gull cries, lantern rattle, wet boots on iron.
</div>

The upload is pulled through the model's own decode before it anchors anything, so an
off-distribution photo or cartoon gets drawn toward the model's look rather than breaking it. The
seed anchors composition, not exact pixels — if you need the pixels preserved, you're asking for the
wrong thing.

### `continue_from_clip_id` (scene continuation)

`continue_from_clip_id` opens the new clip on the last frame of another clip, chaining the two into
one scene. Treat the inherited frame as picture-state, not text-state: the new prompt still has to
describe what the camera sees and hears. Two rules, both load-bearing:

1. **Every continuation scene is fully self-contained.** The model reads only this prompt's text;
   re-describe the whole scene from scratch even though the source's last frame carries the picture
   over.
2. **Every continuation scene opens on a described hard cut** — a new shot with a clearly different
   camera angle, distance, or location, written with the cut itself: *"Hard cut to a wide shot of
   …"*. A chain written as one continuous take degrades scene over scene until the picture smears
   and repeats.

Write the prompt as the next beat of an action that has already been moving, with the cut declaring
itself at the top:

<div className="rea-example rea-example-dont">
  Interior: a grand ballroom. (Continues a clip whose source ended on the rocky shore.)
</div>

<div className="rea-example rea-example-do">
  Hard cut to a wide shot: the breaker that was building all clip finally bursts over the rocks, spray
  reaching the camera. Handheld holds its line. Water roar, gull scatter, the horn again closer.
</div>

## Cadence by enqueue type

* **Plain (text-only)** — each prompt is one clip of 5.167–14.375 s, starting from nothing.
  Front-load the single most important beat in the first sentence; clips this short rarely have room
  for a second idea.
* **I2V (`starting_frame`)** — motion-first; the setting is already given.
* **Continuation (`continue_from_clip_id`)** — a described hard cut to a new shot, plus a full
  re-description of the scene the frame is in. The cut is what keeps the chain from degrading.

## Two lanes, one 800-character budget

The wire caps a prompt at 800 characters and `enqueue` **refuses** anything longer with a
`command_error` — there is no mid-word trim to survive. The house baseline above — scene → camera →
soundscape clause → quoted dialogue — is sized for that; it fits on one `enqueue` with headroom to
spare. Use it until it stops giving you the audio you want.

There is a denser lane that borrows two mechanisms from the format the FastVideo checkpoint was
trained on (the vendor's internal format). Keep it compact; don't ship a multi-clause prompt that
eats the entire 800-character budget.

* **Decompose the soundscape.** Instead of one run-on audio clause, budget 2–3 short clauses:
  soundscape (ambience bed) → music (mood + instrumentation, or explicitly "no music") → action SFX.
  The richer breakdown is what the checkpoint's training prompts carry.
* **Speaker tags for multi-voice clips.** As shown above, `SN (who + voice)` at first mention,
  reused at every later line. This is the mechanism that keeps two or three voices from blurring.

A dense-lane rewrite of the diner clip, \~640 characters:

> S1 (the cook, low tired voice): "Last orders were an hour ago." S2 (the woman, softer): "Just
> coffee, then I'll go." Dim 24-hour diner, teal and sodium-orange neon through rain-streaked
> windows, 3 a.m. Static medium wide shot, eye-level, shallow depth of field. Soundscape: rain on
> glass, a coffee machine hiss, low radio murmur. Music: none until the last line, when a jukebox
> picks up something slow and brassy. SFX: cup against laminate, stool swivel.

The checkpoint's training distribution carries richer structure per prompt than the wire accepts;
these compressed forms retain the parts we believe carry signal — audio decomposition and speaker
tags — at wire length.

### What the vendor's format does that the wire won't take

FastVideo's own validation samples for this checkpoint follow a format called
`integrated_multimodal_description`: `[Shot N]` time-anchored headers, multi-shot choreography,
explicit speaker IDs and language tags, and two closed audio slots named `overall_soundscape` and
`non_diegetic_music`. Those are worth knowing about, but a wire reader should understand the
differences hard:

* **Prompts are \~1580 characters median.** Far above the 800-character server cap; they get
  truncated mid-sentence if you paste them as-is.
* **`[Shot N]` timestamps have no wire meaning.** The queue is one prompt, one *clip*; cross-shot
  composition is what `continue_from_clip_id` is for — chain clips instead of pretending one
  `enqueue` holds several cuts.
* **`overall_soundscape:` and `non_diegetic_music:` are not wire fields.** The parts that do carry
  through are the *content* (ambience vs. music vs. SFX), not the keyword names; keep the
  decomposition and drop the scaffolding.
* **Language tags like `[English]` / `[Chinese]` are ceremonial at this length.** Name the voice and
  write the dialogue; don't spend scarce characters on tag metadata.

See the vendor's [FastH3 preview page](https://haoailab.com/blogs/fasth3-preview/) for fifteen
validation samples in the native format — read them for the vocabulary (ASMR foley, mood adjectives,
action SFX), not as copy-paste wire input.

## Prompt-length discipline

The 800-character cap is genuinely hard. Anything longer is rejected with a `command_error` and your
episode stops at that scene — so a prompt that fits reads wonderfully and a prompt that doesn't
simply never reaches the model. Aim for ≤ 700 and put the expendable clauses at the end (the
soundscape, secondary lighting, style details) not because they survive a truncation — there isn't
one — but because the clauses that do the most work live at the front of your budget either way.

## Anti-patterns

### Referring across clips

<div className="rea-example rea-example-dont">
  Now she steps outside, still soaked from the storm.
</div>

<div className="rea-example rea-example-do">
  The same mustard coat, rain-darkened and dripping, as she pushes open the diner door into the wet
  street. Rain on asphalt, a passing truck spray.
</div>

"Still soaked" has no referent the model can see. Bring the fact back into the frame by describing
it.

### Video-only prompts

<div className="rea-example rea-example-dont">
  A crowded night market, neon, steam, 24mm wide angle.
</div>

This renders a silent film unless "silent" was the instruction. The model's audio is the feature;
spend one clause on it.

### One prompt trying to be a sequence

<div className="rea-example rea-example-dont">
  The rocket lifts off, clears the tower, stages, and the capsule drifts in orbit over Earth.
</div>

<div className="rea-example rea-example-do">
  Four separate enqueues: the hold-down and ignition on the pad; the tower clearing; staging in black
  sky; the capsule over a blue horizon, cabin fan hum.
</div>

Each clip is an independent generation — it cannot carry the narrative of a multi-beat action. Break
beats into their own clips.

### Style prompts with no scene

<div className="rea-example rea-example-dont">
  Lush, ethereal, retro-futuristic, in the style of classic sci-fi book covers.
</div>

<div className="rea-example rea-example-do">
  A ringed gas giant fills the view through a station viewport, two figures in silver pressure suits
  at the glass. Amber console glow, deep-space black, painted-book-cover grain. Slow orbital drift,
  wide. Air recyclers, a distant klaxon, radio static.
</div>

Style words alone give the model nothing to draw. Anchor style to a scene it can render, then add
the style as one trailing clause.

## Runtime caveats

* **Seeds are per-clip.** In the queue, `set_seed` fixes the default and each seedless `enqueue`
  advances it by one — so "same seed" is a per-clip, not per-session, guarantee. Re-enqueue the same
  prompt, seed, canvas, and length and you get (approximately, kernel-dependent) the same clip back.
* **Prompt ≤ 800 chars is enforced at `enqueue`** with a `command_error`; the model never sees your
  over-length prompt half-applied.
* **`set_clip_seconds` snaps** to the nearest legal clip length; read the accepted value back in
  `clip_length_accepted` before assuming a duration.
* **A starting frame rides the model's own decode**, so an off-distribution photo or cartoon gets
  pulled toward the model's look instead of breaking it. That's a feature — but if you need the
  exact pixels preserved, you're asking for the wrong thing.
* **A continuation source doesn't need to have built yet** — the new clip waits for its anchor
  rather than failing, so an entire chain can be enqueued in one shot. Only a *missing* source
  (unknown id, or one already evicted as new builds finish) is a `command_error`.

## See also

* [FastH3 overview](/model-api-reference/fast-h3/overview): the model, the clip queue, tracks
* [FastH3 schema](/model-api-reference/fast-h3/schema): every command, event, and ClipInfo field
* [FastH3 tutorial](/model-api-reference/fast-h3/tutorial): driving a queue end to end
* [Concepts → Commands and messages](/concepts/commands-and-messages): the generic `sendCommand` /
  message contract
