> ## Documentation Index
> Fetch the complete documentation index at: https://docs.reactor.inc/llms.txt
> Use this file to discover all available pages before exploring further.

> ## Agent Instructions
> Reactor hosts multiple models, each with its own connect slug (modelName) and command/event schema. The catalog of every model — slug, typed SDK package, and links to its schema — is at /model-api-reference/overview. Some models expose one slug per experience (e.g. HappyOyster); always take the slug from the model's own pages, never guess it.
> Fastest path to a working app: `npx create-reactor-app my-app --model=<slug>` scaffolds a complete app with secure auth wired up. Typed TypeScript SDKs are published as @reactor-models/<model>; Python uses the base reactor-sdk package.
> Auth: exchange an API key (rk_...) for a JWT via POST https://api.reactor.inc/tokens from your server. Never put the API key in client-side code.
> Append .md to any docs URL for clean Markdown. Search these docs via the MCP server at https://docs.reactor.inc/mcp.

# FastH3 overview

> What FastH3 is, its key features, and a quickstart.

export const ModelRate = ({model}) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("https://api.reactor.inc/pricing", {
      signal: ctrl.signal
    }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }).then(json => {
      setData(json);
      setLoading(false);
    }).catch(err => {
      if (err.name === "AbortError") return;
      setError(true);
      setLoading(false);
    });
    return () => ctrl.abort();
  }, []);
  if (loading) {
    return <span aria-label="loading pricing" className="inline-block h-4 w-28 rounded bg-zinc-950/10 dark:bg-white/10 animate-pulse align-middle" />;
  }
  const creditsPerDollar = data?.settings?.credits_per_dollar;
  const amountPerSec = data?.models?.find(m => m.name === model)?.rate?.amount_per_sec;
  const canRender = !error && creditsPerDollar && typeof amountPerSec === "number";
  if (!canRender) {
    return <span className="text-zinc-950/60 dark:text-white/60">see current rate below</span>;
  }
  const dollarsPerSec = amountPerSec / creditsPerDollar;
  const perSec = dollarsPerSec.toFixed(4);
  const perHour = Math.round(dollarsPerSec * 3600);
  return <span>
      <strong>${perSec}/sec</strong>{" "}
      <span className="text-zinc-950/60 dark:text-white/60">(${perHour}/hr)</span>
    </span>;
};

**FastH3** is a real-time video generation model that renders prompt-driven clips with synchronized
audio in the same pass. The two things that set it apart are that sound is native to the generation
and that the model is built to be *scheduled*: it never decides what plays next, you do.

Everything runs through one ordered row of clips. New prompts land at the back; builds march down
the row turning each into a finished clip; and the currently playing clip is highlighted at the
front as it moves left to right. When a `play` (or autoplay) reaches a built clip, its frames run on
the track. Each clip normally opens from text alone; you can also pass `starting_frame` (an uploaded
still) or `continue_from_clip_id` (the last frame of another clip) so the two chain into a
continuing scene.

The FastH3 reference is split across four pages: this overview, the complete
[command and event schema](/model-api-reference/fast-h3/schema), the
[prompt guide](/model-api-reference/fast-h3/prompt-guide) for writing clips the model renders best,
and a [tutorial](/model-api-reference/fast-h3/tutorial) that drives a session end to end.

The base wire protocol is the same as every other Reactor model: open a session with the
[`Reactor`](/sdk-reference/reactor-class) class, send named commands, and receive events. The model
name is **`reactor/fast-h3`**. The
[`@reactor-models/fast-h3` typed package](/sdk-reference/typed-model-sdk) adds named methods and
React hooks for this protocol.

## At a glance

| Spec             | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| **Model name**   | `reactor/fast-h3`                                            |
| **Pricing**      | <ModelRate model="fast-h3" />                                |
| **Frame rate**   | 24 fps, fixed                                                |
| **Aspect ratio** | 1344×768 at launch (16:9), set per session with `set_canvas` |

<Note>
  Pass `reactor/fast-h3` to the SDK. Pass `fast-h3` to `create-reactor-app` as the template name.
  "FastH3" is the display name. Usage is billed per second of session time; see
  [Billing](/resources/billing) for how billing maps to rates.
</Note>

## Key features

<CardGroup cols={3}>
  <Card title="Native audio in the same pass" icon="volume-2">
    Pictures and sound generate together, so speech, ambience, and effects are born synchronized
    with the frame.
  </Card>

  <Card title="Your scheduler, not the model's" icon="list-video">
    `enqueue`, `move`, `pop`, `play`, `stop`, `set_autoplay` give a client full order control.
  </Card>

  <Card title="Image opens and scene chains" icon="image">
    `starting_frame` opens a clip from an uploaded still; `continue_from_clip_id` chains any clip
    off another's last frame into a continuing scene.
  </Card>
