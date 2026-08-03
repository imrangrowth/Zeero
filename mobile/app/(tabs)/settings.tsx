import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Switch, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors } from "@/constants/colors";
import { loadSettings, saveSettings, type Settings } from "@/lib/api";

const TOOLS = [
  { name: "Google Search", category: "Research", icon: "search" },
  { name: "Wikipedia", category: "Research", icon: "book" },
  { name: "News API", category: "Research", icon: "newspaper" },
  { name: "Web Search (Claude)", category: "Research", icon: "globe" },
  { name: "GitHub", category: "Deployment", icon: "logo-github" },
  { name: "ElevenLabs TTS", category: "Voice", icon: "mic" },
  { name: "Supabase", category: "Storage", icon: "server" },
  { name: "Google Maps", category: "Navigation", icon: "map" },
  { name: "WhatsApp", category: "Communication", icon: "logo-whatsapp" },
  { name: "Telegram", category: "Communication", icon: "send" },
  { name: "Spotify", category: "Media", icon: "musical-notes" },
  { name: "Uber", category: "Transport", icon: "car" },
  { name: "YouTube", category: "Media", icon: "logo-youtube" },
  { name: "Camera Analysis", category: "Vision", icon: "camera" },
  { name: "Intent Router (Gemini)", category: "AI", icon: "flash" },
  { name: "Anthropic Claude", category: "AI", icon: "sparkles" },
  { name: "Google Gemini", category: "AI", icon: "diamond" },
];

const AGENTS = [
  { id: "developer", label: "Developer Agent", desc: "Full-stack, architecture, code review", color: colors.agentDev, icon: "code-slash" },
  { id: "marketing", label: "Marketing Agent", desc: "Campaigns, copy, brand strategy", color: colors.agentMarketing, icon: "megaphone" },
  { id: "research", label: "Research Agent", desc: "Synthesis, analysis, intelligence", color: colors.agentResearch, icon: "telescope" },
  { id: "sales", label: "Sales Agent", desc: "Proposals, CRM, negotiation", color: colors.agentSales, icon: "trending-up" },
  { id: "pm", label: "PM Agent", desc: "Planning, sprints, delivery", color: colors.agentPm, icon: "layers" },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { loadSettings().then(setSettings); }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    setSettings(updated);
    await saveSettings(updated);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [settings]);

  const updateKey = useCallback(async (key: keyof Settings["apiKeys"], value: string) => {
    if (!settings) return;
    const updated = { ...settings, apiKeys: { ...settings.apiKeys, [key]: value } };
    setSettings(updated);
    await saveSettings(updated);
  }, [settings]);

  if (!settings) return null;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: Platform.OS === "web" ? insets.top + 67 : insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 20, 40) }]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>CONTROL CENTRE</Text>
      </View>

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: colors.green }]} />
          <Text style={styles.statusLabel}>NEXUS-7 ONLINE</Text>
        </View>
        <Text style={styles.statusSub}>5 agents · 17+ tools · NEXUS-7 architecture</Text>
      </View>

      <Section title="VOICE" expanded={expanded === "voice"} onToggle={() => setExpanded(expanded === "voice" ? null : "voice")}>
        <Row label="Voice Responses" desc="JARVIS speaks via ElevenLabs">
          <Switch value={settings.voiceEnabled} onValueChange={(v) => update({ voiceEnabled: v })} trackColor={{ true: colors.primary }} thumbColor={settings.voiceEnabled ? colors.primary : colors.muted} />
        </Row>
        <Row label="Always Listening" desc="Wake word detection (experimental)">
          <Switch value={settings.alwaysListening} onValueChange={(v) => update({ alwaysListening: v })} trackColor={{ true: colors.primary }} thumbColor={settings.alwaysListening ? colors.primary : colors.muted} />
        </Row>
      </Section>

      <Section title="API KEYS" expanded={expanded === "keys"} onToggle={() => setExpanded(expanded === "keys" ? null : "keys")}>
        <Text style={styles.keyNote}>Keys are stored locally on your device, sir. Never leave the phone.</Text>
        <KeyInput label="Anthropic (Claude)" value={settings.apiKeys.anthropic} onChange={(v) => updateKey("anthropic", v)} placeholder="sk-ant-..." />
        <KeyInput label="Google Gemini" value={settings.apiKeys.gemini} onChange={(v) => updateKey("gemini", v)} placeholder="AIza..." />
        <KeyInput label="ElevenLabs" value={settings.apiKeys.elevenlabs} onChange={(v) => updateKey("elevenlabs", v)} placeholder="your-key..." />
      </Section>

      <Section title="AI AGENTS" expanded={expanded === "agents"} onToggle={() => setExpanded(expanded === "agents" ? null : "agents")}>
        {AGENTS.map(a => (
          <View key={a.id} style={styles.agentRow}>
            <View style={[styles.agentIcon, { backgroundColor: a.color + "15" }]}>
              <Ionicons name={a.icon as any} size={16} color={a.color} />
            </View>
            <View style={styles.agentInfo}>
              <Text style={[styles.agentLabel, { color: a.color }]}>{a.label}</Text>
              <Text style={styles.agentDesc}>{a.desc}</Text>
            </View>
            <View style={[styles.onlineDot, { backgroundColor: colors.green }]} />
          </View>
        ))}
      </Section>

      <Section title="TOOLS" expanded={expanded === "tools"} onToggle={() => setExpanded(expanded === "tools" ? null : "tools")}>
        {TOOLS.map(t => (
          <View key={t.name} style={styles.toolRow}>
            <Ionicons name={t.icon as any} size={14} color={colors.primary} />
            <View style={styles.toolInfo}>
              <Text style={styles.toolName}>{t.name}</Text>
              <Text style={styles.toolCategory}>{t.category}</Text>
            </View>
            <View style={[styles.activeBadge]}>
              <Text style={styles.activeText}>ACTIVE</Text>
            </View>
          </View>
        ))}
      </Section>

      <Section title="ABOUT JARVIS" expanded={expanded === "about"} onToggle={() => setExpanded(expanded === "about" ? null : "about")}>
        <InfoRow label="Architecture" value="NEXUS-7" />
        <InfoRow label="AI Agents" value="5 (Claude, Gemini, Grok, DeepSeek, Lovable)" />
        <InfoRow label="Tools" value="30 integrated tools" />
        <InfoRow label="Memory" value="Supabase + Local AsyncStorage" />
        <InfoRow label="Voice" value="ElevenLabs Daniel (British)" />
        <InfoRow label="Vision" value="Anthropic Claude Vision" />
        <InfoRow label="Version" value="JARVIS v2.0 — NEXUS-7" />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children, expanded, onToggle }: { title: string; children: React.ReactNode; expanded: boolean; onToggle: () => void }) {
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.muted} />
      </TouchableOpacity>
      {expanded && <View style={styles.sectionContent}>{children}</View>}
    </View>
  );
}

