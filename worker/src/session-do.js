// ====== Durable Object for per-session memory ======
// Stores: history (array of turns) and summary (string)

export class SessionDO {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
  }

  async getHistory() {
    return (await this.storage.get("history")) || [];
  }
  async setHistory(history) {
    await this.storage.put("history", history);
  }

  async getSummary() {
    return (await this.storage.get("summary")) || "";
  }
  async setSummary(text) {
    await this.storage.put("summary", text);
  }

  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    if (method === "GET" && url.pathname === "/history") {
      const [history, summary] = await Promise.all([this.getHistory(), this.getSummary()]);
      return new Response(JSON.stringify({ history, summary }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (method === "POST" && url.pathname === "/append") {
      const body = await req.json();
      const history = await this.getHistory();
      history.push({ role: body.role, content: body.content });
      // keep last 80 messages (user/assistant entries)
      const trimmed = history.slice(-80);
      await this.setHistory(trimmed);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (method === "POST" && url.pathname === "/set-summary") {
      const body = await req.json();
      await this.setSummary(String(body.summary || ""));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (method === "POST" && url.pathname === "/reset") {
      await this.setHistory([]);
      await this.setSummary("");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }

    return new Response("Not found", { status: 404 });
  }
}