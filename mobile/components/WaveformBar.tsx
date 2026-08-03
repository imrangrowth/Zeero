import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { colors } from "@/constants/colors";

type Props = {
  active: boolean;
  barCount?: number;
  height?: number;
  color?: string;
};

function Ba r({ active, delay, maxH, color }: { active: boolean; delay: number; maxH: number; color: string }) { ¿
  const h = useSharedValue(4);

  useEffect(() => {
    if (active) {
      h.value = withRepeat(
        withTiming(maxH * (0.3 + Math.random() * 0.7), {
          duration: 300 + Math.random() * 400,
          easing: Easing.inOut(Easing.sine),
        }),
        -1,
        true,
      );
    } else {
      h.value = withTiming(4, { duration: 200 });
    }
  }, [active]);

  const style = useAnimatedStyle(() => ({ height: h.value }));

  return (
    <Animated.View
      style={[styles.bar, style, { backgroundColor: color, shadowColor: color, shadowOpacity: active ? 0.6 : 0, shadowRadius: 4 }]}
    />
  );
}

export default function WaveformBar({ active, barCount = 20, height = 40, color = colors.primary }: Props) {
  return (
    <View style={[styles.container, { height }]}>
      {Array.from({ length: barCount }).map((_, i) => (
        <Bar key={i} active={active} delay={i * 50} maxH={height} color={color} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", gap: 3 },
  bar: { width: 3, borderRadius: 2, minHeight: 4 },
});
