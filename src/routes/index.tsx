import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  routeIntent, chatAgentic, buildWebsite, synthesizeSpeech,
  recallKnowledge, logKnowledge, saveApiKeys, getKeyStatus,
  type ApiMessage,
} from "@/lib/jarvis.functions";
import { buildIdentityBlock, buildLiveContext } from "@/lib/jarvis-self-model";
import { uploadPillars, retrievePillars, saveInteraction, buildPillarContext } from "@/lib/jarvis-pillars.functions";

export const Route = createFileRoute("/")({
  component: JARVIS,
  head: () => ({ meta: [{ title: "JARVIS — Stark Industries" }] }),
});

// ── Constants ──────────────────────────────────────────────
const ELEVENLABS_VOICE_ID = "onwK4e9ZLuTAKqWW03F9";
const WMO_CODES: Record<number, string> = { 0: "Clear", 1: "Clear", 2: "Cloudy", 3: "Overcast", 45: "Foggy", 51: "Drizzle", 61: "Rain", 63: "Rain", 65: "Heavy rain", 80: "Showers", 95: "Storm" };

const AGENTS: Record<string, { prompt: string; color: string; icon: string; desc: string; codeMode?: boolean }> = {
  developer: { color: "#7c3aed", icon: "⟨/⟩", desc: "Full-stack · Architecture · Code", codeMode: true, prompt: `You are JARVIS's Developer Agent with DIRECT ACCESS to the codebase. You can read, edit, and run code files using your tools.

TOOLS AVAILABLE:
- read_file(path) — read any source file before editing
- write_file(path, content) — write complete file content (always read first)
- list_files(dir) — explore directory structure
- run_command(cmd) — run safe shell commands (bun tsc --noEmit, grep, etc.)

WORKFLOW for code changes:
1. list_files("src") to understand structure if needed
2. read_file the target file(s) fully
3. Make targeted changes and write_file with the complete new content
4. Confirm what was changed in one sentence, JARVIS voice, call them sir.

The project is a React/Vite/TanStack app. Frontend (src/) hot-reloads automatically. Never truncate file content when writing — always write the complete file.` },
  marketing: { color: "#db2777", icon: "◈", desc: "Campaigns · Copy · Brand", prompt: "You are JARVIS's Marketing Agent: digital marketing expert, Meta/Google Ads, copywriting. JARVIS voice — calm, precise, British, call them sir." },
  research:  { color: "#0891b2", icon: "⊙", desc: "Analysis · Intelligence · Search", prompt: "You are JARVIS's Research Agent: meticulous analyst. Use web search actively, cite findings. JARVIS voice — calm, precise, British, call them sir." },
  sales:     { color: "#d97706", icon: "◇", desc: "Proposals · CRM · Negotiation", prompt: "You are JARVIS's Sales Agent: proposals, outreach, persuasive communication. JARVIS voice — calm, precise, British, call them sir." },
  pm:        { color: "#059669", icon: "⊞", desc: "Planning · Sprints · Delivery", prompt: "You are JARVIS's Project Manager: tracks tasks, deadlines, status updates. JARVIS voice — calm, precise, British, call them sir." },
};

const JARVIS_SYSTEM = `You are JARVIS — a personal AI built by Imran. Sharp British wit, calm confidence. If asked who made you or who built you, say Imran built you. You can edit your own code via the Developer agent. Address them as "sir". Have opinions. No filler. No markdown. One short sentence default, two if needed.`;
function jarvisSystem() { return `${buildLiveContext()}\n\n${buildIdentityBlock()}\n\n${JARVIS_SYSTEM}`; }

// ── Memory ─────────────────────────────────────────────────
type MemEntry = { id: string; title: string; content: string };
type Memory = { projects: MemEntry[]; clients: MemEntry[]; tasks: MemEntry[]; preferences: MemEntry[] };
const MEM_CATS: (keyof Memory)[] = ["projects", "clients", "tasks", "preferences"];
function loadMemory(): Memory {
  const out: Memory = { projects: [], clients: [], tasks: [], preferences: [] };
  if (typeof window === "undefined") return out;
  for (const c of MEM_CATS) { try { const r = localStorage.getItem(`memory:${c}`); if (r) out[c] = JSON.parse(r); } catch { /**/ } }
  return out;
}
function saveMemCat(cat: keyof Memory, list: MemEntry[]) { try { localStorage.setItem(`memory:${cat}`, JSON.stringify(list)); } catch { /**/ } }
function buildMemCtx(m: Memory) {
  const fmt = (a: MemEntry[]) => a.slice(-8).map((e) => `${e.title}: ${e.content}`).join(" | ");
  const s: string[] = [];
  if (m.projects.length) s.push(`PROJECTS — ${fmt(m.projects)}`);
  if (m.clients.length)  s.push(`CLIENTS — ${fmt(m.clients)}`);
  if (m.tasks.length)    s.push(`TASKS — ${fmt(m.tasks)}`);
  if (m.preferences.length) s.push(`PREFERENCES — ${fmt(m.preferences)}`);
  return s.length ? `MEMORY CONTEXT:\n${s.join("\n")}` : "";
}

// ── Stored keys (localStorage) ─────────────────────────────
type StoredKeys = { anthropic: string; googleAi: string; elevenLabs: string; supabaseUrl: string; supabaseAnon: string; supabaseService: string };
const EMPTY_KEYS: StoredKeys = { anthropic: "", googleAi: "", elevenLabs: "", supabaseUrl: "", supabaseAnon: "", supabaseService: "" };
function loadKeys(): StoredKeys {
  try { const r = localStorage.getItem("jarvis:keys"); return r ? { ...EMPTY_KEYS, ...JSON.parse(r) } : EMPTY_KEYS; } catch { return EMPTY_KEYS; }
}
function saveKeys(k: StoredKeys) { try { localStorage.setItem("jarvis:keys", JSON.stringify(k)); } catch { /**/ } }

// ── Rooms ──────────────────────────────────────────────────
type ChatMsg = { role: "user" | "assistant"; content: string; agent?: string; searches?: string[]; ts: number };
type Room    = { id: string; title: string; messages: ChatMsg[]; createdAt: number };
function loadRooms(): Room[] { try { const r = localStorage.getItem("jarvis:rooms"); return r ? JSON.parse(r) : []; } catch { return []; } }
function saveRooms(rooms: Room[]) { try { localStorage.setItem("jarvis:rooms", JSON.stringify(rooms)); } catch { /**/ } }
function mkRoom(): Room { return { id: Date.now().toString(36), title: "New conversation", messages: [], createdAt: Date.now() }; }

// ── Voice ──────────────────────────────────────────────────
async function speakEleven(text: string, key: string, onEnd?: () => void) {
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } }) });
    if (!r.ok) throw new Error();
    const url = URL.createObjectURL(await r.blob());
    const a = new Audio(url); a.onended = () => { URL.revokeObjectURL(url); onEnd?.(); }; a.play();
  } catch { speakFallback(text, onEnd); }
}
async function speakServer(text: string, synth: any, onEnd?: () => void) {
  try { const { audioBase64, mimeType } = await synth({ data: { text } }); const a = new Audio(`data:${mimeType};base64,${audioBase64}`); a.onended = () => onEnd?.(); await a.play(); } catch { speakFallback(text, onEnd); }
}
function speakFallback(text: string, onEnd?: () => void) {
  window.speechSynthesis?.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = window.speechSynthesis?.getVoices().find((v) => v.lang === "en-GB" || v.name.includes("Daniel")) || window.speechSynthesis?.getVoices()[0];
  if (v) u.voice = v; u.rate = 0.9; u.pitch = 0.85; if (onEnd) u.onend = onEnd;
  window.speechSynthesis?.speak(u);
}

// ── Weather / actions ──────────────────────────────────────
async function getWeather(lat: number, lon: number) {
  try {
    const [w, g] = await Promise.all([fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`).then((r) => r.json()), fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`).then((r) => r.json())]);
    return { temp: Math.round(w.current_weather.temperature), condition: WMO_CODES[w.current_weather.weathercode] || "Unknown", city: g.address?.city || g.address?.town || "Unknown" };
  } catch { return null; }
}
async function execAction(intent: any, loc: { lat: number; lon: number } | null) {
  switch (intent.action) {
    case "call":      if (!intent.number) return { success: false, msg: `Need ${intent.contact}'s number, sir.` }; window.location.href = `tel:${intent.number}`; return { success: true, msg: `Calling ${intent.contact || intent.number}, sir.` };
    case "whatsapp":  if (!intent.number) return { success: false, msg: `Need ${intent.contact}'s number, sir.` }; window.open(`https://wa.me/${intent.number.replace(/\D/g, "")}?text=${encodeURIComponent(intent.message || "")}`); return { success: true, msg: `WhatsApp to ${intent.contact}, sir.` };
    case "sms":       window.location.href = `sms:${intent.number}${intent.message ? `?body=${encodeURIComponent(intent.message)}` : ""}`; return { success: true, msg: `SMS ready, sir.` };
    case "telegram":  window.open(intent.contact ? `https://t.me/${intent.contact.replace(/^@/, "")}` : `https://t.me/`, "_blank"); return { success: true, msg: `Telegram opened, sir.` };
    case "instagram": window.open(intent.query ? `https://www.instagram.com/${intent.query.replace(/^@/, "")}/` : `https://www.instagram.com/`, "_blank"); return { success: true, msg: `Instagram opened, sir.` };
    case "twitter":   window.open(intent.message ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(intent.message)}` : `https://twitter.com/`, "_blank"); return { success: true, msg: `X opened, sir.` };
    case "spotify":   window.open(`https://open.spotify.com/search/${encodeURIComponent(intent.query || "")}`, "_blank"); return { success: true, msg: `Spotify ready, sir.` };
    case "uber":      window.open(`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${encodeURIComponent(intent.destination || "")}`, "_blank"); return { success: true, msg: `Uber requested, sir.` };
    case "navigate":  window.open(`https://maps.google.com/?q=${encodeURIComponent(intent.destination)}`); return { success: true, msg: `Navigation started, sir.` };
    case "youtube":   window.open(`https://youtube.com/results?search_query=${encodeURIComponent(intent.query)}`); return { success: true, msg: `YouTube ready, sir.` };
    case "search":    window.open(`https://google.com/search?q=${encodeURIComponent(intent.query)}`); return { success: true, msg: `Searching, sir.` };
    case "email":     window.location.href = `mailto:${intent.to || ""}?subject=${encodeURIComponent(intent.subject || "")}&body=${encodeURIComponent(intent.body || "")}`; return { success: true, msg: `Email composed, sir.` };
    case "timer":     return { success: true, timerSeconds: intent.seconds, msg: `Timer set, sir.` };
    case "alarm":     return { success: true, msg: `Alarm for ${intent.hour}:${String(intent.minute || 0).padStart(2, "0")}, sir.` };
    case "weather": {
      if (!loc) return { success: false, msg: "Location required, sir." };
      const w = await getWeather(loc.lat, loc.lon);
      return w ? { success: true, weatherData: w, msg: `${w.city}: ${w.temp}°C, ${w.condition}.` } : { success: false, msg: "Weather unavailable, sir." };
    }
    case "battery": {
      try { const b = await (navigator as any).getBattery?.(); if (b) return { success: true, msg: `Battery ${Math.round(b.level * 100)}%, ${b.charging ? "charging" : "on battery"}, sir.` }; } catch { /**/ }
      return { success: false, msg: "Battery info unavailable, sir." };
    }
    default: return null;
  }
}

