import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from "react-native-reanimated";
import { colors } from "@/constants/colors";
import ArcReactor from "@/components/ArcReactor";
import WaveformBar from "@/components/WaveformBar";
import { apiPost, loadLocalPillars, buildPillarContext, JARVIS_SYSTEM, saveMessages, loadMessages, type Message } from "@/lib/api";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

type VoiceState = "idle" | "recording" | "processing" | "speaking";

export default function VoiceScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<VoiceState>("idle");
  const [lastInput, setLastInput] = useState("");
  const [lastReply, setLastReply] = useState("I am ready to assist you, sir. Hold the button to speak.");
  const [transcript, setTranscript] = useState("");
  const [alwaysListening, setAlwaysListening] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      setPermissionGranted(status === "granted");
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    })();
    return () => {
      soundRef.current?.unloadAsync();
      recordingRef.current?.stopAndUnloadAsync();
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (!permissionGranted) {
      Alert.alert("Microphone Permission", "Please allow microphone access to use voice mode.");
      return;
    }
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setState("recording");
      buttonScale.value = withSpring(1.15);
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
    } catch (e: any) {
      setState("idle");
      setLastReply(`Recording failed, sir: ${e.message}`);
    }
  }, [permissionGranted]);

  const stopRecording = useCallback(async () => {
    if (state !== "recording" || !recordingRef.current) return;
    buttonScale.value = withSpring(1);
    setState("processing");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      const simulatedText = "Voice transcription — speak clearly and JARVIS will respond.";
      setTranscript(simulatedText);
      setLastInput(simulatedText);

      const pillars = await loadLocalPillars();
      const pillarCtx = pillars ? buildPillarContext(pillars) : "";
      const systemPrompt = pillarCtx ? `${JARVIS_SYSTEM}\n\n${pillarCtx}` : JARVIS_SYSTEM;

      const res: any = await apiPost("/api/chat", {
        system: systemPrompt,
        messages: [{ role: "user", content: simulatedText }],
        useTools: false,
      });

      const reply = res.reply || "Anomaly detected, sir.";
      setLastReply(reply);

      const msgs = await loadMessages();
      const newMsgs = [
        ...msgs,
        { id: uid(), role: "user" as const, content: simulatedText, timestamp: Date.now() },
        { id: uid(), role: "assistant" as const, content: reply, timestamp: Date.now(), source: res.source },
      ];
      await saveMessages(newMsgs);

      setState("speaking");
      try {
        const ttsRes: any = await apiPost("/api/synthesize-speech", { text: reply.slice(0, 500) });
        if (ttsRes.audioBase64) {
          const { sound } = await Audio.Sound.createAsync(
            { uri: `data:audio/mpeg;base64,${ttsRes.audioBase64}` },
            { shouldPlay: true },
          );
          soundRef.current = sound;
          sound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded && status.didJustFinish) {
              setState("idle");
              sound.unloadAsync();
            }
          });
        } else {
          setState("idle");
        }
      } catch {
        setState("idle");
      }
    } catch (e: any) {
      setState("idle");
      setLastReply(`Apologies, sir. ${e.message}`);
    }
  }, [state]);

  const stateLabels: Record<VoiceState, string> = {
    idle: "READY",
    recording: "LISTENING",
    processing: "PROCESSING",
    speaking: "SPEAKING",
  };

  const stateColors: Record<VoiceState, string> = {
    idle: colors.primary,
    recording: colors.red,
    processing: colors.gold,
    speaking: colors.green,
  };

  const btnStyle = useAnimatedStyle(() => ({ transform: [{ scale: buttonScale.value }] }));

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? insets.top + 67 : insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>VOICE INTERFACE</Text>
        <TouchableOpacity
          style={[styles.toggleBtn, alwaysListening && styles.toggleBtnActive]}
          onPress={() => setAlwaysListening(v => !v)}
        >
          <Ionicons name={alwaysListening ? "radio" : "radio-outline"} size={16} color={alwaysListening ? colors.primary : colors.muted} />
        </TouchableOpacity>
      </View>

      <View style={styles.reactorArea}>
        <ArcReactor size={120} active={state !== "idle"} listening={state === "recording"} />
        <Text style={[styles.stateLabel, { color: stateColors[state] }]}>{stateLabels[state]}</Text>
        <WaveformBar active={state === "recording" || state === "speaking"} barCount={24} height={48} color={stateColors[state]} />
      </View>

      <ScrollView style={styles.transcriptArea} contentContainerStyle={styles.transcriptContent}>
        {lastInput !== "" && (
          <View style={styles.inputBubble}>
            <Ionicons name="person" size={12} color={colors.muted} />
            <Text style={styles.inputText}>{lastInput}</Text>
          </View>
        )}
        <View style={styles.replyBubble}>
          <Ionicons name="flash" size={12} color={colors.primary} />
          <Text style={styles.replyText}>{lastReply}</Text>
        </View>
      </ScrollView>

      <View style={[styles.buttonArea, { paddingBottom: Math.max(insets.bottom + 16, 32) }]}>
        <Text style={styles.hint}>
          {state === "idle" ? "Hold to speak" : state === "recording" ? "Release to send" : "Processing..."}
        </Text>
        <Animated.View style={btnStyle}>
          <TouchableOpacity
            style={[styles.micButton, { backgroundColor: stateColors[state] + "22", borderColor: stateColors[state] }]}
            onPressIn={startRecording}
            onPressOut={stopRecording}
            disabled={state === "processing" || state === "speaking"}
            activeOpacity={0.8}
          >
            <Ionicons
              name={state === "recording" ? "stop" : "mic"}
              size={40}
              color={stateColors[state]}
            />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 14, fontWeight: "700" as const, color: colors.primary, letterSpacing: 3 },
  toggleBtn: { padding: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  toggleBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryGlow },
  reactorArea: { alignItems: "center", paddingVertical: 40, gap: 20 },
  stateLabel: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 3 },
  transcriptArea: { flex: 1, marginHorizontal: 16 },
  transcriptContent: { gap: 12, paddingVertical: 12 },
  inputBubble: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border },
  inputText: { color: colors.textDim, fontSize: 13, flex: 1, lineHeight: 20 },
  replyBubble: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.borderBright },
  replyText: { color: colors.text, fontSize: 14, flex: 1, lineHeight: 22 },
  buttonArea: { alignItems: "center", paddingTop: 16, gap: 12 },
  hint: { fontSize: 12, color: colors.muted, letterSpacing: 1 },
  micButton: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
