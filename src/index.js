const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
};

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=UTF-8",
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=UTF-8",
};

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const AUTH_HEADER = "x-api-key";
const SHARED_SECRET_VAR = "WORKER_SHARED_SECRET";
const GENERIC_VOICE_ERROR =
  "Sorry, I couldn't get a reliable answer right now. Please try again.";
const EMPTY_ANSWER_ERROR =
  "Sorry, I couldn't find a clear answer to that. Please try asking another way.";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({
        ok: true,
        service: "vision-siri-ai",
        message: "Worker is running.",
        routes: {
          health: "GET /health",
          ask: "POST /ask",
          askJson: "POST /ask.json",
          qboCallback: "GET /qbo/callback",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        configured: Boolean(env.GEMINI_API_KEY),
        authConfigured: Boolean(env[SHARED_SECRET_VAR]),
        model: env.GEMINI_MODEL || DEFAULT_MODEL,
        grounding: "google_search",
      });
    }

    if (request.method === "GET" && url.pathname === "/qbo/callback") {
      return qboCallbackResponse(url);
    }

    if (request.method === "POST" && url.pathname === "/ask") {
      return handleAsk(request, env, { responseMode: "text" });
    }

    if (request.method === "POST" && url.pathname === "/ask.json") {
      return handleAsk(request, env, { responseMode: "json" });
    }

    return jsonResponse(
      {
        ok: false,
        error: "Not found",
      },
      404,
    );
  },
};

async function handleAsk(request, env, options) {
  const responseMode = options?.responseMode === "json" ? "json" : "text";

  if (!env.GEMINI_API_KEY) {
    return errorResponse(responseMode, "Worker is missing GEMINI_API_KEY.", 500);
  }

  if (!env[SHARED_SECRET_VAR]) {
    return errorResponse(responseMode, `Worker is missing ${SHARED_SECRET_VAR}.`, 500);
  }

  if (!isAuthorized(request, env[SHARED_SECRET_VAR])) {
    return errorResponse(responseMode, "Unauthorized.", 401);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return errorResponse(responseMode, "Request body must be valid JSON.", 400);
  }

  const question = normalizeQuestion(body.question);

  if (!question) {
    return errorResponse(responseMode, 'Provide a non-empty "question" string.', 400);
  }

  try {
    const result = await generateAnswer(question, env);

    if (!result.answer) {
      return errorResponse(responseMode, EMPTY_ANSWER_ERROR, 502);
    }

    if (responseMode === "text") {
      return textResponse(result.answer);
    }

    return jsonResponse({
      ok: true,
      question,
      answer: result.answer,
      sources: result.sources,
    });
  } catch (error) {
    console.error("AI request failed:", error);
    return errorResponse(responseMode, GENERIC_VOICE_ERROR, 502);
  }
}

