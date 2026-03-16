const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
};

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=UTF-8",
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
              text: "You answer spoken questions for a voice-first accessibility workflow. Keep answers natural and easy to hear read aloud. Use one or two short sentences whenever possible. Start directly with the answer, skip preambles, and avoid bullet points or formatting. If the question depends on current information, rely on Google Search grounding. If the answer is uncertain, say so briefly and plainly.",
            },
          ],
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
