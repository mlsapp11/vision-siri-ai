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

1. Siri or another client sends a `POST` request to `/ask` with JSON like `{"question":"..."}`.
2. The Worker validates the request and reads `GEMINI_API_KEY` from environment bindings.
3. The Worker calls Gemini's `generateContent` endpoint using the `google_search` tool.
4. Gemini returns a short answer plus grounding metadata.
5. The Worker responds with JSON containing the original question, answer text, and extracted source links.

This is currently a stateless design:

- no database
- no user accounts
- no file storage
- no conversation memory
- no authentication yet on the public endpoint

## Current behavior

Routes exposed by the Worker:

- `GET /` returns a basic status payload and route list
- `GET /health` returns whether the Worker is configured plus the active model
- `POST /ask` accepts a JSON body with a `question` string and returns a grounded answer

Example request:

```bash
curl -X POST http://127.0.0.1:8787/ask \
  -H "content-type: application/json" \
  -d '{"question":"What is the weather in New York today?"}'
```

Example response shape:

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

Create a local `.dev.vars` file in the project root:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash-lite
```

Important:

- `.dev.vars` is for local development only
- `.dev.vars` is ignored by git and must never be committed
- use `.dev.vars.example` as the template

Run locally:

```bash
npm run dev
```

Then test:

```bash
curl -X POST http://127.0.0.1:8787/ask \
  -H "content-type: application/json" \
  -d '{"question":"What happened in the news today?"}'
```

## Cloudflare deployment

Production secrets should be stored in Cloudflare, not in source control.

Set the Gemini API key as a Worker secret:

```bash
npx wrangler secret put GEMINI_API_KEY
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

## Known limitations

The current version is intentionally simple, but there are important gaps:

- the endpoint is public and does not yet require authentication
- answers are shorter than normal chat, but could still be shortened further for Siri playback
- the response includes raw source links, which may or may not be needed in the final spoken workflow
- there is no request logging, rate limiting, analytics, or abuse protection
- there is no structured handling yet for follow-up questions or conversational context
- there is no dedicated Siri Shortcut contract yet beyond basic HTTP JSON

## Suggested next steps

Good next development tasks:

- tighten the prompt so answers are usually one or two sentences
- decide whether the final Siri flow should speak only `answer` and ignore `sources`
- add lightweight authentication so the public Worker cannot be abused
- define the exact Siri Shortcut request and response contract
- add input normalization for dictated speech
- add better error handling for network failures and empty grounding results
- consider a dedicated route for a plain-text voice response if the shortcut does not need JSON

## Handoff notes for a new Codex session

If continuing this project in a new chat, the most useful starting context is:

- this is a Cloudflare Worker project for accessibility, not a general chatbot
- the main design goal is reliable, current, short answers for voice playback
- the Worker already works locally and remotely with Gemini plus Google Search grounding
- local secrets live in `.dev.vars`
- deployed secrets must live in Cloudflare Worker secrets
- the main code path is in [src/index.js](/Users/mike/vision-siri-ai/src/index.js)
- the current deployment config is in [wrangler.jsonc](/Users/mike/vision-siri-ai/wrangler.jsonc)
- the deployed URL is `https://vision-siri-ai.mikesapp.workers.dev`
- the next major product decision is how the Siri Shortcut should call this and what exact response format it should expect

## Security note

API keys must never be committed. If a key is ever exposed in chat, logs, screenshots, or source control, revoke it and replace it immediately.