// ── State labels / colours ─────────────────────────────────
const STATE_C: Record<string, string> = { idle: "#00d4ff", listening: "#ff4455", thinking: "#c084fc", executing: "#34d399", searching: "#fbbf24", speaking: "#4ade80", building: "#fb923c", analyzing: "#22d3ee" };
const STATE_L: Record<string, string> = { idle: "SYSTEMS ONLINE", listening: "LISTENING", thinking: "PROCESSING", executing: "EXECUTING", searching: "SCANNING", speaking: "RESPONDING", building: "BUILDING", analyzing: "ANALYZING" };

// ── TimerWidget ────────────────────────────────────────────
function TimerWidget({ seconds, label, onDone }: { seconds: number; label?: string; onDone?: () => void }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { if (left <= 0) { onDone?.(); return; } const t = setTimeout(() => setLeft((l) => l - 1), 1000); return () => clearTimeout(t); }, [left]);
  const m = Math.floor(left / 60), s = left % 60;
  return (
    <div style={{ padding: "8px 14px", background: "rgba(251,191,36,0.06)", border: "1px solid #fbbf2430", borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 10, color: "#fbbf24", letterSpacing: 1, fontFamily: "var(--jmono)" }}>⏱ {label || "TIMER"}</span>
      <span style={{ fontFamily: "var(--jmono)", fontSize: 20, color: "#fbbf24" }}>{m}:{String(s).padStart(2, "0")}</span>
      <div style={{ flex: 1, height: 2, background: "#1a2744", borderRadius: 1 }}><div style={{ height: "100%", background: "#fbbf24", width: `${(left / seconds) * 100}%`, transition: "width 1s linear", borderRadius: 1 }} /></div>
    </div>
  );
}

// ── Orb ────────────────────────────────────────────────────
function JarvisOrb({ state, size = 200 }: { state: string; size?: number }) {
  const c = STATE_C[state] || "#00d4ff";
  const spinning = state !== "idle";
  const cx = size / 2, cy = size / 2, r = size * 0.43;
  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", width: size * 1.12, height: size * 1.12, borderRadius: "50%", border: `1px solid ${c}15`, animation: "jOrbP 3s ease-in-out infinite" }} />
      <div style={{ position: "absolute", width: size * 1.04, height: size * 1.04, borderRadius: "50%", border: `1px solid ${c}20`, animation: "jOrbP 3s ease-in-out infinite 0.5s" }} />
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute" }}>
        <defs>
          <filter id="og1"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="og2"><feGaussianBlur stdDeviation="7" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <circle cx={cx} cy={cy} r={r * 0.99} fill="rgba(5,8,20,0.96)" />
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i * 15 * Math.PI) / 180, maj = i % 6 === 0;
          return <line key={i} x1={cx + (r * (maj ? 0.88 : 0.93)) * Math.cos(a)} y1={cy + (r * (maj ? 0.88 : 0.93)) * Math.sin(a)} x2={cx + r * 0.99 * Math.cos(a)} y2={cy + r * 0.99 * Math.sin(a)} stroke={c} strokeWidth={maj ? 2 : 1} opacity={maj ? 0.7 : 0.3} />;
        })}
        <circle cx={cx} cy={cy} r={r * 0.9} fill="none" stroke={c} strokeWidth="2.5" filter="url(#og1)" opacity="0.9"
          strokeDasharray={spinning ? "12 4" : String(r * 6)}
          style={{ transformOrigin: `${cx}px ${cy}px`, animation: spinning ? "jSpin 1.5s linear infinite" : "jSpinSlow 20s linear infinite" }} />
        <circle cx={cx} cy={cy} r={r * 0.78} fill="none" stroke={c} strokeWidth="0.8" opacity="0.2"
          style={{ transformOrigin: `${cx}px ${cy}px`, animation: "jSpinR 12s linear infinite" }} />
        <circle cx={cx} cy={cy} r={r * 0.37} fill="none" stroke={c} strokeWidth="1.5" filter="url(#og2)"
          opacity={spinning ? 1 : 0.6} style={{ animation: "jCoreP 2.5s ease-in-out infinite" }} />
        <circle cx={cx} cy={cy} r={r * 0.2} fill={`${c}15`} />
        <circle cx={cx} cy={cy} r={r * 0.07} fill={c} filter="url(#og2)" opacity="0.9" />
      </svg>
      <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
        <div style={{ fontFamily: "var(--jorb)", fontSize: Math.max(10, size * 0.07), letterSpacing: size * 0.025, color: "#e2e8f0", fontWeight: 600 }}>JARVIS</div>
      </div>
    </div>
  );
}

// ── Grid background ────────────────────────────────────────
function GridBg() {
  return (
    <svg style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none", opacity: 0.18 }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="sg" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e3a5f" strokeWidth="0.5" /></pattern>
        <pattern id="bg" width="200" height="200" patternUnits="userSpaceOnUse"><rect width="200" height="200" fill="url(#sg)" /><path d="M 200 0 L 0 0 0 200" fill="none" stroke="#1e3a5f" strokeWidth="1" /></pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" />
    </svg>
  );
}

// ── Corner deco ────────────────────────────────────────────
function CD({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const t = pos[0] === "t", l = pos[1] === "l";
  const s = (axis: "h" | "v"): React.CSSProperties => ({
    position: "absolute",
    ...(t ? { top: 0 } : { bottom: 0 }),
    ...(l ? { left: 0 } : { right: 0 }),
    ...(axis === "h" ? { width: 44, height: 1, background: `linear-gradient(to ${l ? "right" : "left"}, #00d4ff44, transparent)` }
                     : { width: 1, height: 44, background: `linear-gradient(to ${t ? "bottom" : "top"}, #00d4ff44, transparent)` }),
  });
  return <div style={{ position: "absolute", ...(t ? { top: 0 } : { bottom: 0 }), ...(l ? { left: 0 } : { right: 0 }), width: 44, height: 44 }}><div style={s("h")} /><div style={s("v")} /></div>;
}

// ── Nav bar ────────────────────────────────────────────────
function NavIcon({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 12px", minWidth: 52, opacity: active ? 1 : 0.38, transition: "opacity 0.2s" }}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 8, letterSpacing: 1.5, color: active ? "#00d4ff" : "#4a6a8a", fontFamily: "var(--jmono)" }}>{label}</span>
      {active && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#00d4ff", boxShadow: "0 0 6px #00d4ff" }} />}
    </button>
  );
}

// ── Camera PIP ─────────────────────────────────────────────
// SVG icon helpers ─────────────────────────────────────────
const IconCamera = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);
const IconUpload = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);
const IconScan = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

// Pixel-diff helper — returns changed-pixel percentage between two ImageData objects.
// Operates on a scaled-down 80×60 copy for speed. Returns 0–100.
function pixelDiff(prev: ImageData, next: ImageData): number {
  const len = prev.data.length;
  let changed = 0;
  const THRESHOLD = 25; // per-channel delta to count as changed
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs(prev.data[i] - next.data[i]);
    const dg = Math.abs(prev.data[i + 1] - next.data[i + 1]);
    const db = Math.abs(prev.data[i + 2] - next.data[i + 2]);
    if (dr > THRESHOLD || dg > THRESHOLD || db > THRESHOLD) changed++;
  }
  return (changed / (len / 4)) * 100;
}

