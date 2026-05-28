exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { transcript, apiKey } = JSON.parse(event.body);

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
        system: `You are an expert meeting analyst for a vacation rental management and construction company on Anna Maria Island, FL (Beach Life Rentals and AMI Construction Group). Analyze the meeting transcript and return ONLY valid JSON with no markdown fences or extra text:
{
  "title": "concise 4-6 word meeting title",
  "summary": "2-3 sentence executive summary of key discussion points",
  "action_items": ["Owner/person: specific action item"],
  "insights": ["key decision or notable insight"],
  "speakers": ["Speaker 1", "Speaker 2"]
}`,
        messages: [{ role: "user", content: `Transcript:\n${transcript}` }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    const cleaned = text.replace(/```json|```/g, "").trim();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ result: cleaned }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
