import { HttpError, providerJSON } from "./providers.js";

export async function generateNarration(topic, requireAI = false) {
  topic = String(topic || "")
    .trim()
    .slice(0, 300);
  if (topic.length < 3)
    throw new HttpError(400, "Add a topic with at least three characters.");
  if (process.env.OPENROUTER_API_KEY) {
    const result = await providerJSON(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
          max_tokens: 1200,
          messages: [
            {
              role: "system",
              content:
                "Write an accurate, engaging 150-250 word YouTube narration script. Plain text only, no headings or stage directions. Do not invent facts, sources, or statistics.",
            },
            { role: "user", content: topic },
          ],
        }),
      },
      "AI script writing",
    );
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length < 10)
      throw new HttpError(
        502,
        "The script provider did not return a usable script. Try again.",
      );
    return { content: content.trim().slice(0, 8000), source: "ai" };
  }
  if (requireAI)
    throw new HttpError(
      503,
      "Recurring AI series require a server-side OPENROUTER_API_KEY.",
    );
  return {
    source: "starter",
    content: `What makes ${topic} worth exploring? Sometimes, the most interesting stories begin with a simple question.\n\nIn this video, we are taking a closer look at ${topic}. Start with what you already know, then look for the detail you might have missed. A new perspective can turn an ordinary subject into a remarkable story.\n\nConsider the people, places, and ideas connected to this topic. What changed over time? What surprised you? Add one verified example here to make the story your own.\n\nThe next time you think about ${topic}, take a moment to look a little closer. There is always more to discover. If this sparked your curiosity, save this video and join us for the next story.`,
  };
}