</CardGroup>

## Quick start

The fastest path to a working FastH3 app is the `create-reactor-app` CLI.

<Tabs>
  <Tab title="npm">
    ```shell theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
    npx create-reactor-app my-fast-h3-app --model=fast-h3
    ```
  </Tab>

  <Tab title="pnpm">
    ```shell theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
    pnpm create reactor-app my-fast-h3-app --model=fast-h3
    ```
  </Tab>
</Tabs>

Working in Python instead? The CLI is JavaScript-only, so install the SDK with
`pip install reactor-sdk` and follow the Python example below (see the [quickstart](/quickstart) for
the full walkthrough):

<CodeGroup>
  ```typescript TypeScript theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  import { Reactor } from "@reactor-team/js-sdk";

  const video = document.querySelector("video")!;
  const reactor = new Reactor({ modelName: "reactor/fast-h3" });

  // Render frames as soon as they arrive.
  reactor.on("trackReceived", (name, track, stream) => {
    if (name !== "main_video") return;
    video.srcObject = stream;
    void video.play();
  });

  // Once the session is ready, enqueue a clip and play it when built.
  reactor.on("statusChanged", async (status) => {
    if (status !== "ready") return;
    await reactor.sendCommand("enqueue", {
      prompt:
        "Aerial pullback over a rain-slicked night market, neon signs buzzing, steam rising off food carts. Slow continuous drone move, wide shot. Rain patter, vendor calls, sizzling woks.",
    });
  });

  reactor.on("message", async (msg) => {
    if (msg.type !== "clip_generated") return;
    // Autoplay starts each built clip on its own; manual `play` on a *second*
    // clip_generated would race and be refused ("another clip is playing").
    // Uncomment the line below instead if autoplay is off on this client.
    // await reactor.sendCommand("play", { clip_id: msg.data.clip.clip_id });
  });

  const jwt = await getToken(); // token minted on your server
  await reactor.connect(jwt);
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  import asyncio
  import os
  from reactor_sdk import Reactor, ReactorStatus

  async def main():
      reactor = Reactor(model_name="reactor/fast-h3",
                        api_key=os.environ["REACTOR_API_KEY"])

      @reactor.on_status(ReactorStatus.READY)
      async def on_ready(status):
          await reactor.send_command("enqueue", {
              "prompt": "Aerial pullback over a rain-slicked night market, neon signs buzzing, steam rising off food carts. Slow continuous drone move, wide shot. Rain patter, vendor calls, sizzling woks.",
          })

      @reactor.on_message
      def on_message(msg):
          if msg["type"] == "clip_generated":
              asyncio.ensure_future(
                  reactor.send_command("play", {"clip_id": msg["data"]["clip"]["clip_id"]})
              )

      await reactor.connect()
      await asyncio.Event().wait()  # run until interrupted

  asyncio.run(main())
  ```
</CodeGroup>

The examples above use the base SDK so the wire surface is fully visible end-to-end. The typed
package `@reactor-models/fast-h3` is on npm with named methods and React hooks; the
[tutorial](/model-api-reference/fast-h3/tutorial) uses it throughout against the open-source
[episodes example](https://github.com/reactor-team/js-sdk/tree/main/examples/fast-h3). See
[Typed Model SDKs](/sdk-reference/typed-model-sdk) for what the typed layer adds.

## How it works

On connect FastH3 is idle with a black output; nothing plays until a built clip exists and a `play`
asks for it. To get your first stream:

1. **Connect** to the model. The connection moves `disconnected → connecting → waiting → ready`, and
   the first `state_update` / `queue_update` land on connect.
2. **Optionally set session defaults** with
   [`set_clip_seconds`](/model-api-reference/fast-h3/schema#commands),
   [`set_seed`](/model-api-reference/fast-h3/schema#commands), and
   [`set_canvas`](/model-api-reference/fast-h3/schema#commands). Every `enqueue` snapshots these, so
   set them before the clips they should apply to.
3. **`enqueue` one or more clips.** Each gets a UUID and joins the back of the row; builds run down
   the row behind the scenes, turning each into a finished clip and announcing every one with
   `clip_generated` and `queue_update`.
4. **`play` a built clip.** Playback is explicit: `play` with no argument plays the next built clip
   in the row, or name a `clip_id`. Frames stream until the clip ends, then the row highlights the
   next built clip and waits for the next `play`. `set_autoplay` starts the next built clip on its
   own as each one finishes, so a steadily fed row plays through hands-free.
