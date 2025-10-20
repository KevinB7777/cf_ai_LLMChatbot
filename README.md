# cf_ai_chat

Minimal end-to-end AI chat app built on **Cloudflare**, demonstrating:
- **Workers AI** (LLM inference)
- **Worker** (API endpoints for chat, streaming, reset)
- **Durable Object** (conversation memory)
- **Pages** (simple frontend UI)

---

## Features
- **Non-streaming chat**: one-shot responses from an LLM (`/api/chat`)
- **Streaming chat**: token-by-token replies with real-time display (`/api/chat/stream`)
- **Persistent memory**: conversation history stored in a Durable Object
- **Reset**: clear memory and start fresh (`/api/reset`)
- **Minimal UI**: static HTML/JS page hosted on Cloudflare Pages

---

## Quick start

### 1. Install Wrangler & login
```bash
npm i -g wrangler
wrangler login
```

### 2. Deploy the backend (Worker)
```bash
cd worker
wrangler deploy
```

Copy the printed Worker URL, e.g:

```
https://ai-app.<account>.workers.dev
```

### 3. Configure frontend
In `pages/app.js`, set the Worker URL:
```js
const API_BASE = "https://ai-app.<account>.workers.dev";
```

### 4. Run the frontend
Open `pages/index.html` in your browser.  
Or serve it locally with:
```bash
npx serve pages
```
Then visit http://localhost:3000/

---

## Test endpoints via curl

### Chat (non-streaming)
```bash
curl -X POST "https://ai-app.<account>.workers.dev/api/chat"   -H "content-type: application/json"   -d '{"sessionId":"test","message":"Hello!"}'
```

### Streaming chat
```bash
curl -N -X POST "https://ai-app.<account>.workers.dev/api/chat/stream"   -H "content-type: application/json"   -d '{"sessionId":"test","message":"Hello!"}'
```

### Reset memory
```bash
curl -X POST "https://ai-app.<account>.workers.dev/api/reset"   -H "content-type: application/json"   -d '{"sessionId":"test"}'
```

---

## Change the model (Optional)
In `worker/src/index.js`, edit:
```js
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
```


---

## Project structure
```
cf_ai_chat/
├── worker/          # Worker backend
│   └── src/index.js # API routes
├── pages/           # Frontend (HTML, CSS, JS)
│   ├── index.html   # Simple UI
│   └── app.js       # Chat + stream logic
├── README.md        # Project documentation
└── PROMPTS.md       # AI prompts used in development
```

---

## Optional Assignment Notes
This repo implements all required components for the Cloudflare AI assignment:

- **LLM**: Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- **Workflow / coordination**: Worker + Durable Object for state
- **User input**: Chat interface with send + stream buttons
- **Memory/state**: Session history + summary stored in Durable Object

👉 To be considered, repository name must be prefixed with **`cf_ai_`** and include:
- `README.md` (this file)

---

## Demo
- Backend: `https://ai-app.<account>.workers.dev`
- Frontend: open `/pages/index.html` or deploy via **Cloudflare Pages**

---
