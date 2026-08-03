import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ScrollView, Platform, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors } from "@/constants/colors";
import { loadMessages, loadLocalPillars, clearMessages, type Message } from "@/lib/api";

type Tab = "conversations" | "knowledge" | "pillars";

export default function MemoryScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("conversations");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pillars, setPillars] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [msgs, p] = await Promise.all([loadMessages(), loadLocalPillars()]);
    setMessages(msgs);
    setPillars(p);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, []);

  const filtered = messages.filter(m =>
    !search || m.content.toLowerCase().includes(search.toLowerCase())
  );

  const knowledge = pillars?.knowledge || [];
  const filteredKnowledge = knowledge.filter((k: any) =>
    !search || k.topic?.toLowerCase().includes(search.toLowerCase()) || k.content?.toLowerCase().includes(search.toLowerCase())
  );

  const handleClearConversations = () => {
    Alert.alert("Clear All Conversations", "This will delete all stored messages, sir. Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear", style: "destructive", onPress: async () => {
          await clearMessages();
          setMessages([]);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
      },
    ]);
  };

  const TABS: { id: Tab; label: string; icon: string; count: number }[] = [
    { id: "conversations", label: "CHAT", icon: "chatbubbles", count: messages.length },
    { id: "knowledge", label: "KNOWLEDGE", icon: "book", count: knowledge.length },
    { id: "pillars", label: "PILLARS", icon: "layers", count: pillars ? 4 : 0 },
  ];

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? insets.top + 67 : insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>MEMORY CORTEX</Text>
        <TouchableOpacity onPress={load}>
          <Ionicons name="refresh" size={18} color={colors.muted} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[styles.tab, tab === t.id && styles.tabActive]}
            onPress={() => setTab(t.id)}
          >
            <Ionicons name={t.icon as any} size={14} color={tab === t.id ? colors.primary : colors.muted} />
            <Text style={[styles.tabLabel, tab === t.id && styles.tabLabelActive]}>{t.label}</Text>
            <View style={[styles.badge, tab === t.id && styles.badgeActive]}>
              <Text style={[styles.badgeText, tab === t.id && styles.badgeTextActive]}>{t.count}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={14} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search memory..."
          placeholderTextColor={colors.muted}
        />
        {search !== "" && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={16} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <>
          {tab === "conversations" && (
            <>
              <FlatList
                data={filtered.slice().reverse()}
                keyExtractor={(m) => m.id}
                renderItem={({ item }) => (
                  <View style={[styles.msgRow, item.role === "user" ? styles.msgUser : styles.msgJarvis]}>
                    <View style={styles.msgMeta}>
                      <Text style={[styles.msgRole, { color: item.role === "user" ? colors.accent : colors.primary }]}>
                        {item.role === "user" ? "YOU" : item.agent ? item.agent.toUpperCase() : "JARVIS"}
                      </Text>
                      <Text style={styles.msgTime}>{new Date(item.timestamp).toLocaleDateString()}</Text>
                    </View>
                    <Text style={styles.msgContent} numberOfLines={3}>{item.content}</Text>
                  </View>
                )}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Ionicons name="chatbubbles-outline" size={40} color={colors.mutedDim} />
                    <Text style={styles.emptyText}>No conversations stored yet, sir.</Text>
                  </View>
                }
              />
              {messages.length > 0 && (
                <TouchableOpacity style={[styles.clearBtn, { marginBottom: Math.max(insets.bottom, 16) }]} onPress={handleClearConversations}>
                  <Ionicons name="trash-outline" size={14} color={colors.red} />
                  <Text style={styles.clearText}>CLEAR MEMORY</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {tab === "knowledge" && (
            <FlatList
              data={filteredKnowledge}
              keyExtractor={(k: any, i) => k.knowledge_id || String(i)}
              renderItem={({ item }: { item: any }) => (
                <View style={styles.knowledgeRow}>
                  <View style={styles.knowledgeHeader}>
                    <View style={[styles.domainBadge, { backgroundColor: colors.accentGlow }]}>
                      <Text style={styles.domainText}>{item.domain || "GENERAL"}</Text>
                    </View>
                    <Text style={styles.knowledgeTopic} numberOfLines={1}>{item.topic}</Text>
                  </View>
                  <Text style={styles.knowledgeContent} numberOfLines={4}>{item.content}</Text>
                  {typeof item.confidence === "number" && (
                    <View style={styles.confidenceRow}>
                      <View style={[styles.confidenceBar, { width: `${item.confidence * 100}%` as any }]} />
                      <Text style={styles.confidenceText}>{Math.round(item.confidence * 100)}% confidence</Text>
                    </View>
                  )}
                </View>
              )}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="book-outline" size={40} color={colors.mutedDim} />
                  <Text style={styles.emptyText}>No knowledge stored locally yet, sir.</Text>
                </View>
              }
            />
          )}

          {tab === "pillars" && (
            <ScrollView contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom + 20, 40) }]}>
              {pillars ? (
                <>
                  <PillarCard title="IDENTITY" icon="person" color={colors.primary} data={pillars.identity} />
                  <PillarCard title="GOALS" icon="flag" color={colors.gold} data={pillars.goals} />
                  <PillarCard title="RELATIONSHIPS" icon="people" color={colors.green} data={pillars.relationships} isList />
                  <PillarCard title="KNOWLEDGE" icon="book" color={colors.accent} data={`${(pillars.knowledge || []).length} facts stored`} />
                </>
              ) : (
                <View style={styles.empty}>
                  <Ionicons name="layers-outline" size={40} color={colors.mutedDim} />
                  <Text style={styles.emptyText}>No pillar memory synced yet, sir.</Text>
                  <Text style={styles.emptySubText}>Pillar memory syncs from Supabase when online.</Text>
                </View>
              )}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

function PillarCard({ title, icon, color, data, isList }: { title: string; icon: string; color: string; data: any; isList?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isEmpty = !data || (Array.isArray(data) && data.length === 0);

  return (
    <TouchableOpacity
      style={[styles.pillarCard, { borderColor: color + "33" }]}
      onPress={() => setExpanded(v => !v)}
      activeOpacity={0.8}
    >
      <View style={styles.pillarHeader}>
        <View style={[styles.pillarIcon, { backgroundColor: color + "15" }]}>
          <Ionicons name={icon as any} size={16} color={color} />
        </View>
        <Text style={[styles.pillarTitle, { color }]}>{title}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.muted} />
      </View>
      {expanded && !isEmpty && (
        <View style={styles.pillarContent}>
          <Text style={styles.pillarData}>
            {isList ? (Array.isArray(data) ? data.map((r: any) => r.name || JSON.stringify(r)).join(", ") : JSON.stringify(data)) : (typeof data === "object" ? JSON.stringify(data, null, 2) : String(data))}
          </Text>
        </View>
      )}
      {isEmpty && <Text style={styles.pillarEmpty}>Not configured, sir.</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 14, fontWeight: "700" as const, color: colors.primary, letterSpacing: 3 },
  tabRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  tabActive: { borderColor: colors.primary, backgroundColor: colors.primaryGlow },
  tabLabel: { fontSize: 9, fontWeight: "700" as const, color: colors.muted, letterSpacing: 0.5 },
  tabLabelActive: { color: colors.primary },
  badge: { backgroundColor: colors.border, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  badgeActive: { backgroundColor: colors.primary + "30" },
  badgeText: { fontSize: 9, color: colors.muted },
  badgeTextActive: { color: colors.primary },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginBottom: 8, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.foreground, fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: 12, paddingBottom: 20 },
  msgRow: { borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1 },
  msgUser: { backgroundColor: colors.surface, borderColor: colors.border },
  msgJarvis: { backgroundColor: colors.surfaceElevated, borderColor: colors.borderBright },
  msgMeta: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  msgRole: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 1 },
  msgTime: { fontSize: 10, color: colors.muted },
  msgContent: { color: colors.text, fontSize: 13, lineHeight: 19 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { color: colors.muted, fontSize: 14 },
  emptySubText: { color: colors.mutedDim, fontSize: 12, textAlign: "center" },
  clearBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, marginHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.red + "44" },
  clearText: { color: colors.red, fontSize: 12, fontWeight: "700" as const, letterSpacing: 1 },
  knowledgeRow: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  knowledgeHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  domainBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  domainText: { fontSize: 9, fontWeight: "700" as const, color: colors.accent, letterSpacing: 0.5 },
  knowledgeTopic: { flex: 1, fontSize: 13, fontWeight: "600" as const, color: colors.foreground },
  knowledgeContent: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  confidenceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  confidenceBar: { height: 2, backgroundColor: colors.primary, borderRadius: 1 },
  confidenceText: { fontSize: 10, color: colors.muted },
  pillarCard: { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1 },
  pillarHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  pillarIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  pillarTitle: { flex: 1, fontSize: 13, fontWeight: "700" as const, letterSpacing: 1 },
  pillarContent: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  pillarData: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  pillarEmpty: { marginTop: 4, color: colors.mutedDim, fontSize: 12 },
});
