> ## Documentation Index
> Fetch the complete documentation index at: https://docs.reactor.inc/llms.txt
> Use this file to discover all available pages before exploring further.

> ## Agent Instructions
> Reactor hosts multiple models, each with its own connect slug (modelName) and command/event schema. The catalog of every model — slug, typed SDK package, and links to its schema — is at /model-api-reference/overview. Some models expose one slug per experience (e.g. HappyOyster); always take the slug from the model's own pages, never guess it.
> Fastest path to a working app: `npx create-reactor-app my-app --model=<slug>` scaffolds a complete app with secure auth wired up. Typed TypeScript SDKs are published as @reactor-models/<model>; Python uses the base reactor-sdk package.
> Auth: exchange an API key (rk_...) for a JWT via POST https://api.reactor.inc/tokens from your server. Never put the API key in client-side code.
> Append .md to any docs URL for clean Markdown. Search these docs via the MCP server at https://docs.reactor.inc/mcp.

# Build with Reactor

> The developer platform for real-time world models

<Frame>
  <img src="https://mintcdn.com/reactortechnologiesinc/3wrpLd7R1K3eK0X3/images/rea-156.webp?fit=max&auto=format&n=3wrpLd7R1K3eK0X3&q=85&s=23650f745b4678f00d3ed57e35947f8b" alt="A lone figure walking down a misty avenue of tall trees" width="1280" height="768" data-path="images/rea-156.webp" />
</Frame>

Reactor makes it easy to build applications with real-time world models. In just a few lines of code, you connect to a model, receive live video, and send commands to steer what it generates while it runs, enabling entirely new types of applications that were not possible before.

<div className="rea-stats">
  <div className="rea-stat">
    <span className="rea-stat-value">\<1s</span>
    <span className="rea-stat-label">Round-trip latency</span>
  </div>

  <div className="rea-stat">
    <span className="rea-stat-value">Zero</span>
    <span className="rea-stat-label">Infrastructure to manage</span>
  </div>

  <div className="rea-stat">
    <span className="rea-stat-value">1,000s</span>
    <span className="rea-stat-label">of GPUs, on demand</span>
  </div>
</div>

Connect to Reactor's SDK and immediately start steering real-time video:

<CodeGroup>
  ```typescript JavaScript theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  import { Reactor } from "@reactor-team/js-sdk";

  const video = document.querySelector("video")!;
  const reactor = new Reactor({ modelName: "reactor/helios" });

  // Render frames as soon as they arrive.
  reactor.on("trackReceived", (name, track) => {
    if (name !== "main_video") return;
    video.srcObject = new MediaStream([track]);
    void video.play();
  });

  // Once the session is ready, set a prompt and start generating.
  reactor.on("statusChanged", async (status) => {
    if (status !== "ready") return;
    await reactor.sendCommand("set_prompt", { prompt: "A serene mountain landscape at sunrise" });
    await reactor.sendCommand("start", {});
  });

  const jwt = await getToken(); // token minted on your server
  await reactor.connect(jwt);
  ```

  ```tsx React theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  import { ReactorProvider, ReactorView, useReactor } from "@reactor-team/js-sdk";
  import { useEffect } from "react";

  function Studio() {
    const { status, sendCommand } = useReactor((s) => ({
      status: s.status,
      sendCommand: s.sendCommand,
    }));

    // Once the session is ready, set a prompt and start generating.
    useEffect(() => {
      if (status !== "ready") return;
      sendCommand("set_prompt", { prompt: "A serene mountain landscape at sunrise" });
      sendCommand("start", {});
    }, [status]);

    return <ReactorView className="w-full aspect-video" />;
  }

  export default function App({ token }: { token: string }) {
    // token is minted on your server
    return (
      <ReactorProvider modelName="reactor/helios" jwtToken={token} connectOptions={{ autoConnect: true }}>
        <Studio />
      </ReactorProvider>
    );
  }
  ```

  ```python Python theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
  import asyncio
  import os
  from reactor_sdk import Reactor

  async def main():
      async with Reactor(model_name="reactor/helios", api_key=os.environ["REACTOR_API_KEY"]) as reactor:
          await reactor.connect()

          # Receive decoded frames as NumPy arrays.
          output = reactor.tracks.with_direction("recvonly").with_kind("video").one()

          @output.on_frame
          def on_frame(frame):
              ...

          # Set a prompt and start generating.
          await reactor.send_command("set_prompt", {"prompt": "A serene mountain landscape at sunrise"})
          await reactor.send_command("start", {})

  asyncio.run(main())
  ```
</CodeGroup>

Or scaffold a complete, runnable app — SDK installed and secure auth already wired up — in one command:

```shell theme={"theme":{"light":"github-light","dark":"github-dark-high-contrast"}}
npx create-reactor-app my-app --model=helios
```

## Start building

<CardGroup cols={3}>
  <Card title="Quickstart" icon="zap" href="/quickstart">
    Stream real-time AI video into your app in a few minutes.
  </Card>

  <Card title="Using the SDK" icon="code" href="/sdk-reference/using-the-sdk">
    Connect and steer models from JavaScript, React, or Python.
  </Card>

  <Card title="Explore the models" icon="wand-sparkles" href="/model-api-reference/overview">
    Browse every model on Reactor and the commands that drive each one.
  </Card>
</CardGroup>
