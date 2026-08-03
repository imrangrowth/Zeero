import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Text,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import ArcReactor from "@/components/ArcReactor";
import MessageBubble from "@/components/MessageBubble";
import AgentSelector from "@/components/AgentSelector";
import { apiPost, loadMessages, saveMessages, loadLocalPillars, buildPillarContext, JARVIS_SYSTEM, type Message, type IntentResult } from "@/lib/api";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function executeAction(intent: IntentResult): string | null {
  const { action } = intent;
  try {
    if (action === "call" && intent.number) { Linking.openURL(`tel:${intent.number}`); return `Calling ${intent.contact || intent.number}, sir.`; }
    if (action === "whatsapp") {
      const num = intent.number?.replace(/\D/g, "");
      Linking.openURL(`whatsapp://send?phone=${num}&text=${encodeURIComponent(intent.message || "")}`);
      return `Opening WhatsApp for ${intent.contact}, sir.`;
    }
    if (action === "sms" && intent.number) { Linking.openURL(`sms:${intent.number}?body=${encodeURIComponent(intent.message || "")}`); return `Sending SMS to ${intent.contact}, sir.`; }
    if (action === "navigate" && intent.destination) { Linking.openURL(`geo:0,0?q=${encodeURIComponent(intent.destination)}`); return `Navigating to ${intent.destination}, sir.`; }
    if (action === "search" && intent.query) { Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(intent.query)}`); return `Searching for "${intent.query}", sir.`; }
    if (action === "youtube" && intent.query) { Linking.openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(intent.query)}`); return `Opening YouTube search for "${intent.query}", sir.`; }
    if (action === "spotify" && intent.query) { Linking.openURL(`spotify:search:${encodeURIComponent(intent.query)}`); return `Playing "${intent.query}" on Spotify, sir.`; }
    if (action === "instagram") { Linking.openURL(intent.query ? `instagram://tag?name=${intent.query}` : "instagram://"); return `Opening Instagram, sir.`; }
    if (action === "uber" && intent.destination) { Linking.openURL(`uber://?action=setPickup&pickup=my_location&dropoff[formatted_address]=${encodeURIComponent(intent.destination)}`); return `Requesting Uber to ${intent.destination}, sir.`; }
    if (action === "email") { Linking.openURL(`mailto:${intent.to}?subject=${encodeURIComponent(intent.subject || "")}&body=${encodeURIComponent(intent.body || "")}`); return `Opening email to ${intent.to}, sir.`; }
    if (action === "weather") { Linking.openURL(`https://www.weather.com/weather/today/${encodeURIComponent(intent.location || "")}`); return `Checking weather${intent.location ? ` for ${intent.location}` : ""}, sir.`; }
    if (action === "telegram") { Linking.openURL(intent.contact ? `tg://resolve?domain=${intent.contact}` : "tg://"); return `Opening Telegram, sir.`; }
  } catch {}
  return null;
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [activeAgent, setActiveAgent] = useState("jarvis");
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    loadMessages().then(setMessages);
  }, []);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content || thinking) return;
    setInput("");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: Message = { id: uid(), role: "user", content, timestamp: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setThinking(true);

    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const pillars = await loadLocalPillars();
      const pillarCtx = pillars ? buildPillarContext(pillars) : "";
      const systemPrompt = pillarCtx ? `${JARVIS_SYSTEM}\n\n${pillarCtx}` : JARVIS_SYSTEM;

      let reply = "";
      let source = "gemini";
      let agent = activeAgent === "jarvis" ? undefined : activeAgent;
      let searches: string[] = [];

      const intentResult: IntentResult = await apiPost("/api/route-intent", { text: content });

      if (intentResult.action === "agent" && intentResult.agent) {
        agent = intentResult.agent;
        const res: any = await apiPost("/api/chat", {
          system: systemPrompt,
          messages: [{ role: "user", content: intentResult.task || content }],
          agent: intentResult.agent,
          useTools: false,
        });
        reply = res.reply;
        source = res.source;
      } else if (intentResult.action === "chat" || intentResult.action === "remember") {
        const useTools = /\b(search|find|look up|what is|who is|latest|news|weather|price|today)\b/i.test(content);
        const res: any = await apiPost("/api/chat", {
          system: systemPrompt,
          messages: newMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
          useTools,
          agent: activeAgent === "jarvis" ? undefined : activeAgent,
        });
        reply = res.reply;
        source = res.source;
        searches = res.searches || [];
      } else {
        const actionReply = executeAction(intentResult);
        if (actionReply) {
          reply = actionReply;
          source = "local";
        } else {
          const res: any = await apiPost("/api/chat", {
            system: systemPrompt,
            messages: [{ role: "user", content }],
            useTools: false,
          });
          reply = res.reply;
          source = res.source;
        }
      }

      const jarvisMsg: Message = { id: uid(), role: "assistant", content: reply, timestamp: Date.now(), agent, source, searches };
      const finalMessages = [...newMessages, jarvisMsg];
      setMessages(finalMessages);
      await saveMessages(finalMessages);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      const errMsg: Message = { id: uid(), role: "assistant", content: `Apologies, sir. ${e.message || "System offline."}`, timestamp: Date.now() };
      const finalMessages = [...newMessages, errMsg];
      setMessages(finalMessages);
      await saveMessages(finalMessages);
    } finally {
      setThinking(false);
    }
  }, [input, messages, thinking, activeAgent]);

  const statusLabel = thinking
    ? "PROCESSING"
    : messages.length === 0 ? "READY" : "ONLINE";

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? insets.top + 67 : insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <ArcReactor size={36} active={!thinking} listening={thinking} />
          <View>
            <Text style={styles.title}>J.A.R.V.I.S.</Text>
            <Text style={styles.subtitle}>{statusLabel} · NEXUS-7</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.dot, { backgroundColor: thinking ? colors.gold : colors.green }]} />
          <Text style={styles.dotLabel}>{messages.length} msgs</Text>
        </View>
      </View>

      <AgentSelector activeAgent={activeAgent} onSelect={setActiveAgent} />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <ArcReactor size={80} active />
            <Text style={styles.emptyTitle}>SYSTEMS ONLINE</Text>
            <Text style={styles.emptySub}>How may I assist you, sir?</Text>
            <View style={styles.suggestions}>
              {["What can you do?", "Search latest AI news", "Help me code something", "Plan my week"].map(s => (
                <TouchableOpacity key={s} style={styles.suggestion} onPress={() => sendMessage(s)}>
                  <Text style={styles.suggestionText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        }
      />

      {thinking && (
        <View style={styles.thinkingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.thinkingText}>JARVIS is thinking...</Text>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Command, sir..."
            placeholderTextColor={colors.muted}
            multiline
            maxLength={1000}
            onSubmitEditing={() => sendMessage()}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || thinking) && styles.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || thinking}
          >
            <Ionicons name="send" size={18} color={!input.trim() || thinking ? colors.muted : colors.background} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 16, fontWeight: "700" as const, color: colors.primary, letterSpacing: 2 },
  subtitle: { fontSize: 10, color: colors.muted, letterSpacing: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotLabel: { fontSize: 10, color: colors.muted },
  listContent: { paddingVertical: 12 },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700" as const, color: colors.primary, letterSpacing: 3, marginTop: 8 },
  emptySub: { fontSize: 14, color: colors.textDim },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 16, paddingHorizontal: 20 },
  suggestion: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface },
  suggestionText: { color: colors.text, fontSize: 12 },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  thinkingText: { color: colors.primary, fontSize: 12, letterSpacing: 1 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: colors.foreground, fontSize: 14, borderWidth: 1, borderColor: colors.border, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { backgroundColor: colors.border },
});
