import React, { useState, useRef, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { colors } from "@/constants/colors";
import { apiPost } from "@/lib/api";
import * as FileSystem from "expo-file-system";

type AnalysisTask = "describe" | "analyze" | "ocr" | "qr";

const TASKS: { id: AnalysisTask; label: string; icon: string; color: string }[] = [
  { id: "describe", label: "DESCRIBE", icon: "eye", color: colors.primary },
  { id: "analyze", label: "ANALYZE", icon: "analytics", color: colors.accent },
  { id: "ocr", label: "READ TEXT", icon: "text", color: colors.gold },
  { id: "qr", label: "DECODE QR", icon: "qr-code", color: colors.green },
];

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [task, setTask] = useState<AnalysisTask>("describe");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const takePicture = useCallback(async () => {
    if (!cameraRef.current) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: true });
      if (photo?.uri) {
        setCapturedUri(photo.uri);
        setResult(null);
      }
    } catch (e: any) {
      Alert.alert("Camera Error", e.message);
    }
  }, []);

  const pickFromGallery = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow photo library access.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, base64: true });
    if (!result.canceled && result.assets[0]?.uri) {
      setCapturedUri(result.assets[0].uri);
      setResult(null);
    }
  }, []);

  const analyzeImage = useCallback(async () => {
    if (!capturedUri) return;
    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const base64 = await FileSystem.readAsStringAsync(capturedUri, { encoding: FileSystem.EncodingType.Base64 });
      const res: any = await apiPost("/api/analyze-image", { imageBase64: base64, mimeType: "image/jpeg", task });
      setResult(res.reply || "No analysis available, sir.");
    } catch (e: any) {
      setResult(`Analysis failed, sir: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [capturedUri, task]);

  const reset = useCallback(() => {
    setCapturedUri(null);
    setResult(null);
  }, []);

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
        <Ionicons name="camera-outline" size={60} color={colors.muted} />
        <Text style={styles.permTitle}>Camera Access Required</Text>
        <Text style={styles.permDesc}>JARVIS needs camera access to analyze your environment, sir.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>GRANT ACCESS</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? insets.top + 67 : insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>VISUAL INTERFACE</Text>
        <TouchableOpacity onPress={reset}>
          <Ionicons name="refresh" size={20} color={colors.muted} />
        </TouchableOpacity>
      </View>

      <View style={styles.taskRow}>
        {TASKS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[styles.taskChip, task === t.id && { backgroundColor: t.color + "20", borderColor: t.color + "80" }]}
            onPress={() => setTask(t.id)}
          >
            <Ionicons name={t.icon as any} size={12} color={task === t.id ? t.color : colors.muted} />
            <Text style={[styles.taskLabel, { color: task === t.id ? t.color : colors.muted }]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {capturedUri ? (
        <ScrollView style={styles.previewScroll}>
          <Image source={{ uri: capturedUri }} style={styles.preview} contentFit="contain" />
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.analyzeBtn} onPress={analyzeImage} disabled={loading}>
              {loading ? <ActivityIndicator color={colors.background} size="small" /> : (
                <><Ionicons name="flash" size={16} color={colors.background} /><Text style={styles.analyzeBtnText}>ANALYZE</Text></>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.galleryBtn} onPress={pickFromGallery}>
              <Ionicons name="images" size={18} color={colors.muted} />
            </TouchableOpacity>
          </View>
          {result && (
            <View style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <Ionicons name="flash" size={14} color={colors.primary} />
                <Text style={styles.resultLabel}>JARVIS ANALYSIS</Text>
              </View>
              <Text style={styles.resultText}>{result}</Text>
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={styles.cameraWrap}>
          <CameraView ref={cameraRef} style={styles.camera} facing={facing}>
            <View style={styles.cameraOverlay}>
              <View style={styles.cornerTL} /><View style={styles.cornerTR} />
              <View style={styles.cornerBL} /><View style={styles.cornerBR} />
            </View>
          </CameraView>
          <View style={[styles.cameraControls, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <TouchableOpacity style={styles.galleryBtnCamera} onPress={pickFromGallery}>
              <Ionicons name="images-outline" size={24} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.captureBtn} onPress={takePicture}>
              <View style={styles.captureBtnInner} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.flipBtn} onPress={() => setFacing(f => f === "back" ? "front" : "back")}>
              <Ionicons name="camera-reverse-outline" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 14, fontWeight: "700" as const, color: colors.primary, letterSpacing: 3 },
  taskRow: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 10 },
  taskChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  taskLabel: { fontSize: 9, fontWeight: "700" as const, letterSpacing: 0.5 },
  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, position: "relative" },
  cornerTL: { position: "absolute", top: 20, left: 20, width: 24, height: 24, borderTopWidth: 2, borderLeftWidth: 2, borderColor: colors.primary },
  cornerTR: { position: "absolute", top: 20, right: 20, width: 24, height: 24, borderTopWidth: 2, borderRightWidth: 2, borderColor: colors.primary },
  cornerBL: { position: "absolute", bottom: 120, left: 20, width: 24, height: 24, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: colors.primary },
  cornerBR: { position: "absolute", bottom: 120, right: 20, width: 24, height: 24, borderBottomWidth: 2, borderRightWidth: 2, borderColor: colors.primary },
  cameraControls: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", padding: 20, backgroundColor: "rgba(0,0,0,0.6)" },
  captureBtn: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
  captureBtnInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.foreground },
  galleryBtnCamera: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center" },
  flipBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center" },
  previewScroll: { flex: 1 },
  preview: { width: "100%", height: 300 },
  actionRow: { flexDirection: "row", gap: 10, padding: 12 },
  analyzeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14 },
  analyzeBtnText: { color: colors.background, fontWeight: "700" as const, fontSize: 14, letterSpacing: 1 },
  galleryBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  resultCard: { margin: 12, backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.borderBright, marginBottom: 40 },
  resultHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  resultLabel: { fontSize: 11, fontWeight: "700" as const, color: colors.primary, letterSpacing: 1 },
  resultText: { color: colors.text, fontSize: 14, lineHeight: 22 },
  permTitle: { fontSize: 18, fontWeight: "700" as const, color: colors.foreground },
  permDesc: { fontSize: 14, color: colors.muted, textAlign: "center" },
  permBtn: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  permBtnText: { color: colors.background, fontWeight: "700" as const, letterSpacing: 1 },
});
