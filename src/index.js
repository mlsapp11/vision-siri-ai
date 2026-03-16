const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
};

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
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        configured: Boolean(env.GEMINI_API_KEY),
        model: env.GEMINI_MODEL || "gemini-2.5-flash-lite",
        grounding: "google_search",
      });
    }

    if (request.method === "POST" && url.pathname === "/ask") {
      return handleAsk(request, env);
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

async function handleAsk(request, env) {
  if (!env.GEMINI_API_KEY) {
    return jsonResponse(
      {
        ok: false,
        error: "Missing GEMINI_API_KEY secret.",
      },
      500,
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Request body must be valid JSON.",
      },
      400,
    );
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";

  if (!question) {
    return jsonResponse(
      {
        ok: false,
        error: 'Provide a non-empty "question" string.',
      },
      400,
    );
  }

  try {
    const result = await generateAnswer(question, env);

    return jsonResponse({
      ok: true,
      question,
      answer: result.answer,
      sources: result.sources,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return jsonResponse(
      {
        ok: false,
        error: "AI request failed.",
        details: message,
      },
      502,
    );
  }
}

async function generateAnswer(question, env) {
  const model = env.GEMINI_MODEL || "gemini-2.5-flash-lite";
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
              text: "You answer spoken questions for a voice-first accessibility workflow. Keep answers short, clear, and natural when read aloud. Use one to three short sentences. If current information matters, rely on Google Search grounding.",
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
  const answer = extractOutputText(data);
  const sources = extractSources(data);

  if (!answer) {
    throw new Error("Gemini API returned no output text.");
  }

  return { answer, sources };
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