function Row({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDesc}>{desc}</Text>
      </View>
      {children}
    </View>
  );
}

function KeyInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={styles.keyRow}>
      <Text style={styles.keyLabel}>{label}</Text>
      <TextInput
        style={styles.keyInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedDim}
        secureTextEntry
        autoCapitalize="none"
      />
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16 },
  header: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 16 },
  title: { fontSize: 14, fontWeight: "700" as const, color: colors.primary, letterSpacing: 3 },
  statusCard: { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.primary + "33" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 13, fontWeight: "700" as const, color: colors.foreground, letterSpacing: 1 },
  statusSub: { fontSize: 12, color: colors.muted },
  section: { backgroundColor: colors.surface, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
  sectionTitle: { fontSize: 11, fontWeight: "700" as const, color: colors.muted, letterSpacing: 2 },
  sectionContent: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowInfo: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 14, color: colors.foreground, fontWeight: "500" as const },
  rowDesc: { fontSize: 12, color: colors.muted, marginTop: 2 },
  keyNote: { fontSize: 12, color: colors.gold, marginBottom: 8 },
  keyRow: { gap: 4 },
  keyLabel: { fontSize: 12, color: colors.muted, letterSpacing: 0.5 },
  keyInput: { backgroundColor: colors.surfaceElevated, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: colors.foreground, fontSize: 13, borderWidth: 1, borderColor: colors.border },
  agentRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  agentIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  agentInfo: { flex: 1 },
  agentLabel: { fontSize: 13, fontWeight: "600" as const },
  agentDesc: { fontSize: 11, color: colors.muted, marginTop: 1 },
  onlineDot: { width: 6, height: 6, borderRadius: 3 },
  toolRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  toolInfo: { flex: 1 },
  toolName: { fontSize: 13, color: colors.foreground },
  toolCategory: { fontSize: 10, color: colors.muted },
  activeBadge: { backgroundColor: colors.green + "20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  activeText: { fontSize: 9, color: colors.green, fontWeight: "700" as const },
  infoRow: { flexDirection: "row", justifyContent: "space-between" },
  infoLabel: { fontSize: 12, color: colors.muted },
  infoValue: { fontSize: 12, color: colors.text, flex: 1, textAlign: "right" },
});
