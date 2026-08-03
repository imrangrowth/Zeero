import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import type { Message } from "@/lib/api";

const AGENT_COLORS: Record<string, string> = {
  developer: colors.agentDev,
  marketing: colors.agentMarketing,
  research: colors.agentResearch,
  sales: colors.agentSales,
  pm: colors.agentPm,
};

type Props = { message: Message };

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const agentColor = message.agent ? AGENT_COLORS[message.agent] || colors.primary : colors.primary;

  return (
    <View style={[styles.wrapper, isUser ? styles.wrapperUser : styles.wrapperJarvis]}>
      {!isUser && (
        <View style={[styles.avatar, { backgroundColor: agentColor + "22", borderColor: agentColor + "44" }]}>
          <Ionicons name="flash" size={12} color={agentColor} />
        </View>
      )}
      <View style={[styles.bubble, isUser ? [styles.bubbleUser] : [styles.bubbleJarvis, { borderColor: agentColor + "33" }]]}>
        {message.agent && !isUser && (
          <Text style={[styles.agentLabel, { color: agentColor }]}>
            {message.agent.toUpperCase()} AGENT
          </Text>
        )}
        {message.imageUri && (
          <Image source={{ uri: message.imageUri }} style={styles.previewImage} resizeMode="cover" />
        )}
        <Text style={[styles.text, isUser ? styles.textUser : styles.textJarvis]}>
          {message.content}
        </Text>
        {message.searches && message.searches.length > 0 && (
          <View style={styles.searches}>
            <Ionicons name="search" size={10} color={colors.muted} />
            <Text style={styles.searchText}>{message.searches.join(", ")}</Text>
          </View>
        )}
        <Text style={styles.timestamp}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {message.source && !isUser && ` · ${message.source}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flexDirection: "row", marginVertical: 4, paddingHorizontal: 12, alignItems: "flex-end" },
  wrapperUser: { justifyContent: "flex-end" },
  wrapperJarvis: { justifyContent: "flex-start" },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginBottom: 2,
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
  },
  bubbleUser: {
    backgroundColor: colors.primaryGlow,
    borderColor: colors.primary + "44",
    borderBottomRightRadius: 4,
  },
  bubbleJarvis: {
    backgroundColor: colors.surfaceElevated,
    borderBottomLeftRadius: 4,
  },
  agentLabel: {
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 1,
    marginBottom: 4,
  },
  text: { fontSize: 14, lineHeight: 21 },
  textUser: { color: colors.foreground },
  textJarvis: { color: colors.text },
  timestamp: { fontSize: 10, color: colors.muted, marginTop: 4, textAlign: "right" },
  searches: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  searchText: { fontSize: 10, color: colors.muted, flex: 1 },
  previewImage: { width: "100%", height: 180, borderRadius: 8, marginBottom: 8 },
});
