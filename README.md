# vision-siri-ai

`vision-siri-ai` is a Cloudflare Worker that supports a voice-first Siri workflow for an iPhone user with vision impairment. The Worker accepts a short question, sends it to Google's Gemini API with live web grounding enabled, and returns a short answer that is easier to hear read aloud than a typical chat response.

## Purpose

This project is being built for a real accessibility need. The intended user already relies heavily on Siri and should not have to learn a new interface or navigate a complicated app. The system should feel lightweight, dependable, and easy to repeat by voice.

That means the product priorities are:

- short spoken questions
- short spoken answers
- current information when the question is time-sensitive
- minimal interaction friction
- reliability over feature breadth

## Current architecture

The app currently consists of one Cloudflare Worker:

- [src/index.js](/Users/mike/vision-siri-ai/src/index.js): the HTTP interface and Gemini integration
- [wrangler.jsonc](/Users/mike/vision-siri-ai/wrangler.jsonc): Worker config and non-secret vars

Current request flow:

1. Siri or another client sends a `POST` request to `/ask` with JSON like `{"question":"..."}` and the shared secret header.
2. The Worker validates the request, normalizes dictated input, and reads secrets from environment bindings.
3. The Worker calls Gemini's `generateContent` endpoint using the `google_search` tool.
4. Gemini returns a short answer plus grounding metadata.
5. The Worker responds with plain text for Siri playback, or JSON on the debug route.

This is currently a stateless design:

- no database
- no user accounts
- no file storage
- no conversation memory
- shared-secret authentication on question routes

## Current behavior

Routes exposed by the Worker:

- `GET /` returns a basic status payload and route list
- `GET /health` returns whether the Worker is configured plus the active model
- `POST /ask` accepts a JSON body with a `question` string and returns plain text for Siri
- `POST /ask.json` accepts the same JSON body and returns debug-friendly JSON

Example request:

```bash
curl -X POST http://127.0.0.1:8787/ask \
  -H "content-type: application/json" \
  -H "x-api-key: your_shared_secret_here" \
  -d '{"question":"What is the weather in New York today?"}'
```

Example Siri response body:

```text
Cloudy in New York today with temperatures around the mid-40s.
```

Example debug response shape:

```json
{
  "ok": true,
  "question": "What is the weather in New York today?",
  "answer": "It is currently cloudy in New York with a temperature around 44 degrees.",
  "sources": [
    {
      "title": "Weather information for New York, NY, US",
      "url": "https://www.google.com/..."
    }
  ]
}
```

## AI provider choice

The current implementation uses:

- `Gemini 2.5 Flash Lite`
- Google AI Studio API key
- Gemini `google_search` grounding for current web information

This provider was chosen because the project needs up-to-date answers and the free tier is a good fit for low-volume testing.

## Local development

Install dependencies:

```bash
npm install
```

For deployed testing, you do not need local secret files. Put secrets in Cloudflare and test against the deployed Worker URL.

If you want to run `wrangler dev` locally with authenticated routes, Wrangler needs local secret bindings from a local env file.

Create a local `.dev.vars` file only if you need local authenticated testing:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
WORKER_SHARED_SECRET=your_shared_secret_here
```

Important:

- `.dev.vars` is optional and should exist only when you truly need local authenticated testing
- `.dev.vars` is ignored by git and must never be committed
- for your current workflow, testing against the deployed Worker is the simpler and safer path
- `.env.example` is only for non-secret local overrides such as `GEMINI_MODEL`

Run locally:

```bash
npm run dev
```

Then test:

```bash
curl -X POST http://127.0.0.1:8787/ask \
  -H "content-type: application/json" \
  -H "x-api-key: your_shared_secret_here" \
  -d '{"question":"What happened in the news today?"}'
```

Debug JSON route:

```bash
curl -X POST http://127.0.0.1:8787/ask.json \
  -H "content-type: application/json" \
  -H "x-api-key: your_shared_secret_here" \
  -d '{"question":"What happened in the news today?"}'
