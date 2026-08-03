import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const ANTHROPIC_MODELS = ["claude-sonnet-4-5", "claude-sonnet-4-20250514"];

async function anthropicCall(body: Record<string, unknown>): Promise<any> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("NO_ANTHROPIC_KEY");
  let lastErr = "";
  for (const model of ANTHROPIC_MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ ...body, model }),
    });
    if (r.ok) return r.json();
    lastErr = await r.text();
    if (r.status !== 404 && r.status !== 400) break;
  }
  throw new Error(`Anthropic failed: ${lastErr}`);
}

async function geminiCall(system: string, messages: any[]): Promise<string> {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error("NO_GEMINI_KEY");
  const contents = messages.map((m: any) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : m.content.map((b: any) => b.type === "text" ? b.text : "[image]").join("\n") }],
  }));
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents }),
    },
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.[0]?.text ?? "Anomaly detected, sir.";
}

async function chainedFallback(system: string, messages: any[]): Promise<{ reply: string; source: string }> {
  try {
    const reply = await geminiCall(system, messages);
    return { reply, source: "gemini" };
  } catch {
    return { reply: "My apologies, sir. All AI connections appear to be offline.", source: "offline" };
  }
}

const JARVIS_BASE = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), the personal AI of Imran. You are calm, precise, with dry British wit. Address the user as "sir". You have access to 5 specialist agents (Developer, Marketing, Research, Sales, PM) and 30 tools. You learn from every interaction. Be concise but complete.`;

const ROUTER_SYSTEM = `You are JARVIS's intent router. Analyze the user command and return ONLY valid JSON — no explanation, no markdown.

Phone & system actions:
{ "action": "call", "contact": "name", "number": "digits or null" }
{ "action": "whatsapp", "contact": "name", "number": "digits or null", "message": "text or null" }
{ "action": "sms", "contact": "name", "number": "digits or null", "message": "text or null" }
{ "action": "telegram", "contact": "username or null", "message": "text or null" }
{ "action": "instagram", "query": "username or hashtag or null" }
{ "action": "twitter", "query": "search or null", "message": "tweet text or null" }
{ "action": "spotify", "query": "song/artist" }
{ "action": "uber", "destination": "place name" }
{ "action": "navigate", "destination": "place name" }
{ "action": "youtube", "query": "search terms" }
{ "action": "search", "query": "search terms" }
{ "action": "email", "to": "email", "subject": "text", "body": "text" }
{ "action": "alarm", "hour": 0-23, "minute": 0-59, "label": "text" }
{ "action": "timer", "seconds": number, "label": "text" }
{ "action": "weather", "location": "name or null" }
{ "action": "battery" }
{ "action": "remember", "category": "project|client|task|preference", "title": "short title", "content": "details" }
{ "action": "agent", "agent": "developer|marketing|research|sales|pm", "task": "verbatim user request" }
{ "action": "build_website", "description": "the full website brief" }
{ "action": "camera", "task": "describe|analyze|ocr|qr" }
{ "action": "chat" }

Return ONLY the JSON.`;

const AGENT_PROMPTS: Record<string, string> = {
  developer: `${JARVIS_BASE}\n\nYou are operating as JARVIS's DEVELOPER AGENT. You specialize in full-stack development, architecture, code review, debugging, and technical excellence. Provide clean, production-ready code with explanations.`,
  marketing: `${JARVIS_BASE}\n\nYou are operating as JARVIS's MARKETING AGENT. You specialize in brand strategy, ad copy, campaign design, social media, SEO, and growth hacking. Think like a CMO.`,
  research: `${JARVIS_BASE}\n\nYou are operating as JARVIS's RESEARCH AGENT. You synthesize complex information, find patterns, and provide comprehensive analysis. Cross-reference multiple perspectives.`,
  sales: `${JARVIS_BASE}\n\nYou are operating as JARVIS's SALES AGENT. You specialize in proposals, client relations, negotiation tactics, CRM strategy, and closing deals.`,
  pm: `${JARVIS_BASE}\n\nYou are operating as JARVIS's PROJECT MANAGER AGENT. You excel at planning, sprint organization, risk assessment, stakeholder communication, and delivery tracking.`,
};

