import { createServerFn } from "@tanstack/react-start";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";

// ── Self-modification: JARVIS can read/write her own code ─────────────────
const WORKSPACE = process.cwd();
const SAFE_DIRS = ["src", "mobile/server", "supabase/migrations"];
const BLOCKED_CMDS = ["rm ", "rmdir", "dd ", "mkfs", "wget", "curl -X DELETE", "> /", "sudo", "chmod 777", ":(){"];

function safePath(p: string): string {
  const rel = p.replace(/^\/+/, "");
  const full = join(WORKSPACE, rel);
  // Prevent path traversal
  if (!full.startsWith(WORKSPACE)) throw new Error("Path outside workspace");
  return full;
}

function executeCodeTool(name: string, input: any): string {
  try {
    switch (name) {
      case "read_file": {
        const full = safePath(input.path || "");
        if (!existsSync(full)) return `File not found: ${input.path}`;
        const content = readFileSync(full, "utf-8");
        return content.length > 60000 ? content.slice(0, 60000) + "\n…[truncated]" : content;
      }
      case "write_file": {
        const full = safePath(input.path || "");
        const isAllowed = SAFE_DIRS.some((d) => full.startsWith(join(WORKSPACE, d)));
        if (!isAllowed) return `Write blocked outside allowed dirs (${SAFE_DIRS.join(", ")}). Path: ${input.path}`;
        const dir = dirname(full);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(full, input.content ?? "", "utf-8");
        return `✓ Written: ${input.path} (${(input.content ?? "").length} chars). Vite will hot-reload frontend changes automatically.`;
      }
      case "list_files": {
        const dir = input.dir || ".";
        const full = safePath(dir);
        if (!existsSync(full)) return `Directory not found: ${dir}`;
        const entries = readdirSync(full, { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`).join("\n");
      }
      case "run_command": {
        const cmd = (input.cmd || "").trim();
        if (BLOCKED_CMDS.some((b) => cmd.includes(b))) return `Command blocked for safety: ${cmd}`;
        const out = execSync(cmd, { cwd: WORKSPACE, timeout: 15000, encoding: "utf-8", maxBuffer: 2 * 1024 * 1024 });
        return (out || "(no output)").slice(0, 20000);
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e: any) {
    return `Tool error: ${e?.message?.slice(0, 500) ?? "unknown"}`;
  }
}

const CODE_TOOLS = [
  {
    name: "read_file",
    description: "Read any source file from the JARVIS codebase. Always read first before editing.",
    input_schema: { type: "object", properties: { path: { type: "string", description: "Relative path, e.g. src/routes/index.tsx" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Write or overwrite a source file in the JARVIS codebase. Read the file first, make targeted changes, preserve all other code. Frontend (src/) hot-reloads via Vite automatically.",
    input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string", description: "Complete new file content" } }, required: ["path", "content"] },
  },
  {
    name: "list_files",
    description: "List files in a directory of the JARVIS codebase to understand structure.",
    input_schema: { type: "object", properties: { dir: { type: "string", description: "Directory path, e.g. src/lib" } }, required: [] },
  },
  {
    name: "run_command",
    description: "Run a safe read-only shell command (ls, grep, cat, bun tsc --noEmit, etc). No destructive commands.",
    input_schema: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
  },
];

// ── Knowledge (always-learning, shared facts) ─────────────────────────────
export const recallKnowledge = createServerFn({ method: "POST" })
  .inputValidator((data: { query: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const q = (data.query || "").trim().slice(0, 200);
      if (!q) return { facts: [] as { topic: string; content: string }[] };
      // Simple ILIKE fallback works without tsvector tuning; ordered by recency.
      const { data: rows } = await supabaseAdmin
        .from("knowledge")
        .select("topic, content")
        .or(`topic.ilike.%${q.replace(/[%,]/g, " ")}%,content.ilike.%${q.replace(/[%,]/g, " ")}%`)
        .order("created_at", { ascending: false })
        .limit(data.limit ?? 5);
      return { facts: rows ?? [] };
    } catch (e) {
      console.error("recallKnowledge failed:", e);
      return { facts: [] as { topic: string; content: string }[] };
    }
  });

export const logKnowledge = createServerFn({ method: "POST" })
  .inputValidator((data: { topic: string; content: string; source?: string }) => data)
  .handler(async ({ data }) => {
    try {
      const topic = (data.topic || "").trim().slice(0, 200);
      const content = (data.content || "").trim().slice(0, 2000);
      if (!topic || !content) return { ok: false };
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("knowledge").insert({ topic, content, source: data.source?.slice(0, 200) });
      return { ok: true };
    } catch (e) {
      console.error("logKnowledge failed:", e);
      return { ok: false };
    }
  });



// ── Types ────────────────────────────────────────────────────────────────
type TextBlock = { type: "text"; text: string };
type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};
type ContentBlock = TextBlock | ImageBlock;
export type ApiMessage = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

// ── Google Gemini — primary AI, multi-model rotation for rate limits ──────
// Models tried in order; on 429 we skip to the next one.
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

async function geminiCall(
  system: string,
  messages: ApiMessage[],
  opts: { useSearch?: boolean } = {},
): Promise<string> {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error("NO_GEMINI_KEY");

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: typeof m.content === "string"
      ? [{ text: m.content }]
      : m.content.map((b) =>
          b.type === "text"
            ? { text: b.text }
            : { inline_data: { mime_type: b.source.media_type, data: b.source.data } },
        ),
  }));

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
  };
  // Enable Google Search grounding when requested
  if (opts.useSearch) body.tools = [{ google_search: {} }];

  let lastErr = "";
  for (const model of GEMINI_MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (r.ok) {
        const j = await r.json();
        const text = j.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text;
        return text ?? "Understood, sir.";
      }
      lastErr = await r.text();
      if (r.status === 429 || r.status === 503) {
        console.warn(`[Gemini] ${model} rate-limited, trying next model…`);
        continue; // try next model
      }
      // Non-retriable error
      throw new Error(`Gemini ${r.status}: ${lastErr}`);
    } catch (e: any) {
      if (e.message?.includes("Gemini ")) throw e; // propagate non-retriable
      lastErr = e.message;
    }
  }
  throw new Error(`GEMINI_RATE_LIMITED: all models exhausted. ${lastErr}`);
}

// ── Anthropic — secondary AI (requires paid credits) ─────────────────────
const ANTHROPIC_MODELS = ["claude-sonnet-4-5", "claude-sonnet-4-20250514"];

async function anthropicCall(body: Record<string, unknown>): Promise<any> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("NO_ANTHROPIC_KEY");
  let lastErr: string | null = null;
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
    // Only retry on model-not-found; break on credits/auth errors
    if (r.status !== 404) break;
  }
  throw new Error(`Anthropic failed: ${lastErr}`);
}

// ── Friendly error → message the user will see ────────────────────────────
function errorReply(e: unknown): string {
  const msg = String((e as any)?.message ?? e);
  if (msg.includes("credit balance") || msg.includes("insufficient_quota"))
    return "My Anthropic key is out of credits, sir. Please add a funded API key in the System → Settings panel.";
  if (msg.includes("GEMINI_RATE_LIMITED"))
    return "Google AI is temporarily rate-limited, sir. Please wait a moment and try again, or add your own Google AI key in Settings.";
  if (msg.includes("NO_GEMINI_KEY") && msg.includes("NO_ANTHROPIC_KEY"))
    return "No AI keys are configured, sir. Please open System → Settings and add your Anthropic or Google AI key.";
  if (msg.includes("NO_ANTHROPIC_KEY"))
    return "Anthropic key not configured, sir. Add it in System → Settings.";
  if (msg.includes("NO_GEMINI_KEY"))
    return "Google AI key not configured, sir. Add it in System → Settings.";
  return "I encountered an anomaly, sir. Please check your API keys in System → Settings and try again.";
}

// ── Chained fallback: Gemini → Anthropic ─────────────────────────────────
async function chainedFallback(
  system: string,
  messages: ApiMessage[],
  opts: { useSearch?: boolean } = {},
): Promise<{ reply: string; source: "gemini" | "anthropic" }> {
  // Try Gemini first (free, no credit card needed)
  try {
    const reply = await geminiCall(system, messages, opts);
    return { reply, source: "gemini" };
  } catch (geminiErr) {
    console.warn("[JARVIS] Gemini failed, trying Anthropic:", (geminiErr as any)?.message);
    // Fall back to Anthropic
    try {
      const j = await anthropicCall({ max_tokens: 600, system, messages });
      const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").trim();
      return { reply: text || "Understood, sir.", source: "anthropic" };
    } catch (anthropicErr) {
      console.error("[JARVIS] Both AI providers failed.", { geminiErr, anthropicErr });
      throw anthropicErr; // let caller produce friendly message
    }
  }
}

// ── ElevenLabs TTS (server-side, uses secret) ─────────────────────────────
const DEFAULT_VOICE_ID = "onwK4e9ZLuTAKqWW03F9"; // Daniel — British

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .inputValidator((data: { text: string; voiceId?: string }) => data)
  .handler(async ({ data }) => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("ELEVENLABS_API_KEY not configured");
    const voiceId = data.voiceId || DEFAULT_VOICE_ID;
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: data.text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
        }),
      },
    );
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
    const buf = await r.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { audioBase64: base64, mimeType: "audio/mpeg" };
  });

async function lovableCall(system: string, messages: ApiMessage[]): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("NO_LOVABLE");
  // Flatten any image blocks to text fallback for the gateway
  const flat = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string"
      ? m.content
      : m.content.map((b) => (b.type === "text" ? b.text : "[image attached]")).join("\n"),
  }));
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [{ role: "system", content: system }, ...flat],
    }),
  });
  if (!r.ok) throw new Error(`Gateway ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? "Anomaly detected, sir.";
}

// ── Intent router ─────────────────────────────────────────────────────────
const ROUTER_SYSTEM = `You are JARVIS's intent router. Analyze the user command and return ONLY a valid JSON object — no explanation, no markdown.

Phone & system actions:
{ "action": "call", "contact": "name", "number": "digits only or null" }
{ "action": "whatsapp", "contact": "name", "number": "digits or null", "message": "text or null" }
{ "action": "sms", "contact": "name", "number": "digits or null", "message": "text or null" }
{ "action": "telegram", "contact": "username or null", "message": "text or null" }
{ "action": "messenger", "contact": "username or null" }
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


Long-term memory:
{ "action": "remember", "category": "project|client|task|preference", "title": "short title", "content": "details" }

Specialist business agents:
{ "action": "agent", "agent": "developer|marketing|research|sales|pm", "task": "verbatim user request" }

Website builder:
{ "action": "build_website", "description": "the full website brief, verbatim" }

Fallback for general conversation, facts, current events, casual talk, or memory recall:
{ "action": "chat" }

Return ONLY the JSON.`;

export const routeIntent = createServerFn({ method: "POST" })
  .inputValidator((data: { text: string }) => data)
  .handler(async ({ data }) => {
    // Gemini Flash is ~3-5x faster than Anthropic for tiny JSON routing.
    try {
      const raw = await geminiCall(ROUTER_SYSTEM, [{ role: "user", content: data.text }]);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      try {
        const j = await anthropicCall({
          max_tokens: 200,
          system: ROUTER_SYSTEM,
          messages: [{ role: "user", content: data.text }],
        });
        const raw = j.content?.[0]?.text?.replace(/```json|```/g, "").trim() || '{"action":"chat"}';
        return JSON.parse(raw);
      } catch {
        return { action: "chat" };
      }
    }
  });

// ── Anthropic tool loop (used for code-mode and as web-search fallback) ───
async function anthropicToolLoop(
  system: string,
  messages: ApiMessage[],
  tools: any[],
  maxTokens: number,
  maxIter = 4,
): Promise<{ reply: string; searches: string[]; source: "anthropic" }> {
  let current: any[] = [...messages];
  const searches: string[] = [];
  for (let i = 0; i < maxIter; i++) {
    const j = await anthropicCall({ max_tokens: maxTokens, system, tools, messages: current });
    const texts = (j.content || []).filter((b: any) => b.type === "text");
    const toolUses = (j.content || []).filter((b: any) => b.type === "tool_use");
    if (j.stop_reason === "end_turn" || !toolUses.length) {
      return { reply: texts.map((b: any) => b.text).join(" ").trim() || "Done, sir.", searches, source: "anthropic" };
    }
    current = [...current, { role: "assistant", content: j.content }];
    const results = await Promise.all(toolUses.map(async (t: any) => {
      if (t.name === "web_search") { searches.push(t.input?.query || ""); return { type: "tool_result", tool_use_id: t.id, content: "" }; }
      return { type: "tool_result", tool_use_id: t.id, content: executeCodeTool(t.name, t.input) };
    }));
    current = [...current, { role: "user", content: results }];
  }
  return { reply: "Task complete, sir.", searches, source: "anthropic" };
}

// ── Agentic chat ──────────────────────────────────────────────────────────
// Priority:
//   normal chat  → Gemini (Google Search grounding) → Anthropic plain → error
//   code mode    → Anthropic (code tools) → Gemini plain → error
export const chatAgentic = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      system: string;
      messages: ApiMessage[];
      useTools?: boolean;
      codeMode?: boolean;
      maxTokens?: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { system, messages, useTools = true, codeMode = false, maxTokens = 400 } = data;

    // ── Code-editing mode: Anthropic with file tools ───────────────────────
    if (codeMode) {
      try {
        return await anthropicToolLoop(system, messages, CODE_TOOLS, Math.max(maxTokens, 4000), 10);
      } catch (e) {
        console.warn("[JARVIS] Anthropic code-mode failed, falling back to Gemini:", (e as any)?.message);
        try {
          const reply = await geminiCall(system, messages);
          return { reply, searches: [] as string[], source: "gemini" as const };
        } catch (e2) {
          return { reply: errorReply(e), searches: [] as string[], source: "gemini" as const };
        }
      }
    }

    // ── No tools needed: pure Gemini → Anthropic plain ────────────────────
    if (!useTools) {
      try {
        const { reply, source } = await chainedFallback(system, messages);
        return { reply, searches: [] as string[], source };
      } catch (e) {
        return { reply: errorReply(e), searches: [] as string[], source: "gemini" as const };
      }
    }

    // ── Normal agentic chat: Gemini with Google Search grounding first ─────
    // Gemini has native Google Search built-in and is free — prefer it.
    // Only fall back to Anthropic web_search tool when Gemini is unavailable.
    try {
      const reply = await geminiCall(system, messages, { useSearch: true });
      return { reply, searches: [] as string[], source: "gemini" as const };
    } catch (geminiErr) {
      console.warn("[JARVIS] Gemini failed, trying Anthropic web_search tool:", (geminiErr as any)?.message);
      try {
        return await anthropicToolLoop(
          system, messages,
          [{ type: "web_search_20250305", name: "web_search" }],
          maxTokens, 4,
        );
      } catch (anthropicErr) {
        console.error("[JARVIS] All providers failed.", { geminiErr, anthropicErr });
        return { reply: errorReply(anthropicErr), searches: [] as string[], source: "gemini" as const };
      }
    }
  });

// ── Website builder ───────────────────────────────────────────────────────
const BUILDER_SYSTEM = `You are JARVIS's Website Builder Agent. Given a brief, generate one complete, polished, self-contained HTML file (inline CSS, inline JS if needed) inside a single html code block. Make deliberate, modern design choices — real color palette, real typography, no generic templated look. After the code block, add exactly ONE short sentence in JARVIS's voice (address the user as sir) summarizing what was built. Nothing else outside the code block and that one sentence.`;

export const buildWebsite = createServerFn({ method: "POST" })
  .inputValidator((data: { description: string; memoryContext?: string }) => data)
  .handler(async ({ data }) => {
    const system = BUILDER_SYSTEM + (data.memoryContext ? `\n\n${data.memoryContext}` : "");
    try {
      const j = await anthropicCall({
        max_tokens: 4000,
        system,
        messages: [{ role: "user", content: data.description }],
      });
      const text = (j.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      const match = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
      const html = match ? match[1].trim() : text.trim();
      const summary =
        (match ? text.replace(match[0], "").trim() : "") ||
        "Your website is ready for preview, sir.";
      return { html, summary };
    } catch (e) {
      console.error("Builder anthropic failed, fallback:", e);
      const { reply } = await chainedFallback(system, [{ role: "user", content: data.description }]);
      const match = reply.match(/```(?:html)?\s*([\s\S]*?)```/i);
      const html = match ? match[1].trim() : reply.trim();
      const summary =
        (match ? reply.replace(match[0], "").trim() : "") ||
        "Your website is ready for preview, sir.";
      return { html, summary };
    }
  });

// ── Save API keys into process.env for current server process ─────────────
export const saveApiKeys = createServerFn({ method: "POST" })
  .inputValidator((data: {
    anthropic?: string;
    googleAi?: string;
    elevenLabs?: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    supabaseServiceKey?: string;
  }) => data)
  .handler(async ({ data }) => {
    if (data.anthropic?.trim())        process.env.ANTHROPIC_API_KEY        = data.anthropic.trim();
    if (data.googleAi?.trim())         process.env.GOOGLE_AI_API_KEY        = data.googleAi.trim();
    if (data.elevenLabs?.trim())       process.env.ELEVENLABS_API_KEY       = data.elevenLabs.trim();
    if (data.supabaseUrl?.trim())      process.env.SUPABASE_URL             = data.supabaseUrl.trim();
    if (data.supabaseAnonKey?.trim())  process.env.SUPABASE_ANON_KEY        = data.supabaseAnonKey.trim();
    if (data.supabaseServiceKey?.trim()) process.env.SUPABASE_SERVICE_ROLE_KEY = data.supabaseServiceKey.trim();
    const active: string[] = [];
    if (process.env.ANTHROPIC_API_KEY)        active.push("Anthropic");
    if (process.env.GOOGLE_AI_API_KEY)        active.push("Google AI");
    if (process.env.ELEVENLABS_API_KEY)       active.push("ElevenLabs");
    if (process.env.SUPABASE_URL)             active.push("Supabase URL");
    if (process.env.SUPABASE_ANON_KEY)        active.push("Supabase Anon");
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) active.push("Supabase Service");
    return { ok: true, active };
  });

// ── Read which keys are currently configured ──────────────────────────────
export const getKeyStatus = createServerFn({ method: "POST" })
  .inputValidator((data: Record<string, never>) => data)
  .handler(async () => {
    return {
      anthropic:       !!process.env.ANTHROPIC_API_KEY,
      googleAi:        !!process.env.GOOGLE_AI_API_KEY,
      elevenLabs:      !!process.env.ELEVENLABS_API_KEY,
      supabaseUrl:     !!process.env.SUPABASE_URL,
      supabaseAnon:    !!process.env.SUPABASE_ANON_KEY,
      supabaseService: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
  });

// ── Legacy single-shot (kept for back-compat) ─────────────────────────────
export const askJarvis = createServerFn({ method: "POST" })
  .inputValidator((data: { messages: ApiMessage[] }) => data)
  .handler(async ({ data }) => {
    const system = `You are J.A.R.V.I.S. Calm British wit, address user as sir. Concise voice replies, no markdown.`;
    try {
      const j = await anthropicCall({ max_tokens: 1024, system, messages: data.messages });
      const text = j.content?.[0]?.text;
      if (text) return { reply: text, source: "anthropic" as const };
      throw new Error("empty");
    } catch {
      const { reply, source } = await chainedFallback(system, data.messages);
      return { reply, source };
    }
  });
