import React from "react";
import { ScrollView, TouchableOpacity, Text, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";

const AGENTS = [
  { id: "jarvis", label: "JARVIS", icon: "flash" as const, color: colors.primary },
  { id: "developer", label: "DEV", icon: "code-slash" as const, color: colors.agentDev },
  { id: "marketing", label: "MARKETING", icon: "megaphone" as const, color: colors.agentMarketing },
  { id: "research", label: "RESEARCH", icon: "telescope" as const, color: colors.agentResearch },
  { id: "sales", label: "SALES", icon: "trending-up" as const, color: colors.agentSales },
  { id: "pm", label: "PM", icon: "layers" as const, color: colors.agentPm },
];

type Props = {
  activeAgent: string;
  onSelect: (agent: string) => void;
};

export default function AgentSelector({ activeAgent, onSelect }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.content}>
      {AGENTS.map((a) => {
        const isActive = activeAgent === a.id;
        return (
          <TouchableOpacity
            key={a.id}
            style={[styles.chip, isActive && { backgroundColor: a.color + "22", borderColor: a.color + "88" }]}
            onPress={() => onSelect(a.id)}
          >
            <Ionicons name={a.icon} size={12} color={isActive ? a.color : colors.muted} />
            <Text style={[styles.label, { color: isActive ? a.color : colors.muted }]}>{a.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 40 },
  content: { paddingHorizontal: 12, gap: 6, flexDirection: "row", alignItems: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: { fontSize: 10, fontWeight: "600" as const, letterSpacing: 0.5 },
});
