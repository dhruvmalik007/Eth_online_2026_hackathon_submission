// Vertex AI chat-model smoke test — run: VERTEX_AI_MODEL=gemini-2.5-flash-lite npx tsx scripts/vertex-smoke.ts
import 'dotenv/config';

async function main() {
  const { ChatVertexAI } = await import('@langchain/google-vertexai');

  const model = new ChatVertexAI({
    model: process.env.VERTEX_AI_MODEL ?? 'gemini-2.5-flash-lite',
    temperature: 0.1,
    maxRetries: 1,
  });

  // 1. Plain invoke
  const t0 = Date.now();
  const res = await model.invoke('Reply with exactly one word: READY');
  const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
  console.log(`[vertex-smoke] plain latency=${Date.now() - t0}ms response=${text.slice(0, 60)}`);

  // 2. Zod-based tool (what LangChain/deepagents use internally)
  const { tool } = await import('@langchain/core/tools');
  const z = await import('zod');
  const probe = tool(async () => '42', {
    name: 'get_answer',
    description: 'Returns the answer',
    schema: z.z.object({ question: z.z.string().describe('The question to answer') }),
  });
  const bound = model.bindTools([probe]);
  const t1 = Date.now();
  const res2 = await bound.invoke('What is the answer to "meaning of life"? Use the tool.');
  const toolCalls = Array.isArray(res2.tool_calls) ? res2.tool_calls : [];
  console.log(`[vertex-smoke] zod-tool latency=${Date.now() - t1}ms toolCalls=${toolCalls.length} name=${toolCalls[0]?.name ?? 'none'} args=${JSON.stringify(toolCalls[0]?.args ?? {})}`);
}

main().catch((err) => {
  console.error('[vertex-smoke] FAILED:', (err as Error).message.slice(0, 500));
  process.exit(1);
});
