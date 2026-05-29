exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { transcript, apiKey } = JSON.parse(event.body || "{}");

    if (!transcript) return { statusCode: 400, headers, body: JSON.stringify({ error: "No transcript" }) };
    if (!apiKey) return { statusCode: 400, headers, body: JSON.stringify({ error: "No API key" }) };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: `You are an expert meeting analyst for Beach Life Rentals and AMI Construction Group on Anna Maria Island FL. Return ONLY valid JSON, no markdown fences:
{"title":"4-6 word title","summary":"2-3 sentence summary","action_items":["person: action"],"insights":["key insight"],"speakers":["Speaker 1"]}`,
        messages: [{ role: "user", content: `Transcript:\n${transcript}` }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: `Anthropic ${response.status}: ${errText}` }) };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "{}";
    const cleaned = text.replace(/```json|```/g, "").trim();

    return { statusCode: 200, headers, body: JSON.stringify({ result: cleaned }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