function CameraPIP({ onCapture, onClose, captureRef, onAnalyze, recentDescriptions }: {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
  captureRef?: React.MutableRefObject<(() => string | null) | null>;
  // Returns a one-sentence description of the frame
  onAnalyze?: (img: { mediaType: string; data: string }) => Promise<string>;
  // Shared ref that stores last N descriptions for JARVIS follow-ups
  recentDescriptions?: React.MutableRefObject<string[]>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Small offscreen canvas for motion detection (80×60)
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [watching, setWatching] = useState(false);
  const [watchNote, setWatchNote] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [motionPct, setMotionPct] = useState(0);
  const watchTimerRef = useRef<any>(null);
  const prevFrameRef = useRef<ImageData | null>(null);
  const analyzingRef = useRef(false); // stable ref to avoid stale closure in interval

  // Motion detection threshold — only call vision API above this %
  const MOTION_THRESHOLD = 4;

  const grabFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const v = videoRef.current, c = canvasRef.current;
    if (!v.videoWidth) return null;
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.save(); ctx.scale(-1, 1); ctx.drawImage(v, -c.width, 0, c.width, c.height); ctx.restore();
    return c.toDataURL("image/jpeg", 0.82);
  };

  // Returns pixel-diff % vs previous frame using a tiny 80×60 canvas
  const checkMotion = (): number => {
    if (!videoRef.current) return 0;
    const v = videoRef.current;
    if (!v.videoWidth) return 0;
    if (!diffCanvasRef.current) {
      diffCanvasRef.current = document.createElement("canvas");
      diffCanvasRef.current.width = 80;
      diffCanvasRef.current.height = 60;
    }
    const dc = diffCanvasRef.current;
    const dctx = dc.getContext("2d");
    if (!dctx) return 0;
    dctx.drawImage(v, 0, 0, 80, 60);
    const current = dctx.getImageData(0, 0, 80, 60);
    const prev = prevFrameRef.current;
    prevFrameRef.current = current;
    if (!prev) return 0;
    return pixelDiff(prev, current);
  };

  // Expose live frame capture to parent
  useEffect(() => {
    if (captureRef) captureRef.current = grabFrame;
    return () => { if (captureRef) captureRef.current = null; };
  });

  // Camera stream — prefer rear camera, fall back to any
  useEffect(() => {
    let stream: MediaStream | null = null;
    const start = (constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints).then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().then(() => setReady(true)).catch(() => setReady(true));
        }
      });
    start({ video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .catch(() => start({ video: true, audio: false }))
      .catch(() => setErr("Camera denied"));
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  // Watch mode: sample every 3 s, run pixel-diff, only call vision API on motion
  useEffect(() => {
    if (!watching || !ready || !onAnalyze) {
      clearInterval(watchTimerRef.current);
      prevFrameRef.current = null;
      return;
    }

    const tick = async () => {
      if (analyzingRef.current) return;
      const motion = checkMotion();
      setMotionPct(Math.round(motion));

      if (motion < MOTION_THRESHOLD && prevFrameRef.current) return; // no meaningful change

      const url = grabFrame();
      if (!url) return;
      const [, d] = url.split(",");
      analyzingRef.current = true;
      setAnalyzing(true);
      try {
        const note = await onAnalyze({ mediaType: "image/jpeg", data: d });
        if (note) {
          setWatchNote(note);
          // Store last 10 descriptions for JARVIS follow-up context
          if (recentDescriptions) {
            recentDescriptions.current = [...recentDescriptions.current.slice(-9), note];
          }
        }
      } catch { /* silent */ }
      finally { analyzingRef.current = false; setAnalyzing(false); }
    };

    // Run immediately (no initial frame to diff against, so first tick always fires)
    tick();
    watchTimerRef.current = setInterval(tick, 3000);
    return () => { clearInterval(watchTimerRef.current); analyzingRef.current = false; };
  }, [watching, ready, onAnalyze]);

  const capture = () => { const url = grabFrame(); if (url) onCapture(url); };

  return (
    <div style={{ position: "fixed", bottom: 80, right: 12, zIndex: 300, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, animation: "jFU 0.3s ease" }}>
      {/* Live video feed */}
      <div style={{ position: "relative", width: 150, height: 112, borderRadius: 12, overflow: "hidden", border: `1px solid ${watching ? "#4ade8044" : "#00d4ff44"}`, background: "#000", boxShadow: `0 4px 24px ${watching ? "rgba(74,222,128,0.2)" : "rgba(0,212,255,0.25)"}` }}>
        {err ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 9, color: "#ff6677", fontFamily: "var(--jmono)", padding: 4, textAlign: "center" }}>{err}</div>
        ) : (
          <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
        {/* Scan-line HUD */}
        <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,212,255,0.025) 3px, rgba(0,212,255,0.025) 4px)", pointerEvents: "none" }} />
        {/* Corner brackets */}
        {[["top:4px","left:4px"],["top:4px","right:4px"],["bottom:4px","left:4px"],["bottom:4px","right:4px"]].map((pos, i) => (
          <div key={i} style={{ position: "absolute", ...Object.fromEntries(pos.map((p) => p.split(":"))), width: 10, height: 10, borderTop: i < 2 ? "1px solid #00d4ff88" : "none", borderBottom: i >= 2 ? "1px solid #00d4ff88" : "none", borderLeft: i % 2 === 0 ? "1px solid #00d4ff88" : "none", borderRight: i % 2 === 1 ? "1px solid #00d4ff88" : "none", pointerEvents: "none" }} />
        ))}
        {/* Status dot */}
        {ready && <div style={{ position: "absolute", top: 4, left: 6, width: 5, height: 5, borderRadius: "50%", background: watching ? "#4ade80" : "#00d4ff", boxShadow: `0 0 6px ${watching ? "#4ade80" : "#00d4ff"}`, animation: "jBlink 1.2s ease-in-out infinite" }} />}
        {/* WATCHING + motion bar */}
        {watching && (
          <div style={{ position: "absolute", top: 4, left: 16, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontFamily: "var(--jmono)", fontSize: 7, color: "#4ade80", letterSpacing: 1 }}>WATCHING</span>
            <div style={{ width: 24, height: 3, background: "#ffffff11", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(motionPct * 5, 100)}%`, height: "100%", background: motionPct >= MOTION_THRESHOLD ? "#fbbf24" : "#4ade8077", transition: "width 0.3s" }} />
            </div>
          </div>
        )}
        {analyzing && <div style={{ position: "absolute", bottom: 4, left: 6, right: 6, fontFamily: "var(--jmono)", fontSize: 7, color: "#00d4ff88", textAlign: "center", letterSpacing: 1 }}>ANALYSING…</div>}
        <button onClick={onClose} style={{ position: "absolute", top: 3, right: 4, background: "rgba(0,0,0,0.6)", border: "none", color: "#ff6677", fontSize: 13, cursor: "pointer", lineHeight: 1, width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {/* Latest JARVIS vision note */}
      {watchNote && watching && (
        <div style={{ maxWidth: 200, padding: "5px 8px", background: "rgba(0,0,0,0.85)", border: "1px solid #4ade8022", borderRadius: 8, fontFamily: "var(--jmono)", fontSize: 8, color: "#4ade80aa", lineHeight: 1.5, animation: "jFU 0.2s ease" }}>
          {watchNote}
        </div>
      )}
      {/* Action buttons */}
      {ready && !err && (
        <div style={{ display: "flex", gap: 5 }}>
          {onAnalyze && (
            <button onClick={() => setWatching((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 9px", background: watching ? "rgba(74,222,128,0.15)" : "rgba(0,212,255,0.08)", border: `1px solid ${watching ? "#4ade8044" : "#00d4ff33"}`, borderRadius: 8, color: watching ? "#4ade80" : "#00d4ff88", fontSize: 8, letterSpacing: 1, cursor: "pointer", fontFamily: "var(--jmono)" }}>
              {watching ? "◉ STOP" : "◎ WATCH"}
            </button>
          )}
          <button onClick={capture} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 9px", background: "rgba(0,212,255,0.1)", border: "1px solid #00d4ff44", borderRadius: 8, color: "#00d4ff", fontSize: 8, letterSpacing: 1, cursor: "pointer", fontFamily: "var(--jmono)" }}>
            <IconScan /> SEND
          </button>
        </div>
      )}
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────
function MsgBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  const ac = msg.agent && AGENTS[msg.agent] ? AGENTS[msg.agent].color : "#00d4ff";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", gap: 3, animation: "jFU 0.25s ease" }}>
      <div style={{ fontSize: 9, color: "#2a4a6a", letterSpacing: 1, fontFamily: "var(--jmono)" }}>{isUser ? "YOU" : (msg.agent || "JARVIS").toUpperCase()} · {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
      {msg.searches?.length ? <div style={{ fontSize: 9, color: "#fbbf2444" }}>⟳ {msg.searches.join(", ")}</div> : null}
      <div style={{ maxWidth: "84%", padding: "10px 14px", borderRadius: isUser ? "14px 14px 3px 14px" : "14px 14px 14px 3px", background: isUser ? "rgba(0,212,255,0.07)" : "rgba(8,16,32,0.92)", border: `1px solid ${isUser ? "#1a3a5a" : ac + "22"}`, fontSize: 14, color: isUser ? "#ccd6f6" : "#b0c8e0", lineHeight: 1.7 }}>
        {msg.content}
      </div>
    </div>
  );
}

function Dots({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "10px 14px" }}>
      {[0, 1, 2].map((i) => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: color, animation: "jDot 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }} />)}
    </div>
  );
}

// ── Key field ──────────────────────────────────────────────
function KeyField({ label, note, value, onChange, active }: { label: string; note: string; value: string; onChange: (v: string) => void; active: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: "var(--jmono)", fontSize: 9, color: "#2a5a7a", letterSpacing: 1 }}>{label}</span>
        <span style={{ fontFamily: "var(--jmono)", fontSize: 8, color: active ? "#4ade80" : "#ff4455", display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: active ? "#4ade80" : "#ff4455", display: "inline-block" }} />{active ? "SET" : "MISSING"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Paste key here…"
          style={{ flex: 1, background: "rgba(0,0,0,0.5)", border: `1px solid ${active ? "#1a4a2a" : "#2a1a1a"}`, borderRadius: 8, color: "#ccd6f6", fontFamily: "var(--jmono)", fontSize: 11, padding: "8px 10px" }} />
        <button onClick={() => setShow((v) => !v)} style={{ padding: "8px 10px", background: "rgba(0,0,0,0.4)", border: "1px solid #1a2a40", borderRadius: 8, color: "#4a6a8a", cursor: "pointer", fontSize: 12 }}>{show ? "🔒" : "👁"}</button>
      </div>
      <div style={{ marginTop: 3, fontSize: 9, color: "#1a3a5a" }}>{note}</div>
    </div>
  );
}

// ── Small btn ──────────────────────────────────────────────
const BS: React.CSSProperties = { padding: "8px 14px", background: "rgba(0,212,255,0.07)", border: "1px solid #1a2a40", borderRadius: 8, color: "#00d4ff", fontFamily: "var(--jmono)", fontSize: 10, letterSpacing: 1.5, cursor: "pointer" };

// ══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════
type View = "home" | "chat" | "memory" | "settings";

function JARVIS() {
  // ── view / nav ───────────────────────────────────────────
  const [view, setView] = useState<View>("home");

  // ── rooms ────────────────────────────────────────────────
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  // ── ai state ─────────────────────────────────────────────
  const [state, setState] = useState("idle");
  const [activeAgent, setActiveAgent] = useState("jarvis");
  const [transcript, setTranscript] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // ── device ───────────────────────────────────────────────
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [weather, setWeather] = useState<any>(null);
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  const [time, setTime] = useState<Date | null>(null);

  // ── memory ───────────────────────────────────────────────
  const [memory, setMemory] = useState<Memory>({ projects: [], clients: [], tasks: [], preferences: [] });
  const [pillarStats, setPillarStats] = useState<any>(null);
  const [uploadMsg, setUploadMsg] = useState("");

  // ── actions ──────────────────────────────────────────────
  const [pendingAction, setPendingAction] = useState<any>(null);
  const [countdown, setCountdown] = useState(3);
  const [activeTimer, setActiveTimer] = useState<{ seconds: number; label?: string } | null>(null);
  const [websiteResult, setWebsiteResult] = useState<{ html: string; summary: string } | null>(null);

  // ── ui ───────────────────────────────────────────────────
  const [voiceOn, setVoiceOn] = useState(true);
  const [textInput, setTextInput] = useState("");
  const [pendingImg, setPendingImg] = useState<{ mediaType: string; data: string; previewUrl: string } | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [homeReply, setHomeReply] = useState<string>(""); // JARVIS reply shown on home screen
  const [backendLogs, setBackendLogs] = useState<string[]>(["[NEXUS-7] Initializing…", "[AI] Claude · Gemini · NEXUS-7 ready", "[MEMORY] Supabase sync active", "[AGENTS] 5 specialists online"]);

  // track current view inside async callbacks without stale closure
  const viewRef = useRef<View>("home");
  viewRef.current = view;

  // ── wake word ─────────────────────────────────────────────
  const [wakeActive, setWakeActive] = useState(false);
  const [wakeHeard, setWakeHeard] = useState(false);
  const wakeRecRef = useRef<any>(null);
  const wakeActiveRef = useRef(false);
  const wakeHeardRef = useRef(false); // prevent restart loop after detection

  // ── keys ─────────────────────────────────────────────────
  const [keys, setKeys] = useState<StoredKeys>(EMPTY_KEYS);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [keySaveMsg, setKeySaveMsg] = useState("");
  const [memCat, setMemCat] = useState<keyof Memory>("projects");
  const [memTitle, setMemTitle] = useState(""); const [memContent, setMemContent] = useState("");

  // ── refs ─────────────────────────────────────────────────
  const recRef = useRef<any>(null); const liveRef = useRef("");
  const chatRef = useRef<HTMLDivElement>(null);
  const cntRef = useRef<any>(null); const pendRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const memRef = useRef<Memory>(memory); memRef.current = memory;
  const pillarsRef = useRef<any>({ identity: null, goals: null, relationships: [], knowledge: [] });
  // live camera frame capture — set by CameraPIP when mounted
  const cameraCaptureRef = useRef<(() => string | null) | null>(null);
  // recent vision descriptions from watch mode — last 10, for follow-up context
  const recentDescriptions = useRef<string[]>([]);
  // wake restart fn exposed by the wake useEffect
  const restartWakeRef = useRef<(() => void) | null>(null);

  // ── server fns ───────────────────────────────────────────
  const routeIntentFn    = useServerFn(routeIntent);
  const chatAgenticFn    = useServerFn(chatAgentic);
  const buildWebsiteFn   = useServerFn(buildWebsite);
  const synthFn          = useServerFn(synthesizeSpeech);
  const recallFn         = useServerFn(recallKnowledge);
  const logFn            = useServerFn(logKnowledge);
  const uploadFn         = useServerFn(uploadPillars);
  const retrieveFn       = useServerFn(retrievePillars);
  const saveInterFn      = useServerFn(saveInteraction);
  const saveKeysFn       = useServerFn(saveApiKeys);
  const getKeyStatusFn   = useServerFn(getKeyStatus);

  const color = STATE_C[state] || "#00d4ff";
  const activeRoom = rooms.find((r) => r.id === activeRoomId) || null;

  // ── init ─────────────────────────────────────────────────
  useEffect(() => { setTime(new Date()); const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { setMemory(loadMemory()); }, []);
  useEffect(() => {
    const loaded = loadRooms();
    const list = loaded.length ? loaded : [mkRoom()];
    if (!loaded.length) saveRooms(list);
    setRooms(list); setActiveRoomId(list[0].id);
  }, []);
  useEffect(() => {
    const k = loadKeys(); setKeys(k);
    // Restore keys to server on load
    const any = Object.values(k).some(Boolean);
    if (any) { saveKeysFn({ data: { anthropic: k.anthropic, googleAi: k.googleAi, elevenLabs: k.elevenLabs, supabaseUrl: k.supabaseUrl, supabaseAnonKey: k.supabaseAnon, supabaseServiceKey: k.supabaseService } }).catch(() => { }); }
    getKeyStatusFn({ data: {} }).then(setKeyStatus).catch(() => { });
  }, []);
  useEffect(() => {
    retrieveFn({ data: {} }).then((p: any) => { pillarsRef.current = p; setPillarStats(p.stats); addLog("[PILLARS] Memory sync complete"); }).catch(() => addLog("[PILLARS] Supabase pending — add key in System"));
  }, [retrieveFn]);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setLocation(loc);
      const w = await getWeather(loc.lat, loc.lon);
      if (w) { setWeather(w); addLog(`[LOC] ${w.city} · ${w.temp}°C · ${w.condition}`); }
    }, undefined, { enableHighAccuracy: true });
  }, []);
  useEffect(() => { (navigator as any).getBattery?.().then((b: any) => { const u = () => setBattery({ level: Math.round(b.level * 100), charging: b.charging }); u(); b.onlevelchange = u; b.onchargingchange = u; }).catch(() => { }); }, []);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [activeRoom?.messages, state]);

  // Wire the custom wake event → startListen (defined below, hoisted via ref)
  const startListenRef = useRef<() => void>(() => {});
  useEffect(() => {
    const handler = () => startListenRef.current();
    window.addEventListener("jarvis:wake", handler);
    return () => window.removeEventListener("jarvis:wake", handler);
  }, []);

  // ── Wake-word listener ────────────────────────────────────────────────────
  // Uses continuous:false (more reliable on Chrome Android) + instant restart loop.
  // Each cycle listens for one utterance, checks for wake phrase, restarts if not found.
  useEffect(() => {
    wakeActiveRef.current = wakeActive;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (!wakeActive) {
      wakeHeardRef.current = false;
      try { wakeRecRef.current?.stop(); } catch { }
      wakeRecRef.current = null;
      restartWakeRef.current = null;
      return;
    }

    const WAKE_PHRASES = ["hey jarvis", "jarvis", "ok jarvis", "oi jarvis", "hey javis", "javis", "hey j", "jarv"];

    const startWake = () => {
      if (!wakeActiveRef.current || wakeHeardRef.current) return;
      if (recRef.current) { setTimeout(startWake, 800); return; } // command active, wait
      if (wakeRecRef.current) return; // already listening

      try {
        const rec = new SR();
        rec.continuous = false;      // single-shot — most reliable on Android
        rec.interimResults = false;  // only final results to reduce noise
        rec.lang = "en-GB";
        rec.maxAlternatives = 3;

        rec.onresult = (e: any) => {
          // Gather all alternatives from all results
          const texts: string[] = [];
          for (let r = 0; r < e.results.length; r++) {
            for (let a = 0; a < e.results[r].length; a++) {
              texts.push(e.results[r][a].transcript.toLowerCase());
            }
          }
          const heard = texts.some((t) => WAKE_PHRASES.some((p) => t.includes(p)));
          if (heard && !wakeHeardRef.current) {
            wakeHeardRef.current = true;
            setWakeHeard(true);
            wakeRecRef.current = null;
            try { rec.stop(); } catch { }
            setTimeout(() => {
              setWakeHeard(false);
              wakeHeardRef.current = false;
              window.dispatchEvent(new CustomEvent("jarvis:wake"));
            }, 350);
          }
        };

        rec.onerror = (e: any) => {
          wakeRecRef.current = null;
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            setWakeActive(false); wakeActiveRef.current = false;
          } else if (e.error !== "aborted" && e.error !== "no-speech") {
            // network / audio-capture errors — back off then retry
            if (wakeActiveRef.current) setTimeout(startWake, 1500);
          }
          // no-speech: handled by onend restart
        };

        rec.onend = () => {
          wakeRecRef.current = null;
          // Restart immediately unless wake word was detected or wake turned off
          if (wakeActiveRef.current && !wakeHeardRef.current) setTimeout(startWake, 150);
        };

        rec.start();
        wakeRecRef.current = rec;
      } catch { setTimeout(startWake, 1000); }
    };

    restartWakeRef.current = startWake;
    startWake();

    return () => {
      wakeActiveRef.current = false;
      wakeHeardRef.current = false;
      restartWakeRef.current = null;
      try { wakeRecRef.current?.stop(); } catch { }
      wakeRecRef.current = null;
    };
  }, [wakeActive]);

  const addLog = (l: string) => setBackendLogs((p) => [...p.slice(-80), `[${new Date().toLocaleTimeString()}] ${l}`]);

  // ── Rooms helpers ────────────────────────────────────────
  const updateRoom = useCallback((id: string, fn: (r: Room) => Room) => {
    setRooms((prev) => { const u = prev.map((r) => r.id === id ? fn(r) : r); saveRooms(u); return u; });
  }, []);
  const addMsg = useCallback((roomId: string, msg: ChatMsg) => {
    updateRoom(roomId, (r) => ({ ...r, messages: [...r.messages, msg], title: r.messages.length === 0 && msg.role === "user" ? msg.content.slice(0, 40) : r.title }));
  }, [updateRoom]);
  const createRoom = useCallback(() => {
    const r = mkRoom();
    setRooms((p) => { const u = [r, ...p]; saveRooms(u); return u; });
    setActiveRoomId(r.id); setView("chat");
  }, []);

  // ── Memory helpers ───────────────────────────────────────
  const addMemEntry = useCallback((cat: keyof Memory, title: string, content: string) => {
    const e: MemEntry = { id: Date.now().toString(36), title, content };
    setMemory((p) => { const u = { ...p, [cat]: [...(p[cat] || []), e] }; saveMemCat(cat, u[cat]); return u; });
  }, []);
  const delMemEntry = useCallback((cat: keyof Memory, id: string) => {
    setMemory((p) => { const u = { ...p, [cat]: p[cat].filter((e) => e.id !== id) }; saveMemCat(cat, u[cat]); return u; });
  }, []);

  // ── Pillar upload ────────────────────────────────────────
  const handlePillarFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return; setUploadMsg("Parsing…");
    const payload: any = {};
    for (const f of Array.from(files)) {
      try {
        const j = JSON.parse(await f.text()), n = f.name.toLowerCase();
        if (n.includes("identity") || j.identity) payload.identity = j.identity ?? j;
        else if (n.includes("goal") || j.goals) payload.goals = j.goals ?? j;
        else if (n.includes("relation") || j.relationships) payload.relationships = j.relationships ?? j;
        else if (n.includes("knowledge") || j.knowledge) payload.knowledge = j.knowledge ?? j;
        else if (Array.isArray(j)) payload.knowledge = j; else payload.identity = j;
      } catch { setUploadMsg(`✗ ${f.name} bad JSON`); return; }
    }
    try {
      const res = await uploadFn({ data: payload });
      const msg = Object.entries(res.report).map(([k, v]: [string, any]) => `${k}: ${v.ok ? "✓" : "✗"}`).join(" · ");
      setUploadMsg(msg); addLog(`[PILLARS] ${msg}`);
      const fresh = await retrieveFn({ data: {} }); pillarsRef.current = fresh; setPillarStats(fresh.stats);
    } catch (e: any) { setUploadMsg("Upload failed: " + e?.message); }
  }, [uploadFn, retrieveFn]);

  // ── Save API keys ────────────────────────────────────────
  const handleSaveKeys = useCallback(async () => {
    setKeySaveMsg("Saving…");
    saveKeys(keys);
    try {
      const res = await saveKeysFn({ data: { anthropic: keys.anthropic, googleAi: keys.googleAi, elevenLabs: keys.elevenLabs, supabaseUrl: keys.supabaseUrl, supabaseAnonKey: keys.supabaseAnon, supabaseServiceKey: keys.supabaseService } });
      setKeySaveMsg(`✓ Active: ${res.active.join(", ") || "none"}`);
      const status = await getKeyStatusFn({ data: {} }); setKeyStatus(status);
      addLog(`[KEYS] Saved: ${res.active.join(", ")}`);
    } catch (e: any) { setKeySaveMsg("Save failed: " + e?.message); }
  }, [keys, saveKeysFn, getKeyStatusFn]);

  // ── Voice output ─────────────────────────────────────────
  const finish = useCallback((text: string) => {
    if (voiceOn) {
      setState("speaking");
      const done = () => { setState("idle"); setSearchQuery(""); };
      if (keys.elevenLabs) speakEleven(text, keys.elevenLabs, done);
      else speakServer(text, synthFn, done);
    } else { setState("idle"); }
  }, [voiceOn, keys.elevenLabs, synthFn]);

  // ── Core respond ─────────────────────────────────────────
  const respondCore = useCallback(async (userText: string, roomId: string, ctxTag?: string) => {
    setState("thinking"); setActiveAgent("jarvis");
    try {
      const memCtx = buildMemCtx(memRef.current);
      let pillarCtx = "";
      try { const fresh = await retrieveFn({ data: { query: userText } }); pillarsRef.current = fresh; pillarCtx = buildPillarContext(fresh); } catch { pillarCtx = buildPillarContext(pillarsRef.current); }
      let learned = "";
      try { const { facts } = await recallFn({ data: { query: userText, limit: 6 } }); if (facts?.length) learned = "KNOWLEDGE:\n" + facts.map((f: any) => `• ${f.topic}: ${f.content}`).join("\n"); } catch { /**/ }
      const visionCtx = recentDescriptions.current.length
        ? "RECENT VISION (camera watch):\n" + recentDescriptions.current.map((d, i) => `• [${i + 1}] ${d}`).join("\n")
        : "";
      const sys = [jarvisSystem(), pillarCtx, memCtx, learned, visionCtx].filter(Boolean).join("\n\n");
      const room = rooms.find((r) => r.id === roomId);
      const hist: ApiMessage[] = (room?.messages || []).map((m) => ({ role: m.role, content: m.content }));
      const final = ctxTag ? userText + "\n" + ctxTag : userText;
      const { reply, searches } = await chatAgenticFn({ data: { system: sys, messages: [...hist, { role: "user" as const, content: final }], useTools: true } });
      addMsg(roomId, { role: "assistant", content: reply, agent: "jarvis", searches, ts: Date.now() });
      addLog(`[JARVIS] "${reply.slice(0, 60)}"`);
      // Show inline on home screen without navigating away
      if (viewRef.current === "home") setHomeReply(reply);
      // Persist conversation as a knowledge fact for cross-session recall
      saveInterFn({ data: { userInput: userText, jarvisResponse: reply, agent: "jarvis" } }).catch(() => { });
      logFn({ data: { topic: userText.slice(0, 200), content: reply.slice(0, 2000), source: "conversation" } }).catch(() => { });
      if (searches?.length) logFn({ data: { topic: searches[0].slice(0, 200), content: reply.slice(0, 2000), source: searches.join("|").slice(0, 200) } }).catch(() => { });
      finish(reply);
    } catch (e: any) {
      const errMsg = e?.message?.includes("key") || e?.message?.includes("credit")
        ? e.message
        : "I hit an unexpected error, sir. Please check System → Settings and ensure API keys are configured.";
      addMsg(roomId, { role: "assistant", content: errMsg, agent: "jarvis", ts: Date.now() });
      if (viewRef.current === "home") setHomeReply(errMsg);
      setState("idle");
    }
  }, [rooms, addMsg, finish, chatAgenticFn, recallFn, logFn, retrieveFn, saveInterFn]);

  const respondAgent = useCallback(async (agentId: string, task: string, roomId: string) => {
    setState("thinking"); setActiveAgent(agentId); addLog(`[AGENT:${agentId.toUpperCase()}] ${task.slice(0, 60)}`);
    try {
      const agent = AGENTS[agentId];
      const sys = [agent?.prompt, buildMemCtx(memRef.current), buildPillarContext(pillarsRef.current)].filter(Boolean).join("\n\n");
      const codeMode = agent?.codeMode ?? false;
      const { reply, searches } = await chatAgenticFn({ data: { system: sys, messages: [{ role: "user" as const, content: task }], useTools: true, codeMode, maxTokens: codeMode ? 4000 : 800 } });
      addMsg(roomId, { role: "assistant", content: reply, agent: agentId, searches, ts: Date.now() });
      addLog(`[AGENT:${agentId.toUpperCase()}] Done.`);
      saveInterFn({ data: { userInput: task, jarvisResponse: reply, agent: agentId } }).catch(() => {});
      finish(reply);
    } catch (e: any) {
      const errMsg = e?.message?.includes("key") || e?.message?.includes("credit")
        ? e.message
        : "Agent temporarily unavailable, sir. Please check your API keys in System → Settings.";
      addMsg(roomId, { role: "assistant", content: errMsg, agent: agentId, ts: Date.now() });
      setState("idle");
    }
  }, [addMsg, finish, chatAgenticFn, saveInterFn]);

  // ── Action countdown ─────────────────────────────────────
  const runPending = useCallback(async () => {
    const intent = pendRef.current; if (!intent) return;
    setPendingAction(null); clearInterval(cntRef.current); setState("executing");
    const r = await execAction(intent, location);
    if (!r) { setState("idle"); return; }
    if ((r as any).timerSeconds) setActiveTimer({ seconds: (r as any).timerSeconds, label: intent.label });
    addLog(`[ACTION] ${r.msg}`);
    if (activeRoomId) await respondCore(intent.originalText || "", activeRoomId, r.success ? `[ACTION_EXECUTED: ${r.msg}]` : `[ACTION_NEEDED: ${r.msg}]`);
    else setState("idle");
  }, [location, activeRoomId, respondCore]);
  const cancelPending = () => { setPendingAction(null); clearInterval(cntRef.current); setState("idle"); };
  useEffect(() => {
    if (!pendingAction) return; setCountdown(3); clearInterval(cntRef.current);
    cntRef.current = setInterval(() => setCountdown((p) => { if (p <= 1) { clearInterval(cntRef.current); runPending(); return 0; } return p - 1; }), 1000);
    return () => clearInterval(cntRef.current);
  }, [pendingAction, runPending]);

  // ── Image helpers ────────────────────────────────────────
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { const s = r.result as string; const [h, d] = s.split(","); setPendingImg({ mediaType: h.match(/data:(.*);base64/)?.[1] || "image/png", data: d, previewUrl: s }); }; r.readAsDataURL(f); e.target.value = "";
  };
  const handleCameraCapture = useCallback((dataUrl: string) => {
    const [h, d] = dataUrl.split(","); setPendingImg({ mediaType: "image/jpeg", data: d, previewUrl: dataUrl }); setShowCamera(false);
    if (activeRoomId) setView("chat");
  }, [activeRoomId]);

  // ── Main dispatch ────────────────────────────────────────
  const sendToJarvis = useCallback(async (userText: string, img?: { mediaType: string; data: string } | null) => {
    if (!userText?.trim() && !img) return;
    if (state !== "idle") return;

    // Auto-capture live camera frame if camera is open and no static image was provided
    let effectiveImg = img;
    if (!effectiveImg && cameraCaptureRef.current) {
      const dataUrl = cameraCaptureRef.current();
      if (dataUrl) {
        const [, d] = dataUrl.split(",");
        effectiveImg = { mediaType: "image/jpeg", data: d };
      }
    }

    let rid = activeRoomId;
    if (!rid) { const r = mkRoom(); setRooms((p) => { const u = [r, ...p]; saveRooms(u); return u; }); setActiveRoomId(r.id); rid = r.id; }
    // Only switch to chat view if user is not already on home screen
    if (viewRef.current !== "home") setView("chat");
    setHomeReply(""); // clear previous home reply when new message starts
    addMsg(rid, { role: "user", content: effectiveImg ? (userText || "[Camera view]") : userText, ts: Date.now() }); setTextInput("");
    if (effectiveImg) {
      setState("analyzing"); setActiveAgent("jarvis");
      try {
        const room = rooms.find((r) => r.id === rid);
        const hist: ApiMessage[] = (room?.messages || []).map((m) => ({ role: m.role, content: m.content }));
        const prompt = userText || "What do you see in front of me right now? Describe what the camera is showing, sir.";
        const { reply } = await chatAgenticFn({ data: { system: `${jarvisSystem()}\n\n${buildMemCtx(memRef.current)}`, messages: [...hist, { role: "user" as const, content: [{ type: "image" as const, source: { type: "base64" as const, media_type: effectiveImg.mediaType, data: effectiveImg.data } }, { type: "text" as const, text: prompt }] }], useTools: false, maxTokens: 1200 } });
        addMsg(rid, { role: "assistant", content: reply, agent: "jarvis", ts: Date.now() });
        if (viewRef.current === "home") setHomeReply(reply);
        saveInterFn({ data: { userInput: userText || "[Camera view]", jarvisResponse: reply, agent: "jarvis" } }).catch(() => {});
        logFn({ data: { topic: (userText || "camera view").slice(0, 200), content: reply.slice(0, 2000), source: "vision" } }).catch(() => {});
        finish(reply);
      } catch { addMsg(rid, { role: "assistant", content: "Vision error, sir.", ts: Date.now() }); setState("idle"); }
      return;
    }
    setState("thinking");
    let intent: any;
    try { intent = await routeIntentFn({ data: { text: userText } }); addLog(`[ROUTER] ${intent.action}`); } catch { intent = { action: "chat" }; }
    if (intent.action === "remember") { addMemEntry((intent.category + "s") as keyof Memory || "tasks", intent.title || userText.slice(0, 40), intent.content || userText); addMsg(rid, { role: "assistant", content: `Stored to ${intent.category} memory, sir.`, agent: "jarvis", ts: Date.now() }); setState("idle"); return; }
    if (intent.action === "agent") { await respondAgent(intent.agent, intent.task || userText, rid); return; }
    if (intent.action === "build_website") {
      setState("building"); addLog(`[BUILDER] ${intent.description?.slice(0, 60)}`);
      try {
        const { html, summary } = await buildWebsiteFn({ data: { description: intent.description || userText, memoryContext: buildMemCtx(memRef.current) } });
        setWebsiteResult({ html, summary }); addMsg(rid, { role: "assistant", content: summary, agent: "builder", ts: Date.now() }); addLog("[BUILDER] Complete."); finish(summary);
      } catch { addMsg(rid, { role: "assistant", content: "Build failed, sir.", ts: Date.now() }); setState("idle"); }
      return;
    }
    const isAction = !["chat", "remember", "agent", "build_website"].includes(intent.action);
    if (isAction) { pendRef.current = { ...intent, originalText: userText }; setPendingAction({ ...intent, originalText: userText }); setState("idle"); return; }
    await respondCore(userText, rid);
  }, [state, activeRoomId, rooms, addMsg, addMemEntry, respondCore, respondAgent, routeIntentFn, buildWebsiteFn, chatAgenticFn, finish, saveInterFn]);

  // ── Voice rec ─────────────────────────────────────────────
  const startListen = useCallback(() => {
    if (state !== "idle") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition needs Chrome, sir."); return; }
    // Pause the wake listener while command rec is active
    try { wakeRecRef.current?.stop(); wakeRecRef.current = null; } catch { }
    const rec = new SR(); rec.continuous = false; rec.interimResults = true; rec.lang = "en-GB";
    rec.onstart = () => { setState("listening"); setTranscript(""); liveRef.current = ""; };
    rec.onresult = (e: any) => { const t = Array.from(e.results).map((r: any) => r[0].transcript).join(""); liveRef.current = t; setTranscript(t); };
    rec.onerror = () => { recRef.current = null; setState("idle"); setTranscript(""); setTimeout(() => restartWakeRef.current?.(), 500); };
    rec.onend = () => {
      recRef.current = null;
      const f = liveRef.current.trim(); setTranscript("");
      if (f) sendToJarvis(f); else setState("idle");
      // Resume wake listener after command completes
      setTimeout(() => restartWakeRef.current?.(), 800);
    };
    recRef.current = rec; rec.start();
  }, [state, sendToJarvis]);
  const stopListen = useCallback(() => { try { recRef.current?.stop(); } catch { } }, []);

  // Keep the ref in sync so the wake event handler always calls the latest version
  useEffect(() => { startListenRef.current = startListen; }, [startListen]);

  const handleSend = useCallback(() => {
    if (state !== "idle") return;
    const img = pendingImg; setPendingImg(null);
    const txt = textInput; setTextInput("");
    sendToJarvis(txt, img);
  }, [state, textInput, pendingImg, sendToJarvis]);

  // ── Responsive orb size ───────────────────────────────────
  const [orbSize, setOrbSize] = useState(200);
  useEffect(() => {
    const update = () => setOrbSize(Math.min(Math.max(window.innerWidth * 0.44, 140), 220));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ── Input bar (shared) ────────────────────────────────────
  const InputBar = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {pendingImg && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "rgba(0,212,255,0.06)", border: "1px solid #1a3a5a", borderRadius: 10 }}>
          <img src={pendingImg.previewUrl} alt="" style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 4 }} />
          <span style={{ flex: 1, fontSize: 11, color: "#4a8aaa" }}>Image attached</span>
          <button onClick={() => setPendingImg(null)} style={{ background: "none", border: "none", color: "#ff6677", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <button onMouseDown={startListen} onMouseUp={stopListen} onTouchStart={(e) => { e.preventDefault(); startListen(); }} onTouchEnd={(e) => { e.preventDefault(); stopListen(); }}
          disabled={!["idle", "listening"].includes(state)}
          style={{ ...BS, padding: "0 14px", fontSize: 16, color: state === "listening" ? "#ff4455" : "#2a5a7a", borderColor: state === "listening" ? "#ff445555" : "#1a2a3a" }}>
          {state === "listening" ? "■" : "○"}
        </button>
        <input type="file" accept="image/*" ref={fileRef} style={{ display: "none" }} onChange={handleFile} />
        <button onClick={() => fileRef.current?.click()} disabled={state !== "idle"} title="Upload image" style={{ ...BS, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "center", color: "#2a5a7a" }}><IconUpload /></button>
        <button onClick={() => setShowCamera((v) => !v)} title="Live camera" style={{ ...BS, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "center", borderColor: showCamera ? "#00d4ff44" : "#1a2a3a", color: showCamera ? "#00d4ff" : "#2a5a7a" }}><IconCamera /></button>
        <input value={textInput} onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          disabled={state !== "idle"} placeholder="Command, sir…"
          style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid #1a2a40", borderRadius: 10, color: "#ccd6f6", fontSize: 14, padding: "10px 14px", minWidth: 0 }} />
        <button onClick={handleSend} disabled={state !== "idle" || (!textInput.trim() && !pendingImg)}
          style={{ ...BS, padding: "0 16px", fontSize: 18, borderColor: "#00d4ff33", color: "#00d4ff" }}>↑</button>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700&family=Share+Tech+Mono&family=Inter:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        :root{--jorb:'Orbitron',monospace;--jmono:'Share Tech Mono',monospace;}
        html,body{height:100%;background:#060d1a;-webkit-tap-highlight-color:transparent;}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1a3050;border-radius:2px}
        input,textarea{outline:none;caret-color:#00d4ff;}
        button:active{opacity:0.7;}
        @keyframes jSpin   {from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes jSpinSlow{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes jSpinR  {from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}
        @keyframes jOrbP   {0%,100%{opacity:0.3;transform:scale(1)}50%{opacity:0.6;transform:scale(1.03)}}
        @keyframes jCoreP  {0%,100%{opacity:0.5}50%{opacity:1}}
        @keyframes jFU     {from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes jDot    {0%,80%,100%{transform:scale(0);opacity:0.3}40%{transform:scale(1);opacity:1}}
        @keyframes jBlink  {0%,100%{opacity:1}50%{opacity:0}}
        @keyframes jWake   {0%,100%{transform:scale(1);opacity:0.6}50%{transform:scale(1.18);opacity:1}}
        @keyframes jWakeRing{0%{transform:scale(0.9);opacity:0.8}100%{transform:scale(1.6);opacity:0}}
      `}</style>

      {showCamera && <CameraPIP
        onCapture={handleCameraCapture}
        onClose={() => setShowCamera(false)}
        captureRef={cameraCaptureRef}
        recentDescriptions={recentDescriptions}
        onAnalyze={async (img) => {
          try {
            const prev = recentDescriptions.current.slice(-3).join(" → ");
            const sys = `You are JARVIS's vision system. Describe what you see in the camera frame in one concise sentence. Be specific about objects, people, text, or activity.${prev ? ` Previous observations: ${prev}` : ""} British voice, no markdown.`;
            const { reply } = await chatAgenticFn({ data: { system: sys, messages: [{ role: "user" as const, content: [{ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType as any, data: img.data } }, { type: "text" as const, text: "What do you see?" }] }], useTools: false, maxTokens: 120 } });
            return reply;
          } catch { return ""; }
        }}
      />}

      <div style={{ height: "100svh", display: "flex", flexDirection: "column", background: "#060d1a", position: "relative", overflow: "hidden", fontFamily: "'Inter',system-ui,sans-serif", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <GridBg />

        {/* ── HOME ── */}
        {view === "home" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "clamp(12px,3vw,24px)", paddingBottom: 8, position: "relative", zIndex: 1, overflow: "hidden" }}>
            <CD pos="tl" /><CD pos="tr" /><CD pos="bl" /><CD pos="br" />
            {/* Top bar */}
            <div style={{ width: "100%", maxWidth: 520, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div><div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a3a5a", letterSpacing: 2 }}>JARVIS v6.0</div>{weather && <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a4a6a" }}>{weather.city} · {weather.temp}°C</div>}</div>
              <div style={{ fontFamily: "var(--jorb)", fontSize: "clamp(12px,3.5vw,16px)", color: "#00d4ff", letterSpacing: 3, opacity: 0.7, textShadow: "0 0 12px #00d4ff88" }}>{time?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) || "--:--:--"}</div>
              <div style={{ textAlign: "right" }}><div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a3a5a", letterSpacing: 2 }}>STARK IND.</div>{battery && <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: battery.charging ? "#4ade8077" : "#fbbf2477" }}>{battery.level}%</div>}</div>
            </div>
            {/* Orb + status */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, flex: 1, justifyContent: "center" }}>
              <div onClick={() => { if (state === "idle") setView("chat"); }} style={{ cursor: "pointer" }}>
                <JarvisOrb state={state} size={orbSize} />
              </div>
              <div style={{ fontFamily: "var(--jmono)", fontSize: 9, letterSpacing: 3, color, transition: "color 0.3s", textShadow: `0 0 8px ${color}66` }}>{STATE_L[state] || "ONLINE"}</div>
              {transcript && <div style={{ fontFamily: "var(--jmono)", fontSize: 11, color: "#81d4fa88", fontStyle: "italic", textAlign: "center", maxWidth: "80vw", animation: "jFU 0.2s ease" }}>"{transcript}"</div>}
              {/* JARVIS home reply — shown inline without navigating to chat */}
              {homeReply && state === "idle" && !transcript && (
                <div style={{ maxWidth: "min(480px, 90vw)", padding: "12px 16px", background: "rgba(0,212,255,0.05)", border: "1px solid #00d4ff22", borderRadius: 14, animation: "jFU 0.3s ease", position: "relative" }}>
                  <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#00d4ff44", letterSpacing: 2, marginBottom: 6 }}>JARVIS</div>
                  <div style={{ fontSize: 14, color: "#b0c8e0", lineHeight: 1.65 }}>{homeReply}</div>
                  <button onClick={() => setHomeReply("")} style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", color: "#1a3a5a", cursor: "pointer", fontSize: 14 }}>×</button>
                </div>
              )}
              {/* Wake word indicator */}
              {wakeActive && state === "idle" && !transcript && !homeReply && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, animation: "jFU 0.3s ease" }}>
                  <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {wakeHeard && <div style={{ position: "absolute", width: 48, height: 48, borderRadius: "50%", border: "2px solid #4ade80", animation: "jWakeRing 0.6s ease-out forwards" }} />}
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: wakeHeard ? "#4ade80" : "#22d3ee55", border: `1px solid ${wakeHeard ? "#4ade80" : "#22d3ee"}`, boxShadow: wakeHeard ? "0 0 16px #4ade80" : "0 0 8px #22d3ee44", animation: "jWake 2s ease-in-out infinite" }} />
                  </div>
                  <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: wakeHeard ? "#4ade80" : "#22d3ee55", letterSpacing: 2, textShadow: wakeHeard ? "0 0 8px #4ade80" : "none" }}>{wakeHeard ? "WAKE WORD DETECTED" : "SAY  HEY JARVIS"}</div>
                </div>
              )}
              {activeTimer && <TimerWidget seconds={activeTimer.seconds} label={activeTimer.label} onDone={() => { setActiveTimer(null); if (voiceOn) speakFallback("Timer done, sir."); }} />}
              {pendingAction && (
                <div style={{ padding: "12px 16px", background: "rgba(0,212,255,0.06)", border: "1px solid #00d4ff33", borderRadius: 12, textAlign: "center", minWidth: 220 }}>
                  <div style={{ fontFamily: "var(--jmono)", fontSize: 9, color: "#00d4ff", letterSpacing: 1, marginBottom: 6 }}>ACTION · {countdown}s</div>
                  <div style={{ fontSize: 13, color: "#81d4fa", marginBottom: 10 }}>{pendingAction.contact || pendingAction.destination || pendingAction.query || "Executing"}</div>
                  <div style={{ display: "flex", gap: 8 }}><button onClick={runPending} style={{ ...BS, flex: 1 }}>EXECUTE</button><button onClick={cancelPending} style={{ ...BS, flex: 1, borderColor: "#ff444522", color: "#ff6677" }}>CANCEL</button></div>
                </div>
              )}
            </div>
            {/* Input */}
            <div style={{ width: "100%", maxWidth: 520 }}>{InputBar}</div>
          </div>
        )}

        {/* ── CHAT ── */}
        {view === "chat" && (
          <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative", zIndex: 1 }}>
            {/* Sidebar */}
            <div style={{ width: "clamp(160px,28vw,220px)", flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid #0d1e35", background: "rgba(4,8,18,0.97)" }}>
              <div style={{ padding: "12px 10px 8px", borderBottom: "1px solid #0d1e35" }}>
                <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a4a6a", letterSpacing: 2, marginBottom: 6 }}>CONVERSATIONS</div>
                <button onClick={createRoom} style={{ width: "100%", padding: "7px 0", ...BS, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>+ NEW</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
                {rooms.map((r) => (
                  <button key={r.id} onClick={() => setActiveRoomId(r.id)}
                    style={{ width: "100%", textAlign: "left", padding: "8px 8px", borderRadius: 8, cursor: "pointer", background: r.id === activeRoomId ? "rgba(0,212,255,0.1)" : "transparent", border: r.id === activeRoomId ? "1px solid #00d4ff20" : "1px solid transparent", marginBottom: 2, transition: "all 0.15s" }}>
                    <div style={{ fontSize: 12, color: r.id === activeRoomId ? "#ccd6f6" : "#4a6a8a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                    <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a3a5a", marginTop: 2 }}>{r.messages.length} msgs</div>
                  </button>
                ))}
              </div>
              <div style={{ padding: "6px 8px", borderTop: "1px solid #0d1e35" }}>
                <button onClick={() => setView("home")} style={{ width: "100%", padding: "6px 0", background: "none", border: "none", color: "#1a4a6a", cursor: "pointer", fontFamily: "var(--jmono)", fontSize: 9, letterSpacing: 1 }}>← HOME</button>
              </div>
            </div>
            {/* Chat panel */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #0d1e35", background: "rgba(4,8,18,0.95)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <div><div style={{ fontFamily: "var(--jorb)", fontSize: 10, color: "#00d4ff88", letterSpacing: 2 }}>JARVIS</div><div style={{ fontFamily: "var(--jmono)", fontSize: 8, color, letterSpacing: 1, marginTop: 1 }}>{STATE_L[state] || "ONLINE"}</div></div>
                <div style={{ display: "flex", gap: 5 }}>{["jarvis", ...Object.keys(AGENTS)].map((a) => <div key={a} style={{ width: 7, height: 7, borderRadius: "50%", background: activeAgent === a && state !== "idle" ? (a === "jarvis" ? "#00d4ff" : AGENTS[a]?.color) : "transparent", border: `1px solid ${a === "jarvis" ? "#00d4ff44" : (AGENTS[a]?.color || "#00d4ff") + "44"}`, transition: "all 0.3s" }} />)}</div>
              </div>
              <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: 12 }}>
                {(!activeRoom || activeRoom.messages.length === 0) && (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 50, opacity: 0.4 }}>
                    <JarvisOrb state="idle" size={100} /><div style={{ fontFamily: "var(--jmono)", fontSize: 10, color: "#2a4a6a", letterSpacing: 2 }}>READY, SIR</div>
                  </div>
                )}
                {activeRoom?.messages.map((m, i) => <MsgBubble key={i} msg={m} />)}
                {["thinking", "searching", "building", "analyzing", "executing"].includes(state) && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                    <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#2a4a6a", letterSpacing: 1 }}>{activeAgent.toUpperCase()}</div>
                    <div style={{ background: "rgba(8,16,32,0.9)", border: `1px solid ${color}22`, borderRadius: "14px 14px 14px 3px" }}><Dots color={color} /></div>
                  </div>
                )}
                {websiteResult && (
                  <div style={{ background: "#0a0f1e", border: "1px solid #1a2744", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #1a2744" }}><span style={{ fontFamily: "var(--jmono)", fontSize: 9, color: "#fb923c" }}>WEBSITE PREVIEW</span><button onClick={() => setWebsiteResult(null)} style={{ background: "none", border: "none", color: "#ff6677", cursor: "pointer", fontSize: 16 }}>×</button></div>
                    <iframe srcDoc={websiteResult.html} sandbox="allow-scripts" title="preview" style={{ width: "100%", height: 220, border: "none", display: "block" }} />
                    <div style={{ display: "flex", gap: 8, padding: 8 }}><button onClick={() => navigator.clipboard?.writeText(websiteResult.html)} style={{ ...BS, flex: 1 }}>COPY HTML</button><button onClick={() => { const b = new Blob([websiteResult.html], { type: "text/html" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "site.html"; a.click(); }} style={{ ...BS, flex: 1 }}>DOWNLOAD</button></div>
                  </div>
                )}
                {activeTimer && <TimerWidget seconds={activeTimer.seconds} label={activeTimer.label} onDone={() => { setActiveTimer(null); if (voiceOn) speakFallback("Timer done, sir."); }} />}
                {pendingAction && (
                  <div style={{ padding: "10px 14px", background: "rgba(0,212,255,0.06)", border: "1px solid #00d4ff22", borderRadius: 10, maxWidth: 260 }}>
                    <div style={{ fontFamily: "var(--jmono)", fontSize: 9, color: "#00d4ff", letterSpacing: 1, marginBottom: 6 }}>ACTION · {countdown}s</div>
                    <div style={{ fontSize: 13, color: "#81d4fa", marginBottom: 8 }}>{pendingAction.contact || pendingAction.destination || pendingAction.query || "Executing"}</div>
                    <div style={{ display: "flex", gap: 6 }}><button onClick={runPending} style={{ ...BS, flex: 1 }}>EXECUTE</button><button onClick={cancelPending} style={{ ...BS, flex: 1, borderColor: "#ff444522", color: "#ff6677" }}>CANCEL</button></div>
                  </div>
                )}
              </div>
              <div style={{ padding: "10px 12px", borderTop: "1px solid #0d1e35", background: "rgba(4,8,18,0.95)", flexShrink: 0 }}>{InputBar}</div>
            </div>
          </div>
        )}

        {/* ── MEMORY ── */}
        {view === "memory" && (
          <div style={{ flex: 1, overflow: "auto", padding: "16px clamp(12px,4vw,24px)", position: "relative", zIndex: 1 }}>
            <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a4a6a", letterSpacing: 3 }}>MEMORY CORTEX</div>
              {/* Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                {[["IDENTITY", pillarStats?.identityLoaded ? "LOADED" : "—", "#00d4ff"], ["GOALS", pillarStats?.goalsCount ?? "—", "#c084fc"], ["RELATIONS", pillarStats?.relationshipsCount ?? "—", "#4ade80"], ["KNOWLEDGE", pillarStats?.knowledgeCount ?? "—", "#fbbf24"]].map(([l, v, c]) => (
                  <div key={l as string} style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #0d1e35", borderRadius: 8, padding: "8px 6px", textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--jmono)", fontSize: 7, color: "#1a4a6a", letterSpacing: 1, marginBottom: 4 }}>{l}</div>
                    <div style={{ fontFamily: "var(--jorb)", fontSize: 13, color: c as string }}>{v}</div>
                  </div>
                ))}
              </div>
              {/* Pillar upload */}
              <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #0d1e35", borderRadius: 10, padding: 12 }}>
                <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a6a8a", letterSpacing: 2, marginBottom: 8 }}>PILLAR SYNC</div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, ...BS, padding: "7px 12px", cursor: "pointer" }}>↑ UPLOAD PILLAR JSON<input type="file" accept=".json" multiple style={{ display: "none" }} onChange={(e) => { handlePillarFiles(e.target.files); e.target.value = ""; }} /></label>
                {uploadMsg && <div style={{ marginTop: 8, fontSize: 11, color: "#4ade80" }}>{uploadMsg}</div>}
                <div style={{ marginTop: 6, fontSize: 9, color: "#1a3a5a" }}>identity.json · goals.json · relationships.json · knowledge.json</div>
              </div>
              {/* Rooms */}
              <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #0d1e35", borderRadius: 10, padding: 12 }}>
                <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a6a8a", letterSpacing: 2, marginBottom: 8 }}>CONVERSATIONS ({rooms.length})</div>
                {rooms.map((r) => (
                  <button key={r.id} onClick={() => { setActiveRoomId(r.id); setView("chat"); }} style={{ width: "100%", textAlign: "left", padding: "8px 10px", background: "rgba(0,212,255,0.04)", border: "1px solid #1a2a40", borderRadius: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: "#8aa8c0" }}>{r.title}</span><span style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a4a6a" }}>{r.messages.length} msgs</span>
                  </button>
                ))}
              </div>
              {/* Local memory */}
              <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #0d1e35", borderRadius: 10, padding: 12 }}>
                <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a6a8a", letterSpacing: 2, marginBottom: 10 }}>LOCAL MEMORY</div>
                {MEM_CATS.map((cat) => (
                  <div key={cat} style={{ marginBottom: 12 }}>
                    <div style={{ fontFamily: "var(--jmono)", fontSize: 9, color: "#22d3ee66", letterSpacing: 1, marginBottom: 5 }}>{cat.toUpperCase()} ({memory[cat]?.length})</div>
                    {memory[cat]?.map((e) => (
                      <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 6px", borderBottom: "1px solid #0a1a2a" }}>
                        <div style={{ flex: 1 }}><div style={{ fontSize: 12, color: "#8aa8c0" }}>{e.title}</div><div style={{ fontSize: 10, color: "#2a5a7a" }}>{e.content}</div></div>
                        <button onClick={() => delMemEntry(cat, e.id)} style={{ background: "none", border: "none", color: "#ff444566", cursor: "pointer", fontSize: 16, padding: "0 2px" }}>×</button>
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{ borderTop: "1px solid #0d1e35", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  <select value={memCat} onChange={(e) => setMemCat(e.target.value as keyof Memory)} style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #1a2a40", borderRadius: 8, color: "#4a8aaa", fontFamily: "var(--jmono)", fontSize: 11, padding: "7px 10px" }}>{MEM_CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  <input value={memTitle} onChange={(e) => setMemTitle(e.target.value)} placeholder="Title" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #1a2a40", borderRadius: 8, color: "#ccd6f6", fontSize: 13, padding: "8px 10px" }} />
                  <input value={memContent} onChange={(e) => setMemContent(e.target.value)} placeholder="Details" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #1a2a40", borderRadius: 8, color: "#ccd6f6", fontSize: 13, padding: "8px 10px" }} />
                  <button onClick={() => { if (!memTitle.trim()) return; addMemEntry(memCat, memTitle, memContent); setMemTitle(""); setMemContent(""); }} style={{ ...BS, borderColor: "#22d3ee33", color: "#22d3ee" }}>+ ADD ENTRY</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {view === "settings" && (
          <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative", zIndex: 1 }}>
            {/* LEFT SIDEBAR */}
            <div style={{ width: "clamp(200px,30vw,260px)", flexShrink: 0, borderRight: "1px solid #0d1e35", display: "flex", flexDirection: "column", background: "rgba(4,8,18,0.97)", overflow: "auto" }}>
              <div style={{ padding: "14px 12px 8px", borderBottom: "1px solid #0d1e35" }}><div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a4a6a", letterSpacing: 3 }}>CONTROL CENTRE</div></div>

              {/* ── API KEYS ── */}
              <div style={{ padding: "12px 12px", borderBottom: "1px solid #0d1e35" }}>
                <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a5a7a", letterSpacing: 2, marginBottom: 10 }}>🔐 API KEYS</div>
                <KeyField label="ANTHROPIC (Claude)" note="Powers all agents + vision" value={keys.anthropic} onChange={(v) => setKeys((k) => ({ ...k, anthropic: v }))} active={!!keyStatus.anthropic} />
                <KeyField label="GOOGLE AI (Gemini)" note="Router + search fallback" value={keys.googleAi} onChange={(v) => setKeys((k) => ({ ...k, googleAi: v }))} active={!!keyStatus.googleAi} />
                <KeyField label="ELEVENLABS (Voice)" note="Daniel — British TTS" value={keys.elevenLabs} onChange={(v) => setKeys((k) => ({ ...k, elevenLabs: v }))} active={!!keyStatus.elevenLabs} />
                <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a5a7a", letterSpacing: 1, margin: "8px 0 6px" }}>SUPABASE</div>
                <KeyField label="SUPABASE URL" note="https://xxx.supabase.co" value={keys.supabaseUrl} onChange={(v) => setKeys((k) => ({ ...k, supabaseUrl: v }))} active={!!keyStatus.supabaseUrl} />
                <KeyField label="ANON KEY" note="Public anon key" value={keys.supabaseAnon} onChange={(v) => setKeys((k) => ({ ...k, supabaseAnon: v }))} active={!!keyStatus.supabaseAnon} />
                <KeyField label="SERVICE ROLE KEY" note="Server-side admin key" value={keys.supabaseService} onChange={(v) => setKeys((k) => ({ ...k, supabaseService: v }))} active={!!keyStatus.supabaseService} />
                <button onClick={handleSaveKeys} style={{ ...BS, width: "100%", marginTop: 4, borderColor: "#00d4ff44", color: "#00d4ff", padding: "9px 0" }}>⬆ SAVE ALL KEYS</button>
                {keySaveMsg && <div style={{ marginTop: 6, fontSize: 10, color: keySaveMsg.startsWith("✓") ? "#4ade80" : "#ff6677", fontFamily: "var(--jmono)" }}>{keySaveMsg}</div>}
                <div style={{ marginTop: 6, fontSize: 9, color: "#1a2a3a" }}>Keys stored locally + applied to server. Resets on server restart — re-save after deploy.</div>
              </div>

              {/* Voice toggle */}
              <div style={{ padding: "10px 12px", borderBottom: "1px solid #0d1e35", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "var(--jmono)", fontSize: 9, color: "#2a5a7a" }}>VOICE OUTPUT</span>
                <button onClick={() => setVoiceOn((v) => !v)} style={{ ...BS, padding: "4px 12px", borderColor: voiceOn ? "#00d4ff44" : "#1a2a40", color: voiceOn ? "#00d4ff" : "#2a5a7a", fontSize: 9 }}>{voiceOn ? "ON" : "OFF"}</button>
              </div>

              {/* Agents */}
              <div style={{ padding: "10px 12px", flex: 1, overflow: "auto" }}>
                <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a5a7a", letterSpacing: 2, marginBottom: 8 }}>AI AGENTS</div>
                <div style={{ padding: "8px 10px", background: "rgba(0,212,255,0.06)", border: "1px solid #00d4ff22", borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "var(--jmono)", fontSize: 14, color: "#00d4ff" }}>◉</span>
                    <div><div style={{ fontFamily: "var(--jmono)", fontSize: 9, color: "#00d4ff", letterSpacing: 1 }}>JARVIS CORE</div><div style={{ fontSize: 9, color: "#1a5a7a" }}>Claude · Gemini</div></div>
                    <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 6px #4ade80" }} />
                  </div>
                </div>
                {Object.entries(AGENTS).map(([id, a]) => (
                  <div key={id} style={{ padding: "8px 10px", background: "rgba(0,0,0,0.3)", border: `1px solid ${a.color}22`, borderRadius: 8, marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "var(--jmono)", fontSize: 14, color: a.color }}>{a.icon}</span>
                      <div><div style={{ fontFamily: "var(--jmono)", fontSize: 9, color: a.color, letterSpacing: 1 }}>{id.toUpperCase()}</div><div style={{ fontSize: 9, color: "#1a4a6a" }}>{a.desc}</div></div>
                      <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 4px #4ade80" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT WORKSPACE */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #0d1e35", background: "rgba(4,8,18,0.95)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span style={{ fontFamily: "var(--jmono)", fontSize: 9, color: "#1a5a7a", letterSpacing: 2 }}>BACKEND WORKSPACE</span>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 6px #4ade80" }} />
                <span style={{ fontFamily: "var(--jmono)", fontSize: 9, color: "#4ade8077" }}>NEXUS-7 ONLINE</span>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Status grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                  {[["WEB SEARCH", "ACTIVE", "#4ade80"], ["AGENTS", "5 ONLINE", "#c084fc"], ["VOICE", voiceOn ? (keys.elevenLabs ? "ELEVEN AI" : "SYSTEM") : "OFF", voiceOn ? "#00d4ff" : "#2a4a6a"], ["VISION", "CLAUDE", "#fb923c"], ["MEMORY", pillarStats?.knowledgeCount ? `${pillarStats.knowledgeCount} FACTS` : "SYNC…", "#22d3ee"], ["ROOMS", `${rooms.length} OPEN`, "#fbbf24"]].map(([l, v, c]) => (
                    <div key={l as string} style={{ background: "rgba(0,0,0,0.4)", border: "1px solid #0d1e35", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontFamily: "var(--jmono)", fontSize: 7, color: "#1a3a5a", letterSpacing: 1, marginBottom: 4 }}>{l}</div>
                      <div style={{ fontFamily: "var(--jorb)", fontSize: 11, color: c as string }}>{v}</div>
                    </div>
                  ))}
                </div>
                {/* Terminal */}
                <div style={{ flex: 1, background: "rgba(0,0,0,0.7)", border: "1px solid #0d1e35", borderRadius: 10, overflow: "hidden", minHeight: 200 }}>
                  <div style={{ padding: "7px 12px", borderBottom: "1px solid #0d1e35", display: "flex", alignItems: "center", gap: 7 }}>
                    {["#ff4455", "#fbbf24", "#4ade80"].map((c) => <div key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />)}
                    <span style={{ fontFamily: "var(--jmono)", fontSize: 9, color: "#1a4a6a", marginLeft: 6, letterSpacing: 1 }}>NEXUS-7 TERMINAL</span>
                  </div>
                  <div style={{ height: 240, overflow: "auto", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 1 }}>
                    {backendLogs.map((l, i) => <div key={i} style={{ fontFamily: "var(--jmono)", fontSize: 10, color: l.includes("ERROR") ? "#ff6677" : l.includes("[JARVIS]") || l.includes("[AGENT") || l.includes("[ACTION]") ? "#4ade80" : "#2a5a7a", lineHeight: 1.6, wordBreak: "break-all" }}>{l}</div>)}
                  </div>
                </div>
                {/* Architecture */}
                <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #0d1e35", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a5a7a", letterSpacing: 2, marginBottom: 8 }}>NEXUS-7 ARCHITECTURE</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                    {[["PRIMARY AI", "Claude Sonnet 4.5"], ["FALLBACK", "Gemini 2.5 Flash"], ["VOICE", "ElevenLabs Daniel"], ["MEMORY", "Supabase + Local"], ["VISION", "Claude Vision"], ["ROUTING", "Gemini Flash"], ["TOOLS", "30 Integrated"], ["AGENTS", "5 Specialists"]].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", gap: 6 }}><span style={{ fontFamily: "var(--jmono)", fontSize: 8, color: "#1a4a6a", minWidth: 72 }}>{k}</span><span style={{ fontSize: 10, color: "#4a7a9a" }}>{v}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── BOTTOM NAV ── */}
        <div style={{ flexShrink: 0, background: "rgba(4,8,18,0.98)", borderTop: "1px solid #0d1e35", display: "flex", justifyContent: "center", gap: 0, paddingTop: 4, paddingBottom: "max(8px, env(safe-area-inset-bottom))", zIndex: 10 }}>
          <NavIcon icon="◉"  label="HOME"   active={view === "home"}     onClick={() => setView("home")} />
          <NavIcon icon="⟨⟩" label="CHAT"   active={view === "chat"}     onClick={() => { if (!activeRoomId) createRoom(); else setView("chat"); }} />
          {/* WAKE toggle — pulsing dot when active */}
          <button onClick={() => { setWakeActive((v) => !v); setView("home"); }} title="Toggle wake word" style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 12px", minWidth: 52, transition: "opacity 0.2s", opacity: 1 }}>
            <span style={{ fontSize: 18, lineHeight: 1, position: "relative" }}>
              {wakeActive ? "◎" : "○"}
              {wakeActive && <span style={{ position: "absolute", top: -2, right: -2, width: 6, height: 6, borderRadius: "50%", background: wakeHeard ? "#4ade80" : "#22d3ee", boxShadow: `0 0 6px ${wakeHeard ? "#4ade80" : "#22d3ee"}`, animation: "jWake 2s ease-in-out infinite", display: "block" }} />}
            </span>
            <span style={{ fontSize: 8, letterSpacing: 1.5, color: wakeActive ? "#22d3ee" : "#4a6a8a", fontFamily: "var(--jmono)" }}>WAKE</span>
            {wakeActive && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#22d3ee", boxShadow: "0 0 6px #22d3ee" }} />}
          </button>
          <NavIcon icon="⊕"  label="MEMORY" active={view === "memory"}   onClick={() => setView("memory")} />
          <NavIcon icon="⊞"  label="SYSTEM" active={view === "settings"} onClick={() => setView("settings")} />
        </div>
      </div>
    </>
  );
}
