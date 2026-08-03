import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";

type Props = {
  icon: string;
  label: string;
  description: string;
  color: string;
  onPress: () => void;
};

export default function ActionCard({ icon, label, description, color, onPress }: Props) {
  return (
    <TouchableOpacity style={[styles.card, { borderColor: color + "33" }]} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.iconWrap, { backgroundColor: color + "15" }]}>
        <Ionicons name={icon as any} size={22} color={color} />
      </View>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.desc} numberOfLines={1}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.muted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceElevated,
    borderRadius: colors.radius,
    padding: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  iconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  text: { flex: 1 },
  label: { color: colors.foreground, fontSize: 14, fontWeight: "600" as const },
  desc: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
