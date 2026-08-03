import AsyncStorage from "@react-native-async-storage/async-storage";

const getApiBase = () => {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  return "http://localhost:5000";
};

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = getApiBase();
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(err || `HTTP ${r.status}`);
  }
  return r.json();
}

export async function apiGet<T>(path: string): Promise<T> {
  const base = getApiBase();
  const r = await fetch(`${base}${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  agent?: string;
  source?: string;
  searches?: string[];
  imageUri?: string;
};

export type Pillar = {
  identity: any;
  goals: any;
  relationships: any[];
  knowledge: any[];
};

export type IntentResult = {
  action: string;
  contact?: string;
  number?: string;
  message?: string;
  query?: string;
  destination?: string;
  task?: string;
  agent?: string;
  description?: string;
  hour?: number;
  minute?: number;
  seconds?: number;
  label?: string;
  location?: string;
  category?: string;
  title?: string;
  content?: string;
  to?: string;
  subject?: string;
  body?: string;
};

const HISTORY_KEY = "jarvis_messages_v2";
const PILLARS_KEY = "jarvis_pillars_v2";
const SETTINGS_KEY = "jarvis_settings_v1";

export async function loadMessages(): Promise<Message[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveMessages(messages: Message[]): Promise<void> {
  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-200)));
  } catch {}
}

export async function clearMessages(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HISTORY_KEY);
  } catch {}
}

export async function loadLocalPillars(): Promise<Pillar | null> {
  try {
    const raw = await AsyncStorage.getItem(PILLARS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveLocalPillars(pillars: Pillar): Promise<void> {
  try {
    await AsyncStorage.setItem(PILLARS_KEY, JSON.stringify(pillars));
  } catch {}
}

export type Settings = {
  voiceEnabled: boolean;
  alwaysListening: boolean;
  activeAgent: string;
  apiKeys: {
    anthropic: string;
    gemini: string;
    elevenlabs: string;
  };
};

const DEFAULT_SETTINGS: Settings = {
  voiceEnabled: false,
  alwaysListening: false,
  activeAgent: "jarvis",
  apiKeys: { anthropic: "", gemini: "", elevenlabs: "" },
};

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export function buildPillarContext(pillars: Pillar): string {
  const parts: string[] = [];
  if (pillars.identity) {
    const i = pillars.identity;
    const traits = [
      i.name && `Name: ${i.name}`,
      i.role && `Role: ${i.role}`,
      Array.isArray(i.values) && i.values.length && `Values: ${i.values.slice(0, 5).join(", ")}`,
    ].filter(Boolean).join(" | ");
    if (traits) parts.push(`IDENTITY — ${traits}`);
  }
  if (pillars.goals) {
    const g = pillars.goals;
    const txt = [
      g.primary_goal && `Primary: ${g.primary_goal}`,
      Array.isArray(g.secondary_goals) && g.secondary_goals.length && `Secondary: ${g.secondary_goals.slice(0, 3).join("; ")}`,
    ].filter(Boolean).join(" | ");
    if (txt) parts.push(`GOALS — ${txt}`);
  }
  if (pillars.knowledge?.length) {
    const facts = pillars.knowledge.slice(0, 10).map((k: any) => `• ${k.topic}: ${String(k.content).slice(0, 120)}`).join("\n");
    parts.push(`KNOWLEDGE:\n${facts}`);
  }
  if (!parts.length) return "";
  return `PILLAR MEMORY:\n${parts.join("\n\n")}`;
}

export const JARVIS_SYSTEM = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), the personal AI of Imran. You are calm, witty, with dry British precision. Address the user as "sir". You have 5 specialist agents and 30 tools. You learn from every interaction. Be concise and complete.`;