```

## Cloudflare deployment

Production secrets should be stored in Cloudflare, not in source control.

Set the Gemini API key as a Worker secret:

```bash
npx wrangler secret put GEMINI_API_KEY
```

Set the shared secret used by Siri Shortcuts:

```bash
npx wrangler secret put WORKER_SHARED_SECRET
```

Deploy the Worker:

```bash
npx wrangler deploy
```

Current non-secret config in [wrangler.jsonc](/Users/mike/vision-siri-ai/wrangler.jsonc):

- `name`: `vision-siri-ai`
- `compatibility_date`: `2026-03-15`
- `vars.GEMINI_MODEL`: `gemini-2.5-flash-lite`

Current deployed URL:

- `https://vision-siri-ai.mikesapp.workers.dev`

Example deployed test:

```bash
curl -X POST https://vision-siri-ai.mikesapp.workers.dev/ask \
  -H "content-type: application/json" \
  -H "x-api-key: your_shared_secret_here" \
  -d '{"question":"What happened in the news today?"}'
```

## Siri Shortcut setup

The current Siri flow is intentionally minimal and has been tested successfully against the deployed Worker.

Recommended Shortcut actions:

1. `Dictate Text`
2. `Get Contents of URL`
3. `Speak Text`

Configure `Get Contents of URL` like this:

- URL: `https://vision-siri-ai.mikesapp.workers.dev/ask`
- Method: `POST`
- Request Body: `JSON`
- JSON field:
  - `question` = `Dictated Text`
- Headers:
  - `content-type` = `application/json`
  - `x-api-key` = your shared secret

Why this works well:

- `/ask` returns plain text, so the Shortcut does not need to parse JSON
- the answer can be spoken directly with `Speak Text`
- a bad or missing shared secret returns `Unauthorized`, which is useful for quick auth checks during testing

Suggested `Dictate Text` setting:

- `Stop Listening`: `After Pause`

Recommended test phrase:

- `What is the weather in New York today?`

Practical note:

- response volume is controlled by iPhone and Shortcuts speech behavior, not by the Worker
- if spoken volume seems wrong, adjust volume while the Shortcut is actively speaking

## Known limitations

The current version is intentionally simple, but there are important gaps:

- the app uses only a shared secret, not stronger user-specific authentication
- answers are tuned for one or two short sentences, but prompt tuning will still need real-world iteration
- the Siri route does not expose source links, so verification lives on the debug JSON route
- there is no request logging, rate limiting, analytics, or abuse protection
- there is no structured handling yet for follow-up questions or conversational context
- the Siri Shortcut contract is intentionally minimal and may still need minor adjustments during device testing

## Suggested next steps

Good next development tasks:

- refine the Siri Shortcut experience now that the basic flow works end-to-end
- decide whether the shortcut should expose any fallback/debug info to the user
- add rate limiting or Cloudflare-side abuse controls if the endpoint will stay internet-accessible
- consider request logging or lightweight analytics for troubleshooting real usage
- explore dictated-speech cleanup beyond whitespace normalization if transcription issues show up

## Handoff notes for a new Codex session

If continuing this project in a new chat, the most useful starting context is:

- this is a Cloudflare Worker project for accessibility, not a general chatbot
- the main design goal is reliable, current, short answers for voice playback
- the Worker already works locally and remotely with Gemini plus Google Search grounding
- local authenticated testing requires optional `.dev.vars`
- deployed testing is the preferred path for auth validation
- deployed secrets must live in Cloudflare Worker secrets
- the main code path is in [src/index.js](/Users/mike/vision-siri-ai/src/index.js)
- the current deployment config is in [wrangler.jsonc](/Users/mike/vision-siri-ai/wrangler.jsonc)
- the deployed URL is `https://vision-siri-ai.mikesapp.workers.dev`
- the main Siri contract is authenticated `POST /ask` with a plain-text response
- the debug route is authenticated `POST /ask.json` with structured JSON

## Security note

API keys must never be committed. If a key is ever exposed in chat, logs, screenshots, or source control, revoke it and replace it immediately.
