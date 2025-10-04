// pages/app.js
document.addEventListener("DOMContentLoaded", () => {
  const API_BASE = "https://ai-app.babuakevin.workers.dev";

  const existing = localStorage.getItem("sessionId");
  const makeId = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  const sessionId = existing || makeId();
  localStorage.setItem("sessionId", sessionId);

  const log = document.getElementById("log");
  const msg = document.getElementById("msg");
  const sendBtn = document.getElementById("send");
  const sendStreamBtn = document.getElementById("sendStream");

  function append(line) {
    log.textContent += line + "\n\n";
    log.scrollTop = log.scrollHeight;
  }
  function appendInline(text) {
    log.textContent += text;
    log.scrollTop = log.scrollHeight;
  }

  // Non-streaming call
  async function sendMessage() {
    const text = msg.value.trim();
    if (!text) return;
    msg.value = "";
    sendBtn.disabled = true;

    append(`You: ${text}`);
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message: text })
      });
      const raw = await res.text();
      let data; try { data = JSON.parse(raw); } catch { data = { raw }; }
      if (res.ok && data.assistantText) append(`AI: ${data.assistantText}`);
      else append(`(error) ${res.status} ${raw}`);
    } catch (e) {
      append(`(network error) ${String(e)}`);
      console.error(e);
    } finally {
      sendBtn.disabled = false;
    }
  }

  // Streaming call — parses SSE/NDJSON lines
  async function sendMessageStream() {
    const text = msg.value.trim();
    if (!text) return;
    msg.value = "";
    sendStreamBtn.disabled = true;

    append(`You: ${text}`);
    append("AI: ");

    try {
      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message: text })
      });
      if (!res.ok || !res.body) {
        const t = await res.text();
        append(`\n(error) ${res.status} ${t}`);
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += dec.decode(value, { stream: true });

        // Split by newline, handle SSE "data: ..." lines
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);

          if (!line) continue;
          const payload = line.startsWith("data:") ? line.slice(5).trim() : line;

          if (payload === "[DONE]") { buffer = ""; break; }

          try {
            const obj = JSON.parse(payload);
            const piece = obj?.response ?? obj?.delta ?? obj?.text ?? "";
            if (piece) appendInline(piece);
          } catch {
          }
        }
      }

      // Flush any leftover JSON fragment
      const tail = buffer.trim();
      if (tail && tail !== "[DONE]") {
        try {
          const obj = JSON.parse(tail);
          const piece = obj?.response ?? obj?.delta ?? obj?.text ?? "";
          if (piece) appendInline(piece);
        } catch {}
      }

      append("");
    } catch (e) {
      append(`(network error) ${String(e)}`);
      console.error(e);
    } finally {
      sendStreamBtn.disabled = false;
    }
  }

  sendBtn?.addEventListener("click", sendMessage);
  sendStreamBtn?.addEventListener("click", sendMessageStream);
  msg?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      (e.metaKey || e.ctrlKey ? sendMessageStream() : sendMessage());
    }
  });

  const resetBtn = document.getElementById("reset");

  resetBtn.onclick = async () => {
    const res = await fetch(`${API_BASE}/api/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId })
    });
    const data = await res.json();
    append(`(Memory cleared: ${JSON.stringify(data)})`);
  };

  append("Ready. Type a message and press Send (or Stream).");
});