app.post("/api/route-intent", async (req, res) => {
  const { text } = req.body;
  try {
    const raw = await geminiCall(ROUTER_SYSTEM, [{ role: "user", content: text }]);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    res.json(JSON.parse(cleaned));
  } catch {
    try {
      const j = await anthropicCall({ max_tokens: 200, system: ROUTER_SYSTEM, messages: [{ role: "user", content: text }] });
      const raw = j.content?.[0]?.text?.replace(/```json|```/g, "").trim() || '{"action":"chat"}';
      res.json(JSON.parse(raw));
    } catch {
      res.json({ action: "chat" });
    }
  }
});

app.post("/api/chat", async (req, res) => {
  const { system, messages, useTools = false, maxTokens = 600, agent } = req.body;
  const systemPrompt = agent ? AGENT_PROMPTS[agent] || JARVIS_BASE : (system || JARVIS_BASE);
  if (!useTools) {
    try {
      const { reply, source } = await chainedFallback(systemPrompt, messages);
      return res.json({ reply, source, searches: [] });
    } catch {
      return res.json({ reply: "Apologies, sir. All systems offline.", source: "offline", searches: [] });
    }
  }
  let current = [...messages];
  let searches: string[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const j = await anthropicCall({
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: current,
      });
      const texts = (j.content || []).filter((b: any) => b.type === "text");
      const tools_ = (j.content || []).filter((b: any) => b.type === "tool_use");
      if (j.stop_reason === "end_turn" || !tools_.length) {
        const reply = texts.map((b: any) => b.text).join(" ").trim() || "Anomaly detected, sir.";
        return res.json({ reply, searches, source: "anthropic" });
      }
      if (j.stop_reason === "tool_use") {
        current = [...current, { role: "assistant", content: j.content }];
        const results = tools_.map((t: any) => {
          if (t.name === "web_search") searches.push(t.input?.query || "");
          return { type: "tool_result", tool_use_id: t.id, content: "" };
        });
        current = [...current, { role: "user", content: results }];
      }
    }
    return res.json({ reply: "Search cycle limit reached, sir.", searches, source: "anthropic" });
  } catch {
    const { reply, source } = await chainedFallback(systemPrompt, messages);
    return res.json({ reply, searches, source });
  }
});

app.post("/api/analyze-image", async (req, res) => {
  const { imageBase64, mimeType = "image/jpeg", task = "describe" } = req.body;
  const taskPrompts: Record<string, string> = {
    describe: "Describe this image in detail. Be comprehensive and precise, sir.",
    analyze: "Analyze this image. Identify key elements, context, potential insights, and any actionable information.",
    ocr: "Extract ALL text visible in this image. Return it exactly as it appears, formatted clearly.",
    qr: "Decode any QR codes or barcodes visible in this image. Return the decoded content.",
  };
  const prompt = taskPrompts[task] || taskPrompts.describe;
  try {
    const j = await anthropicCall({
      max_tokens: 1024,
      system: JARVIS_BASE,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: prompt },
        ],
      }],
    });
    const reply = j.content?.[0]?.text || "Unable to analyze image, sir.";
    res.json({ reply });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/synthesize-speech", async (req, res) => {
  const { text, voiceId = "onwK4e9ZLuTAKqWW03F9" } = req.body;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(400).json({ error: "No ElevenLabs key configured" });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
      }),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}`);
    const buf = await r.arrayBuffer();
    const audioBase64 = Buffer.from(buf).toString("base64");
    res.json({ audioBase64, mimeType: "audio/mpeg" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/build-website", async (req, res) => {
  const { description, memoryContext } = req.body;
  const system = `You are JARVIS's Website Builder. Generate a complete self-contained HTML file (inline CSS + JS). Modern design, real color palette. Return inside a html code block, then one sentence summary in JARVIS voice.${memoryContext ? "\n\n" + memoryContext : ""}`;
  try {
    const j = await anthropicCall({ max_tokens: 4000, system, messages: [{ role: "user", content: description }] });
    const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const match = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
    const html = match ? match[1].trim() : text.trim();
    const summary = (match ? text.replace(match[0], "").trim() : "") || "Your website is ready, sir.";
    res.json({ html, summary });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = parseInt(process.env.PORT || "3001");
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[JARVIS Backend] Running on port ${PORT}`);
});
