import React, { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { colors } from "@/constants/colors";

type Props = {
  size?: number;
  active?: boolean;
  listening?: boolean;
};

export default function ArcReactor({ size = 80, active = true, listening = false }: Props) {
  const rotation = useSharedValue(0);
  const pulse = useSharedValue(0);
  const outerRotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 4000, easing: Easing.linear }),
      -1,
      false,
    );
    outerRotation.value = withRepeat(
      withTiming(-360, { duration: 6000, easing: Easing.linear }),
      -1,
      false,
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: listening ? 600 : 2000, easing: Easing.inOut(Easing.sine) }),
      -1,
      true,
    );
  }, [listening]);

  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${outerRotation.value}deg` }],
  }));

  const glowStyle = useAnimatedStyle(() => {
    const scale = interpolate(pulse.value, [0, 1], [0.9, 1.12]);
    const opacity = interpolate(pulse.value, [0, 1], [0.4, listening ? 1.0 : 0.7]);
    return { transform: [{ scale }], opacity };
  });

  const coreStyle = useAnimatedStyle(() => {
    const opacity = interpolate(pulse.value, [0, 1], [0.7, 1.0]);
    return { opacity };
  });

  const half = size / 2;
  const core = size * 0.22;
  const ring1 = size * 0.38;
  const ring2 = size * 0.46;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Animated.View style={[styles.glow, glowStyle, {
        width: size * 1.3,
        height: size * 1.3,
        borderRadius: size * 0.65,
        top: -(size * 0.15),
        left: -(size * 0.15),
        backgroundColor: listening ? colors.primaryGlowStrong : colors.primaryGlow,
      }]} />

      <Animated.View style={[styles.ring, outerStyle, {
        width: size,
        height: size,
        borderRadius: half,
        borderColor: active ? colors.primary : colors.muted,
        borderWidth: 1,
        borderStyle: "dashed",
        opacity: 0.5,
      }]} />

      <Animated.View style={[styles.ring, innerStyle, {
        width: size * 0.76,
        height: size * 0.76,
        borderRadius: size * 0.38,
        top: size * 0.12,
        left: size * 0.12,
        borderColor: active ? colors.accent : colors.mutedDim,
        borderWidth: 1.5,
        opacity: 0.8,
      }]}>
        <View style={{
          position: "absolute",
          top: 0,
          left: ring1 - 2,
          width: 4,
          height: 6,
          backgroundColor: active ? colors.primary : colors.muted,
          borderRadius: 2,
        }} />
        <View style={{
          position: "absolute",
          bottom: 0,
          left: ring1 - 2,
          width: 4,
          height: 6,
          backgroundColor: active ? colors.primary : colors.muted,
          borderRadius: 2,
        }} />
        <View style={{
          position: "absolute",
          left: 0,
          top: ring1 - 2,
          width: 6,
          height: 4,
          backgroundColor: active ? colors.primary : colors.muted,
          borderRadius: 2,
        }} />
        <View style={{
          position: "absolute",
          right: 0,
          top: ring1 - 2,
          width: 6,
          height: 4,
          backgroundColor: active ? colors.primary : colors.muted,
          borderRadius: 2,
        }} />
      </Animated.View>

      <Animated.View style={[styles.core, coreStyle, {
        width: core * 2,
        height: core * 2,
        borderRadius: core,
        top: half - core,
        left: half - core,
        backgroundColor: active ? colors.primary : colors.mutedDim,
        shadowColor: active ? colors.primary : "transparent",
        shadowOpacity: 0.9,
        shadowRadius: core,
        elevation: 10,
      }]}>
        <View style={{
          width: core * 0.5,
          height: core * 0.5,
          borderRadius: core * 0.25,
          backgroundColor: "#fff",
          opacity: 0.9,
        }} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "relative", alignItems: "center", justifyContent: "center" },
  glow: { position: "absolute", opacity: 0.5 },
  ring: { position: "absolute", alignItems: "center", justifyContent: "center" },
  core: { position: "absolute", alignItems: "center", justifyContent: "center" },
});