async function generateAnswer(question, env) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "You answer spoken questions for a voice-first accessibility workflow. Reply with exactly one short sentence whenever possible, ideally under 25 words. Only use a second short sentence if it is necessary to avoid confusion or unsafe ambiguity. Start directly with the answer, skip preambles, avoid bullet points and formatting, and prefer plain everyday language that sounds natural aloud. If the question depends on current information, rely on Google Search grounding. If the answer is uncertain, say so briefly and plainly.",
            },
          ],
        },
        generationConfig: {
          maxOutputTokens: 80,
          temperature: 0.4,
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: question,
              },
            ],
          },
        ],
        tools: [
          {
            google_search: {},
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const answer = normalizeAnswer(extractOutputText(data));
  const sources = extractSources(data);

  return { answer, sources };
}

function isAuthorized(request, expectedSecret) {
  const providedSecret = request.headers.get(AUTH_HEADER);

  if (!providedSecret || typeof expectedSecret !== "string") {
    return false;
  }

  return timingSafeEqual(providedSecret, expectedSecret);
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function normalizeQuestion(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function normalizeAnswer(value) {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function extractOutputText(data) {
  if (!data || !Array.isArray(data.candidates)) {
    return "";
  }

  const parts = [];

  for (const candidate of data.candidates) {
    const content = candidate?.content;

    if (!Array.isArray(content?.parts)) {
      continue;
    }

    for (const part of content.parts) {
      if (typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function extractSources(data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks;

  if (!Array.isArray(chunks)) {
    return [];
  }

  const seen = new Set();
  const sources = [];

  for (const chunk of chunks) {
    const web = chunk?.web;

    if (!web?.uri || seen.has(web.uri)) {
      continue;
    }

    seen.add(web.uri);
    sources.push({
      title: web.title || web.uri,
      url: web.uri,
    });
  }

  return sources;
}

function qboCallbackResponse(url) {
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");

  if (error) {
    return htmlResponse(
      renderQboCallbackPage({
        title: "QuickBooks authorization did not complete",
        summary: errorDescription || error,
        details: [
          ["Error", error],
          ["Error description", errorDescription || "No additional detail returned."],
          ["State", state || "Not returned"],
        ],
        nextStep:
          "Return to mk-agents and run npm run oauth:connect again when you are ready to retry.",
        success: false,
      }),
      400,
    );
  }

  if (!code || !realmId) {
    return htmlResponse(
      renderQboCallbackPage({
        title: "QuickBooks callback is missing required values",
        summary:
          "Intuit did not return both the authorization code and realm ID, so mk-agents cannot finish the connection yet.",
        details: [
          ["Authorization code", code || "Missing"],
          ["Realm ID", realmId || "Missing"],
          ["State", state || "Not returned"],
        ],
        nextStep:
          "Return to mk-agents and restart the OAuth flow so Intuit can send a complete callback.",
        success: false,
      }),
      400,
    );
  }

  return htmlResponse(
    renderQboCallbackPage({
      title: "QuickBooks authorization is ready to finish",
      summary:
        "Copy the values below, then return to the mk-agents repo and complete the local save step with the command shown on this page.",
      details: [
        ["Authorization code", code],
        ["Realm ID", realmId],
        ["State", state || "Returned but optional for manual completion"],
      ],
      command: `npm run oauth:complete -- --code="${code}" --realm-id="${realmId}"`,
      nextStep:
        "After the command succeeds, run npm run oauth:status in mk-agents to confirm the production connection.",
      success: true,
    }),
  );
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function textResponse(message, status = 200) {
  return new Response(message, {
    status,
    headers: TEXT_HEADERS,
  });
}

function htmlResponse(message, status = 200) {
  return new Response(message, {
    status,
    headers: HTML_HEADERS,
  });
}

function errorResponse(responseMode, message, status) {
  if (responseMode === "text") {
    return textResponse(message, status);
  }

  return jsonResponse(
    {
      ok: false,
      error: message,
    },
    status,
  );
}

function renderQboCallbackPage(options) {
  const tone = options.success ? "#14532d" : "#7f1d1d";
  const surface = options.success ? "#f0fdf4" : "#fef2f2";
  const border = options.success ? "#86efac" : "#fecaca";
  const details = options.details
    .map(
      ([label, value]) => `
        <div class="detail">
          <div class="label">${escapeHtml(label)}</div>
          <code>${escapeHtml(value)}</code>
        </div>
      `,
    )
    .join("");
  const command = options.command
    ? `
      <section class="command-block">
        <h2>Finish in mk-agents</h2>
        <p>Run this command locally in the <code>mk-agents</code> repo:</p>
        <pre><code>${escapeHtml(options.command)}</code></pre>
      </section>
    `
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #f7f4ec;
        color: #1f2937;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top, rgba(191, 219, 254, 0.55), transparent 42%),
          linear-gradient(180deg, #f9fafb 0%, #f3efe4 100%);
      }

      main {
        width: min(760px, 100%);
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 24px;
        padding: 32px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        border-radius: 999px;
        background: ${surface};
        border: 1px solid ${border};
        color: ${tone};
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }

      h1 {
        margin: 18px 0 12px;
        font-size: clamp(2rem, 5vw, 2.8rem);
        line-height: 1.05;
      }

      p {
        margin: 0 0 18px;
        font-size: 1rem;
        line-height: 1.65;
      }

      .details {
        margin: 28px 0;
        display: grid;
        gap: 14px;
      }

      .detail {
        padding: 16px;
        border-radius: 18px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }

      .label {
        margin-bottom: 8px;
        font-size: 0.85rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #475569;
      }

      code,
      pre {
        font-family: "SFMono-Regular", "SF Mono", "Consolas", monospace;
      }

      code {
        display: block;
        white-space: pre-wrap;
        word-break: break-word;
        color: #0f172a;
      }

      .command-block {
        margin: 28px 0;
        padding: 20px;
        border-radius: 20px;
        background: #111827;
        color: #f8fafc;
      }

      .command-block h2 {
        margin: 0 0 10px;
        font-size: 1.15rem;
      }

      .command-block p {
        margin: 0 0 14px;
        color: #cbd5e1;
      }

      pre {
        margin: 0;
        overflow-x: auto;
      }

      footer {
        margin-top: 24px;
        font-size: 0.95rem;
        color: #475569;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="status">${options.success ? "Ready to finish" : "Needs attention"}</div>
      <h1>${escapeHtml(options.title)}</h1>
      <p>${escapeHtml(options.summary)}</p>
      <section class="details">${details}</section>
      ${command}
      <footer>${escapeHtml(options.nextStep)}</footer>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
