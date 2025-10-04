// ===== Cloudflare Worker: API routes (streaming + memory) =====
// Endpoints:
//   GET  /                 -> health text
//   POST /api/chat         -> non-streaming JSON {assistantText}
//   POST /api/chat/stream  -> streaming plain text (tokens)
//   POST /api/reset        -> clears session memory (history+summary)

import { SessionDO } from "./session-do.js";
export { SessionDO };

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      ...extraHeaders
    }
  });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET,POST,OPTIONS"
        }
      });
    }

    if (method === "GET" && url.pathname === "/") {
      return new Response("AI app worker is running.");
    }

    // ---------- STREAMING CHAT ----------
    if (method === "POST" && url.pathname === "/api/chat/stream") {
      try {
        const { sessionId, message } = await req.json();
        if (!sessionId || !message) {
          return new Response("sessionId and message required", { status: 400 });
        }

        const { history, summary, stub } = await getState(env, sessionId);

        const messages = [
          summary
            ? { role: "system", content: `Conversation summary:\n${summary}` }
            : { role: "system", content: "You are a concise, helpful assistant." },
          ...history,
          { role: "user", content: String(message).trim().slice(0, 4000) }
        ];

        const ai = await env.AI.run(MODEL, { messages, stream: true });

        // CASE A: ai is a WHATWG ReadableStream (has getReader/tee)
        if (ai && typeof ai.getReader === "function" && typeof ai.tee === "function") {
          // tee() gives two copies: one to send to client, one to buffer for saving
          const [toClient, toBuffer] = ai.tee();

          const decoder = new TextDecoder();
          let full = "";
          (async () => {
            const reader = toBuffer.getReader();
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              full += decoder.decode(value, { stream: true });
            }
            full += decoder.decode(); // flush
            await persistTurns(stub, message, full);
          })();

          return new Response(toClient, {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
              "access-control-allow-origin": "*"
            }
          });
        }

        // CASE B: ai is an async iterator of parts
        if (ai && typeof ai[Symbol.asyncIterator] === "function") {
          const encoder = new TextEncoder();
          let full = "";

          const out = new ReadableStream({
            async start(controller) {
              try {
                for await (const part of ai) {
                  const piece = (part?.response ?? part?.delta ?? part?.text ?? "").toString();
                  if (piece) {
                    full += piece;
                    controller.enqueue(encoder.encode(piece));
                  }
                }
              } finally {
                controller.close();
              }
            }
          });

          ctx.waitUntil(persistTurns(stub, message, full));

          return new Response(out, {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
              "access-control-allow-origin": "*"
            }
          });
        }

        return new Response("stream not available", { status: 500 });
      } catch (e) {
        return new Response("stream error: " + String(e?.message || e), { status: 500 });
      }
    }

    // ---------- NON-STREAMING CHAT ----------
    if (method === "POST" && url.pathname === "/api/chat") {
      try {
        const { sessionId, message } = await req.json();
        if (!sessionId || !message) return json({ error: "sessionId and message required" }, 400);

        const { history, summary, stub } = await getState(env, sessionId);

        // Optional: summarize long history
        if (history.length > 60) {
          await summarizeAndTrim(env, stub, history, summary);
        }

        const cleaned = String(message).trim().slice(0, 4000);
        const hs2 = await (await stub.fetch("https://do/history")).json();
        const history2 = hs2.history || [];
        const summary2 = hs2.summary || "";

        const messages = [
          summary2
            ? { role: "system", content: `Conversation summary:\n${summary2}` }
            : { role: "system", content: "You are a concise, helpful assistant." },
          ...history2,
          { role: "user", content: cleaned }
        ];

        const ai = await env.AI.run(MODEL, { messages });
        const assistantText = (ai?.response || ai?.output_text || ai?.result || ai?.text || "").toString();

        await persistTurns(stub, cleaned, assistantText);

        return json({ assistantText });
      } catch (err) {
        return json({ error: String(err?.message || err) }, 500);
      }
    }

    // ---------- RESET ----------
    if (method === "POST" && url.pathname === "/api/reset") {
      const { sessionId } = await req.json();
      if (!sessionId) return json({ error: "sessionId required" }, 400);
      const id = env.SESSIONS.idFromName(sessionId);
      const stub = env.SESSIONS.get(id);
      await stub.fetch("https://do/reset", { method: "POST" });
      return json({ ok: true });
    }

    return new Response("Not Found", { status: 404 });
  }
};

// ===== helpers =====
async function getState(env, sessionId) {
  const id = env.SESSIONS.idFromName(sessionId);
  const stub = env.SESSIONS.get(id);
  const { history, summary } = await (await stub.fetch("https://do/history")).json();
  return { history: history || [], summary: summary || "", stub };
}

async function persistTurns(stub, userText, assistantText) {
  await stub.fetch("https://do/append", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "user", content: userText })
  });
  await stub.fetch("https://do/append", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "assistant", content: assistantText })
  });
}

async function summarizeAndTrim(env, stub, history, summary) {
  const oldest = history.slice(0, history.length - 40);
  const bullets = oldest.map(t => `${t.role.toUpperCase()}: ${t.content}`).join("\n");
  const prompt = [
    { role: "system", content: "Summarize the dialogue into concise bullet points with key facts, names, decisions, and tasks. Keep it under 150 words." },
    { role: "user", content: bullets }
  ];
  const sum = await env.AI.run(SUMMARIZE_MODEL, { messages: prompt });
  const sumText = (sum?.response || sum?.text || "").toString();
  const newSummary = summary ? (summary + "\n---\n" + sumText) : sumText;

  await stub.fetch("https://do/set-summary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ summary: newSummary })
  });
}