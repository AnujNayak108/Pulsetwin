"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  FileText,
  HeartPulse,
  LayoutDashboard,
  Menu,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
  Watch,
  X,
} from "lucide-react";
import { jsPDF } from "jspdf";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Patient = {
  id: string;
  name: string;
  age: number;
  gender: string;
  bmi: number;
  baseline_hba1c: number;
  history: string[];
  medications: string[];
  risk_category: string;
};

type Prediction = {
  score: number;
  level: string;
  alert: boolean;
  interpretation_note: string;
  forecast?: GlucoseForecast;
  components?: {
    glucose: number;
    short_term_trend: number;
    baseline_hba1c: number;
    bmi: number;
    heart_rate: number;
  };
};

type GlucoseForecast = {
  horizon_minutes: number;
  interval_minutes: number;
  threshold_mg_dl: number;
  samples_used: number;
  lookback_minutes: number;
  projected_glucose_mg_dl: number | null;
  slope_mg_dl_per_hour: number | null;
  estimated_minutes_to_threshold: number | null;
  event_within_horizon: boolean | null;
  event_state: string;
  contextual_index: number | null;
  contextual_level: string | null;
  model_type: string;
  clinically_validated: boolean;
  interpretation_note: string;
};

type Reading = {
  timestamp: string;
  glucose: number;
  heart_rate: number;
  prediction: Prediction;
  scenario_phase?: string;
};

type DemoComponents = {
  glucose: number;
  short_term_trend: number;
  baseline_hba1c: number;
  bmi: number;
  heart_rate: number;
};

type CounterfactualReading = {
  sample: number;
  elapsed_minutes: number;
  glucose: number;
  heart_rate: number;
  prediction: Prediction;
};

type CounterfactualScenario = {
  id: string;
  label: string;
  readings: CounterfactualReading[];
  summary: {
    mean_index: number;
    final_index: number;
    final_level: string;
    final_components: DemoComponents;
    final_forecast: GlucoseForecast;
  };
};

type CounterfactualResult = {
  data_notice: string;
  model_type: string;
  clinically_validated: boolean;
  seed: number;
  sample_count: number;
  interval_minutes: number;
  controlled_factors: string[];
  changed_factor: string;
  interpretation_note: string;
  scenarios: [CounterfactualScenario, CounterfactualScenario];
  comparison: {
    mean_index_delta: number;
    final_index_delta: number;
    final_component_deltas: DemoComponents;
  };
};

const guidedScenario = Array.from({ length: 32 }, (_, index) => {
  if (index < 6) {
    return {
      phase: "Baseline",
      glucose: [111, 112, 110, 113, 111, 112][index],
      heartRate: [71, 72, 70, 72, 71, 73][index],
    };
  }
  if (index < 16) {
    const step = index - 5;
    return {
      phase: "Rising signal",
      glucose: 112 + step * 14,
      heartRate: 73 + step * 2,
    };
  }
  if (index < 21) {
    const step = index - 16;
    return {
      phase: "Elevated signal",
      glucose: 222 - step * 2,
      heartRate: 93 - step,
    };
  }
  const step = index - 20;
  return {
    phase: "Recovery",
    glucose: 212 - step * 9,
    heartRate: 88 - step * 1.5,
  };
});

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SIMULATION_INTERVAL_MINUTES = 5;
const FORECAST_HORIZON_MINUTES = 120;
const GLUCOSE_EXCURSION_THRESHOLD = 180;
const initialPatient: Patient = {
  id: "DEMO-10023",
  name: "Aarav Mehta",
  age: 52,
  gender: "Male",
  bmi: 28.5,
  baseline_hba1c: 7.2,
  history: ["Type 2 diabetes", "Hypertension"],
  medications: ["Metformin 500 mg"],
  risk_category: "Moderate",
};

function makeReading(
  glucose: number,
  heartRate: number,
  time: Date,
  profile: Patient = initialPatient,
  previousGlucose?: number,
  scenarioPhase?: string,
): Reading {
  const components = {
    glucose: Math.min(Math.max(glucose - 110, 0) / 140, 1) * 0.45,
    short_term_trend: previousGlucose === undefined
      ? 0
      : Math.min(Math.max(glucose - previousGlucose, 0) / 20, 1) * 0.25,
    baseline_hba1c: Math.min(Math.max(profile.baseline_hba1c - 5.7, 0) / 3.3, 1) * 0.25,
    bmi: Math.min(Math.max(profile.bmi - 25, 0) / 15, 1) * 0.1,
    heart_rate: Math.min(Math.max(heartRate - 90, 0) / 60, 1) * 0.1,
  };
  const score = Math.min(1, Object.values(components).reduce((total, component) => total + component, 0));
  const level = score >= 0.65 ? "High" : score >= 0.35 ? "Moderate" : "Low";
  return {
    timestamp: time.toISOString(),
    glucose: Math.round(glucose),
    heart_rate: Math.round(heartRate),
    prediction: {
      score: Number(score.toFixed(2)),
      level,
      alert: level === "High",
      interpretation_note: "Demonstration-only heuristic output; not medical advice.",
      components: {
        glucose: Number(components.glucose.toFixed(3)),
        short_term_trend: Number(components.short_term_trend.toFixed(3)),
        baseline_hba1c: Number(components.baseline_hba1c.toFixed(3)),
        bmi: Number(components.bmi.toFixed(3)),
        heart_rate: Number(components.heart_rate.toFixed(3)),
      },
    },
    ...(scenarioPhase ? { scenario_phase: scenarioPhase } : {}),
  };
}

function estimateGlucoseForecast(readings: Reading[], profile: Patient): GlucoseForecast {
  const history = readings.slice(-12).map((reading) => reading.glucose);
  const samplesUsed = history.length;
  const lookbackMinutes = Math.max(0, samplesUsed - 1) * SIMULATION_INTERVAL_MINUTES;
  const forecast: GlucoseForecast = {
    horizon_minutes: FORECAST_HORIZON_MINUTES,
    interval_minutes: SIMULATION_INTERVAL_MINUTES,
    threshold_mg_dl: GLUCOSE_EXCURSION_THRESHOLD,
    samples_used: samplesUsed,
    lookback_minutes: lookbackMinutes,
    projected_glucose_mg_dl: null,
    slope_mg_dl_per_hour: null,
    estimated_minutes_to_threshold: null,
    event_within_horizon: null,
    event_state: "collecting_history",
    contextual_index: null,
    contextual_level: null,
    model_type: "linear_trend_extrapolation_demo",
    clinically_validated: false,
    interpretation_note: "Synthetic five-minute samples are linearly extrapolated; not a clinical alert or medical advice.",
  };
  if (samplesUsed < 3) return forecast;

  const xValues = history.map((_, index) => index * SIMULATION_INTERVAL_MINUTES);
  const meanX = xValues.reduce((total, value) => total + value, 0) / samplesUsed;
  const meanGlucose = history.reduce((total, value) => total + value, 0) / samplesUsed;
  const denominator = xValues.reduce((total, value) => total + (value - meanX) ** 2, 0);
  const slopePerMinute = xValues.reduce(
    (total, value, index) => total + (value - meanX) * (history[index] - meanGlucose),
    0,
  ) / denominator;
  const currentGlucose = history[history.length - 1];
  const projectedGlucose = currentGlucose + slopePerMinute * FORECAST_HORIZON_MINUTES;
  const minutesToThreshold = currentGlucose < GLUCOSE_EXCURSION_THRESHOLD && slopePerMinute > 0
    ? (GLUCOSE_EXCURSION_THRESHOLD - currentGlucose) / slopePerMinute
    : null;
  const eventWithinHorizon = minutesToThreshold !== null && minutesToThreshold <= FORECAST_HORIZON_MINUTES;
  const eventState = currentGlucose >= GLUCOSE_EXCURSION_THRESHOLD
    ? "already_above_demo_threshold"
    : eventWithinHorizon
      ? "projected_within_horizon"
      : "not_projected_within_horizon";

  const glucoseComponent = Math.min(Math.max(projectedGlucose - 110, 0) / 140, 1) * 0.45;
  const hba1cComponent = Math.min(Math.max(profile.baseline_hba1c - 5.7, 0) / 3.3, 1) * 0.25;
  const bmiComponent = Math.min(Math.max(profile.bmi - 25, 0) / 15, 1) * 0.1;
  const heartRate = readings[readings.length - 1].heart_rate;
  const heartRateComponent = Math.min(Math.max(heartRate - 90, 0) / 60, 1) * 0.1;
  const contextualIndex = Math.min(
    1,
    glucoseComponent + hba1cComponent + bmiComponent + heartRateComponent,
  );

  return {
    ...forecast,
    projected_glucose_mg_dl: Number(projectedGlucose.toFixed(1)),
    slope_mg_dl_per_hour: Number((slopePerMinute * 60).toFixed(2)),
    estimated_minutes_to_threshold: minutesToThreshold === null
      ? null
      : Number(minutesToThreshold.toFixed(1)),
    event_within_horizon: eventWithinHorizon,
    event_state: eventState,
    contextual_index: Number(contextualIndex.toFixed(2)),
    contextual_level: contextualIndex >= 0.65 ? "High" : contextualIndex >= 0.35 ? "Moderate" : "Low",
  };
}

function nextSimulationTimestamp(readings: Reading[]): Date {
  const latestReading = readings[readings.length - 1];
  return latestReading
    ? new Date(Date.parse(latestReading.timestamp) + SIMULATION_INTERVAL_MINUTES * 60_000)
    : new Date();
}

function seedReadings(now = Date.now()): Reading[] {
  return Array.from({ length: 24 }, (_, index) => {
    const drift = index > 15 ? (index - 15) * 1.6 : 0;
    const glucose = 112 + Math.sin(index * 0.7) * 9 + drift;
    const previousDrift = index > 16 ? (index - 16) * 1.6 : 0;
    const previousGlucose = index === 0
      ? undefined
      : 112 + Math.sin((index - 1) * 0.7) * 9 + previousDrift;
    return makeReading(
      glucose,
      72 + Math.sin(index * 0.52) * 5,
      new Date(now - (23 - index) * 5 * 60_000),
      initialPatient,
      previousGlucose,
    );
  });
}

function formatTime(timestamp: string, showSeconds = false) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" as const } : {}),
    timeZone: "Asia/Kolkata",
  }).format(new Date(timestamp));
}

function sparklineHeight(value: number, minimum: number, maximum: number) {
  return `${Math.max(12, Math.min(100, ((value - minimum) / (maximum - minimum)) * 100))}%`;
}

export default function Home() {
  const [patient, setPatient] = useState<Patient>(initialPatient);
  const [profileSource, setProfileSource] = useState<"backend" | "local">("local");
  const [readings, setReadings] = useState<Reading[]>(() => seedReadings(0));
  const [streaming, setStreaming] = useState(false);
  const [streamSource, setStreamSource] = useState<"idle" | "connecting" | "backend" | "local">("idle");
  const [replayStatus, setReplayStatus] = useState<"idle" | "playing" | "complete">("idle");
  const [replayIndex, setReplayIndex] = useState(0);
  const [counterfactual, setCounterfactual] = useState<CounterfactualResult | null>(null);
  const [counterfactualLoading, setCounterfactualLoading] = useState(false);
  const [counterfactualError, setCounterfactualError] = useState("");
  const [anomaly, setAnomaly] = useState(false);
  const [notice, setNotice] = useState("Synthetic patient data · educational prototype only");
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const anomalyRef = useRef(false);
  const replayIndexRef = useRef(0);
  const replayPhase = guidedScenario[Math.max(0, Math.min(replayIndex - 1, guidedScenario.length - 1))].phase;

  const latest = readings[readings.length - 1];
  const previous = readings[readings.length - 2];
  const glucoseChange = latest.glucose - (previous?.glucose ?? latest.glucose);
  const risk = latest.prediction;
  const forecast = latest.prediction.forecast ?? estimateGlucoseForecast(readings, patient);
  const forecastChartData = forecast.projected_glucose_mg_dl === null
    ? readings.map((reading) => ({ ...reading, forecast_glucose: null }))
    : [
        ...readings.map((reading, index) => ({
          ...reading,
          forecast_glucose: index === readings.length - 1 ? latest.glucose : null,
        })),
        {
          timestamp: new Date(
            Date.parse(latest.timestamp) + forecast.horizon_minutes * 60_000,
          ).toISOString(),
          glucose: null,
          forecast_glucose: forecast.projected_glucose_mg_dl,
        },
      ];
  const riskContributions = risk.components
    ? [
        { label: "Glucose", value: risk.components.glucose, maximum: 0.45 },
        { label: "Short-term change", value: risk.components.short_term_trend, maximum: 0.25 },
        { label: "HbA1c baseline", value: risk.components.baseline_hba1c, maximum: 0.25 },
        { label: "BMI", value: risk.components.bmi, maximum: 0.1 },
        { label: "Heart rate", value: risk.components.heart_rate, maximum: 0.1 },
      ]
    : [];

  useEffect(() => {
    const timer = window.setTimeout(() => setReadings(seedReadings()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/patient`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Patient API returned ${response.status}`);
        return response.json() as Promise<Patient>;
      })
      .then((data) => {
        setPatient(data);
        setProfileSource("backend");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") {
          setProfileSource("local");
          setNotice("Backend not connected · showing a local synthetic patient demo");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [helpOpen]);

  useEffect(() => {
    if (replayStatus !== "playing") return;
    const timer = window.setInterval(() => {
      const index = replayIndexRef.current;
      const point = guidedScenario[index];
      if (!point) {
        setReplayStatus("complete");
        setNotice("Guided replay complete · synthetic scenario only");
        return;
      }

      const previousPoint = guidedScenario[index - 1];
      setReadings((current) => [
        ...current.slice(-47),
        makeReading(
          point.glucose,
          point.heartRate,
          nextSimulationTimestamp(current),
          patient,
          previousPoint?.glucose,
          point.phase,
        ),
      ]);
      replayIndexRef.current = index + 1;
      setReplayIndex(index + 1);

      const previousPhase = previousPoint?.phase;
      if (point.phase !== previousPhase) {
        setNotice(`Guided replay · ${point.phase.toLowerCase()} phase · illustrative synthetic scenario`);
      }
      if (index === guidedScenario.length - 1) {
        setReplayStatus("complete");
        setNotice("Guided replay complete · synthetic scenario only");
      }
    }, 900);
    return () => window.clearInterval(timer);
  }, [patient, replayStatus]);

  const appendReading = useCallback((reading: Reading) => {
    setReadings((current) => [...current.slice(-47), reading]);
  }, []);

  useEffect(() => {
    if (!streaming) return;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    let manuallyClosed = false;
    let fallbackStarted = false;
    const socket = new WebSocket(`${API_BASE.replace(/^http/, "ws")}/ws/stream`);

    const startLocalDemo = () => {
      if (fallbackStarted || manuallyClosed) return;
      fallbackStarted = true;
      setStreamSource("local");
      setNotice("Local synthetic stream · backend unavailable");
      socket.close();
      fallbackTimer = setInterval(() => {
        setReadings((current) => {
          const previousReading = current[current.length - 1];
          const baseline = previousReading?.glucose ?? 112;
          const rawGlucose = anomalyRef.current
            ? baseline + 4 + Math.random() * 3
            : baseline + (Math.random() - 0.55) * 4;
          const rawHeartRate = (previousReading?.heart_rate ?? 72) + (Math.random() - 0.5) * 3;
          const glucose = Math.max(70, Math.min(300, rawGlucose));
          const heartRate = Math.max(50, Math.min(150, rawHeartRate));
          return [
            ...current.slice(-47),
            makeReading(glucose, heartRate, nextSimulationTimestamp(current), patient, baseline),
          ];
        });
      }, 1_500);
    };

    const connectionTimer = setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) startLocalDemo();
    }, 2_500);
    socket.onopen = () => {
      if (fallbackStarted) {
        socket.close();
        return;
      }
      clearTimeout(connectionTimer);
      setStreamSource("backend");
      setNotice("Connected to the synthetic wearable stream");
    };
    socket.onmessage = (event) => {
      const reading = JSON.parse(event.data) as Reading;
      appendReading(reading);
    };
    socket.onerror = () => startLocalDemo();
    socket.onclose = () => {
      if (!manuallyClosed && streaming) startLocalDemo();
    };

    return () => {
      manuallyClosed = true;
      clearTimeout(connectionTimer);
      if (fallbackTimer) clearInterval(fallbackTimer);
      socket.close();
    };
  }, [appendReading, patient, streaming]);

  const setStream = (enabled: boolean) => {
    if (enabled) {
      replayIndexRef.current = 0;
      setReplayIndex(0);
      setReplayStatus("idle");
    }
    setStreaming(enabled);
    setStreamSource(enabled ? "connecting" : "idle");
    if (!enabled) {
      setNotice("Stream paused · latest readings retained");
      if (anomalyRef.current) void updateAnomaly(false, true);
    }
  };

  const updateAnomaly = async (enabled: boolean, streamPaused = false, noticeOverride?: string) => {
    anomalyRef.current = enabled;
    setAnomaly(enabled);
    try {
      const response = await fetch(`${API_BASE}/api/inject-anomaly`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inject: enabled }),
      });
      if (!response.ok) throw new Error(`Anomaly API returned ${response.status}`);
      setNotice(noticeOverride ?? (
        enabled
          ? "Synthetic excursion injected into the demo stream"
          : streaming
            ? streamPaused
              ? "Stream paused · excursion simulation stopped"
              : "Excursion simulation stopped"
            : "Stream paused · excursion simulation stopped"
      ));
    } catch (error) {
      if (error instanceof Error) {
        setNotice(noticeOverride
          ? `${noticeOverride} · backend could not be notified`
          : enabled
            ? "Local synthetic excursion enabled · backend not connected"
            : "Excursion stopped locally · backend could not be notified",
        );
      }
    }
  };

  const toggleAnomaly = () => updateAnomaly(!anomaly);

  const runCounterfactual = async () => {
    setCounterfactualLoading(true);
    setCounterfactualError("");
    try {
      const response = await fetch(`${API_BASE}/api/counterfactual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: 2026, sample_count: 12 }),
      });
      if (!response.ok) {
        throw new Error(`Counterfactual API returned ${response.status}`);
      }
      const result = await response.json() as CounterfactualResult;
      if (result.scenarios.length !== 2 || result.scenarios.some((scenario) => scenario.readings.length !== result.sample_count)) {
        throw new Error("Counterfactual API returned an incomplete scenario comparison");
      }
      setCounterfactual(result);
    } catch (error) {
      setCounterfactualError(
        error instanceof Error
          ? `Could not run the backend comparison: ${error.message}. Start the API and try again.`
          : "Could not run the backend comparison. Start the API and try again.",
      );
    } finally {
      setCounterfactualLoading(false);
    }
  };

  const startGuidedReplay = () => {
    setStreaming(false);
    setStreamSource("idle");
    if (anomalyRef.current) void updateAnomaly(false, true, "Guided replay · baseline phase");
    replayIndexRef.current = 1;
    setReplayIndex(1);
    setReplayStatus("playing");
    const firstPoint = guidedScenario[0];
    setReadings([makeReading(firstPoint.glucose, firstPoint.heartRate, new Date(), patient, undefined, firstPoint.phase)]);
    setNotice("Guided replay · baseline phase · illustrative synthetic scenario");
  };

  const downloadSnapshot = () => {
    const snapshot = {
      generated_at: new Date().toISOString(),
      data_notice: "Synthetic demonstration data. Not for clinical decision-making.",
      scenario: replayStatus === "idle"
        ? "Live or local synthetic stream"
        : `Guided replay: baseline, rising signal, elevated signal, recovery (${replayStatus})`,
      scenario_progress: replayStatus === "idle"
        ? undefined
        : { status: replayStatus, phase: replayPhase, step: replayIndex, total_steps: guidedScenario.length },
      patient,
      latest_reading: latest,
      glucose_excursion_forecast: forecast,
      recent_readings: readings,
      counterfactual_comparison: counterfactual,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `twin-snapshot-${patient.id.toLowerCase()}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const downloadPdfReport = () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 16;
    const pageWidth = 210;
    const contentWidth = pageWidth - margin * 2;
    let y = 18;
    const formatReportTimestamp = (timestamp: string) =>
      `${new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Kolkata",
      }).format(new Date(timestamp))} IST`;

    const addPage = () => {
      doc.addPage();
      y = 18;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(25, 122, 104);
      doc.text("PulseTwin | Synthetic demonstration snapshot", margin, y);
      y += 10;
    };
    const ensureSpace = (height: number) => {
      if (y + height > 277) addPage();
    };
    const addSection = (title: string) => {
      ensureSpace(13);
      y += 3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(29, 48, 49);
      doc.text(title, margin, y);
      y += 2;
      doc.setDrawColor(220, 230, 225);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;
    };
    const addRow = (label: string, value: string) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      const lines = doc.splitTextToSize(value, contentWidth - 48);
      const rowHeight = Math.max(6, lines.length * 4.5);
      ensureSpace(rowHeight + 1);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 115, 110);
      doc.text(label, margin, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(41, 59, 57);
      doc.text(lines, margin + 48, y);
      y += rowHeight;
    };
    const addParagraph = (text: string) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(75, 91, 86);
      const lines = doc.splitTextToSize(text, contentWidth);
      ensureSpace(lines.length * 4.5 + 2);
      doc.text(lines, margin, y);
      y += lines.length * 4.5 + 2;
    };

    doc.setFillColor(25, 92, 80);
    doc.rect(0, 0, pageWidth, 34, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text("PulseTwin | Demonstration snapshot", margin, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("Synthetic patient context and simulated wearable readings", margin, 23);
    doc.text(`Generated ${new Date().toISOString()}`, margin, 29);
    y = 43;

    doc.setFillColor(255, 244, 238);
    doc.setDrawColor(226, 153, 128);
    doc.roundedRect(margin, y - 4, contentWidth, 15, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(153, 69, 48);
    doc.text("SYNTHETIC DEMO ONLY - NOT FOR CLINICAL DECISION-MAKING", margin + 4, y + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Not a diagnosis, treatment recommendation, or validated forecast.", margin + 4, y + 7);
    y += 19;

    addSection("Patient context");
    addRow("Patient ID", patient.id);
    addRow("Name / demographics", `${patient.name} | ${patient.age} years | ${patient.gender}`);
    addRow("Conditions", patient.history.join(", ") || "None listed");
    addRow("Medications", patient.medications.join(", ") || "None listed");
    addRow("BMI / baseline HbA1c", `${patient.bmi} kg/m2 | ${patient.baseline_hba1c}%`);
    addRow("Data source", "Synthetic demonstration profile");
    addRow("Stream status", notice);
    addRow(
      "Counterfactual",
      counterfactual
        ? `Seed ${counterfactual.seed} · ${counterfactual.sample_count} samples · same synthetic profile`
        : "Not run",
    );
    addRow(
      "Scenario",
      replayStatus === "idle"
        ? "Live or local synthetic stream"
        : `Guided replay (${replayStatus}) · ${replayPhase} · step ${replayIndex} of ${guidedScenario.length}`,
    );
    addSection("Latest simulated readings");
    addRow("Sample time", formatReportTimestamp(latest.timestamp));
    addRow("Glucose", `${latest.glucose} mg/dL`);
    addRow("Heart rate", `${latest.heart_rate} bpm`);

    addSection("Two-hour synthetic glucose trend projection");
    addRow(
      "Projected glucose",
      forecast.projected_glucose_mg_dl === null
        ? "Collecting at least 3 simulated samples"
        : `${forecast.projected_glucose_mg_dl} mg/dL · ${forecast.event_state.replaceAll("_", " ")}`,
    );
    addRow(
      "Trend / contextual index",
      forecast.contextual_index === null
        ? "Not available until sufficient samples are collected"
        : `${forecast.slope_mg_dl_per_hour} mg/dL/hour · ${forecast.contextual_index.toFixed(2)} (${forecast.contextual_level}) · not a probability`,
    );
    addParagraph(
      "This linear extrapolation uses up to 12 synthetic samples spaced five simulated minutes apart. The 180 mg/dL excursion threshold is an illustrative project setting, not a clinical cutoff. This output is not validated, a probability, or medical advice."
    );

    addSection("Current-input heuristic index");
    addRow("Current index", `${Math.round(risk.score * 100)} / 100 (${risk.level})`);
    addParagraph(
      "This deterministic index combines current simulated readings and static synthetic HbA1c/BMI context. It is separate from the two-hour trend projection and is not a probability or medical advice."
    );
    if (riskContributions.length) {
      riskContributions.forEach((item) => {
        addRow(
          item.label,
          `${item.value.toFixed(3)} / ${item.maximum.toFixed(3)} maximum contribution`
        );
      });
    } else {
      addParagraph("Component contributions were not included in this reading.");
    }

    if (counterfactual) {
      const [steady, rising] = counterfactual.scenarios;
      addSection("Counterfactual scenario comparison");
      addParagraph(counterfactual.interpretation_note);
      addRow("Seed / sample count", `${counterfactual.seed} / ${counterfactual.sample_count}`);
      addRow("Steady final index", `${Math.round(steady.summary.final_index * 100)} / 100 (${steady.summary.final_level})`);
      addRow("Rising final index", `${Math.round(rising.summary.final_index * 100)} / 100 (${rising.summary.final_level})`);
      addRow("Mean index delta", `${counterfactual.comparison.mean_index_delta.toFixed(3)} (rising minus steady)`);
      addRow("Final index delta", `${counterfactual.comparison.final_index_delta.toFixed(3)} (rising minus steady)`);
      Object.entries(counterfactual.comparison.final_component_deltas).forEach(([component, delta]) => {
        addRow(`${component} delta`, delta.toFixed(3));
      });
      ensureSpace(15);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(71, 92, 84);
      doc.text("Min", margin + 2, y);
      doc.text("Steady", margin + 20, y);
      doc.text("Rising", margin + 49, y);
      doc.text("Shared HR", margin + 75, y);
      doc.text("Steady idx", margin + 111, y);
      doc.text("Rising idx", margin + 146, y);
      y += 6;
      steady.readings.forEach((reading, index) => {
        if (y + 6 > 277) {
          addPage();
          y += 2;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text("Counterfactual comparison (continued)", margin, y);
          y += 6;
        }
        const comparisonReading = rising.readings[index];
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(65, 79, 74);
        doc.text(String(reading.elapsed_minutes), margin + 2, y);
        doc.text(String(reading.glucose), margin + 20, y);
        doc.text(String(comparisonReading.glucose), margin + 49, y);
        doc.text(String(reading.heart_rate), margin + 75, y);
        doc.text(String(Math.round(reading.prediction.score * 100)), margin + 111, y);
        doc.text(String(Math.round(comparisonReading.prediction.score * 100)), margin + 146, y);
        y += 6;
      });
    }

    addSection("Recent simulated readings");
    const drawTableHeader = () => {
      doc.setFillColor(240, 246, 243);
      doc.rect(margin, y - 4, contentWidth, 7, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(71, 92, 84);
      doc.text("Time", margin + 2, y);
      doc.text("Glucose", margin + 57, y);
      doc.text("Heart rate", margin + 100, y);
      doc.text("Scenario", margin + 134, y);
      doc.text("Index", margin + 163, y);
      y += 7;
    };
    drawTableHeader();
    readings.forEach((reading) => {
      if (y + 6 > 277) {
        addPage();
        addSection("Recent simulated readings (continued)");
        drawTableHeader();
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(65, 79, 74);
      doc.text(formatReportTimestamp(reading.timestamp), margin + 2, y);
      doc.text(String(reading.glucose), margin + 57, y);
      doc.text(String(reading.heart_rate), margin + 100, y);
      doc.text(reading.scenario_phase ?? "-", margin + 134, y);
      doc.text(`${Math.round(reading.prediction.score * 100)} / ${reading.prediction.level}`, margin + 163, y);
      y += 6;
    });

    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(220, 230, 225);
      doc.line(margin, 284, pageWidth - margin, 284);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(120, 135, 130);
      doc.text("Synthetic data | Rule-based demo | Not for diagnosis or treatment", margin, 289);
      doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, 289, { align: "right" });
    }
    doc.save(`pulsetwin-demo-report-${patient.id.toLowerCase()}.pdf`);
  };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" aria-label="Pulse Twin home">
          <span className="brand-mark"><Activity size={21} strokeWidth={2.5} /></span>
          <span className="brand-type">pulse<span>twin</span><small>SYNTHETIC DATA DEMO</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><LayoutDashboard size={18} /> Overview</a>
          <a className="nav-item" href="#patient"><UserRound size={18} /> Patient profile</a>
          <a className="nav-item" href="#signals"><HeartPulse size={18} /> Live signals <span className="nav-count">2</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ShieldCheck size={19} />
            <div><strong>Privacy-first sandbox</strong><span>Synthetic data only</span></div>
            <Check size={15} className="privacy-check" />
          </div>
          <div className="sidebar-user">
            <div className="avatar avatar-small">DT</div>
            <div className="sidebar-user-copy"><strong>Demo workspace</strong><span>Research preview</span></div>
            <ChevronDown size={16} />
          </div>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation"><Menu size={20} /></button>
          <div className="breadcrumbs">Patients <span>/</span> <strong>{patient.id}</strong></div>
          <div className="topbar-actions">
            <span className="environment-pill"><span /> SYNTHETIC DEMO</span>
            <button className="icon-button" aria-label="Demo help" aria-expanded={helpOpen} onClick={() => setHelpOpen((open) => !open)}><CircleHelp size={19} /></button>
            <div className="avatar">DR</div>
          </div>
        </header>

        <div className="content" id="overview">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" /> DIGITAL TWIN MONITOR</div>
              <h1>Patient overview</h1>
              <p>Explore synthetic EHR context, wearable signals, and an explainable two-hour glucose trend projection.</p>
            </div>
            <div className="heading-buttons">
              <button className="button button-secondary" aria-label="Export JSON snapshot" onClick={downloadSnapshot}><Download size={16} /> Export JSON</button>
              <button className="button button-secondary" onClick={downloadPdfReport}><FileText size={16} /> Export PDF</button>
              <button className={`button ${streaming ? "button-stop" : "button-primary"}`} onClick={() => setStream(!streaming)}>
                {streaming ? <Pause size={15} /> : <Play size={15} />}
                {streaming ? "Pause stream" : "Start live stream"}
              </button>
            </div>
          </div>

          <section className="patient-banner" id="patient">
            <div className="patient-identity">
              <div className="avatar patient-avatar">{patient.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
              <div><div className="patient-name">{patient.name}<span className="synthetic-tag"><ShieldCheck size={12} /> SYNTHETIC</span></div>
                <div className="patient-meta">{patient.id}<span>•</span>{patient.age} yrs<span>•</span>{patient.gender}</div></div>
            </div>
            <div className="banner-divider" />
            <div className="banner-detail"><span>PRIMARY CONDITION</span><strong>{patient.history[0] ?? "Not listed"}</strong></div>
            <div className="banner-detail"><span>CARE TEAM PREVIEW</span><strong><span className="status-dot" /> Demo care team</strong></div>
            <div className="banner-detail last-detail"><span>LATEST SAMPLE</span><strong><Clock3 size={14} /> {formatTime(latest.timestamp)} IST</strong></div>
          </section>

          <div className="notice-bar"><ShieldCheck size={15} /><span>{notice}</span><span className="notice-separator">·</span><span>Not for diagnosis or treatment</span></div>

          <section className="metrics-grid" aria-label="Current patient metrics">
            <article className="metric-card">
              <div className="metric-top"><span>GLUCOSE</span><span className="metric-icon coral"><Activity size={17} /></span></div>
              <div className="metric-value">{latest.glucose}<span className="metric-unit">mg/dL</span></div>
              <div className="metric-foot"><span className={`trend ${glucoseChange > 0 ? "trend-warm" : "trend-cool"}`}>{glucoseChange >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(glucoseChange).toFixed(1)}</span><span>vs previous reading</span></div>
              <div className="metric-spark coral-spark" aria-hidden="true">{readings.slice(-8).map((reading) => <span key={reading.timestamp} style={{ height: sparklineHeight(reading.glucose, 60, 260) }} />)}</div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>HEART RATE</span><span className="metric-icon purple"><HeartPulse size={17} /></span></div>
              <div className="metric-value">{latest.heart_rate}<span className="metric-unit">bpm</span></div>
              <div className="metric-foot"><span className="metric-context"><span className="status-dot" /> Resting range</span><span>60–100 bpm</span></div>
              <div className="metric-spark purple-spark" aria-hidden="true">{readings.slice(-8).map((reading) => <span key={reading.timestamp} style={{ height: sparklineHeight(reading.heart_rate, 50, 150) }} />)}</div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>HbA1c · BASELINE</span><span className="metric-icon blue"><CalendarDays size={17} /></span></div>
              <div className="metric-value">{patient.baseline_hba1c}<span className="metric-unit">%</span></div>
              <div className="metric-foot"><span className="metric-context">Historical synthetic value</span></div>
              <div className="metric-range"><span /><i /><b>Personalized baseline</b></div>
            </article>
            <article className="metric-card forecast-metric">
              <div className="metric-top"><span>2-HOUR GLUCOSE FORECAST</span><span className={`risk-tag ${forecast.contextual_level?.toLowerCase() ?? "low"}`}><i />{forecast.event_state === "projected_within_horizon" ? "Excursion projected" : forecast.event_state === "already_above_demo_threshold" ? "Above demo threshold" : forecast.event_state === "collecting_history" ? "Collecting" : "No crossing projected"}</span></div>
              <div className="metric-value">{forecast.projected_glucose_mg_dl ?? "—"}<span className="metric-unit">mg/dL</span></div>
              <div className="metric-foot"><span className="metric-context">Linear trend · {forecast.samples_used} samples</span><span>Not validated</span></div>
              <div className="metric-contextual-index">EHR-contextualized demo index: {forecast.contextual_index === null ? "—" : Math.round(forecast.contextual_index * 100)} / 100 · not a probability</div>
            </article>
          </section>

          <section className="panel counterfactual-panel" aria-labelledby="counterfactual-title">
            <div className="panel-header counterfactual-header">
              <div>
                <div className="panel-title" id="counterfactual-title">Counterfactual Twin Lab <span className="synthetic-tag">COMPARE FORECASTS</span></div>
                <p>Hold the synthetic patient and heart-rate sequence constant; compare two glucose inputs and their projected trends.</p>
              </div>
              <button className="button button-secondary" onClick={runCounterfactual} disabled={counterfactualLoading}>
                <Activity size={15} />{counterfactualLoading ? "Running comparison…" : counterfactual ? "Run again" : "Compare scenarios"}
              </button>
            </div>
            {counterfactualError && <div className="counterfactual-error" role="alert">{counterfactualError}</div>}
            {!counterfactual && !counterfactualError && (
              <div className="counterfactual-empty">
                Deterministic, seed-based API comparison. Run it to see the same-profile steady vs rising glucose trajectories and their heuristic component differences.
              </div>
            )}
            {counterfactual && (() => {
              const [steady, rising] = counterfactual.scenarios;
              const chartData = steady.readings.map((reading, index) => ({
                elapsed_minutes: reading.elapsed_minutes,
                steady_glucose: reading.glucose,
                rising_glucose: rising.readings[index].glucose,
              }));
              return (
                <>
                  <div className="counterfactual-notice">
                    <ShieldCheck size={15} />
                    <span>{counterfactual.interpretation_note}</span>
                  </div>
                  <div className="counterfactual-summary">
                    {[steady, rising].map((scenario, index) => (
                      <article className={`counterfactual-scenario ${index === 1 ? "rising" : ""}`} key={scenario.id}>
                        <span>{scenario.label}</span>
                        <strong>{Math.round(scenario.summary.final_index * 100)}<small> / 100 · {scenario.summary.final_level}</small></strong>
                        <small>Final glucose {scenario.readings[scenario.readings.length - 1].glucose} mg/dL · mean index {Math.round(scenario.summary.mean_index * 100)}</small>
                        <small>2-hour trend: {scenario.summary.final_forecast.projected_glucose_mg_dl ?? "Collecting"} mg/dL · {scenario.summary.final_forecast.event_state.replaceAll("_", " ")}</small>
                      </article>
                    ))}
                    <article className="counterfactual-delta">
                      <span>FINAL INDEX DIFFERENCE</span>
                      <strong>+{Math.round(counterfactual.comparison.final_index_delta * 100)}<small> points</small></strong>
                      <small>Rising minus steady · same synthetic profile</small>
                    </article>
                  </div>
                  <div className="counterfactual-chart" role="img" aria-label="Comparison of steady and rising synthetic glucose trajectories">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                        <CartesianGrid stroke="#edf0f0" strokeDasharray="3 5" vertical={false} />
                        <XAxis dataKey="elapsed_minutes" tickFormatter={(value: number) => `${value}m`} tickLine={false} axisLine={false} tick={{ fill: "#99a4a4", fontSize: 10 }} />
                        <YAxis domain={[60, 260]} ticks={[60, 110, 160, 210, 260]} tickLine={false} axisLine={false} tick={{ fill: "#99a4a4", fontSize: 10 }} />
                        <Tooltip formatter={(value) => [`${value} mg/dL`, "Glucose"]} labelFormatter={(value) => `Elapsed ${value} minutes`} />
                        <Line type="monotone" dataKey="steady_glucose" name="Steady glucose" stroke="#4a9c7d" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="rising_glucose" name="Rising glucose" stroke="#df806a" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="counterfactual-chart-legend"><span><i className="steady-line" />Steady glucose</span><span><i className="rising-line" />Rising glucose</span><small>Seed {counterfactual.seed} · {counterfactual.sample_count} samples · {counterfactual.interval_minutes}-minute intervals</small></div>
                  <div className="counterfactual-method">
                    <strong>Controlled comparison</strong>
                    <span>{counterfactual.controlled_factors.join(" ")}</span>
                    <span>{counterfactual.changed_factor}</span>
                  </div>
                  <div className="counterfactual-components">
                    <strong>Final component difference <small>(rising minus steady)</small></strong>
                    <div>
                      {Object.entries(counterfactual.comparison.final_component_deltas).map(([component, value]) => (
                        <span key={component}>{component.replaceAll("_", " ")} <b>{value >= 0 ? "+" : ""}{value.toFixed(3)}</b></span>
                      ))}
                    </div>
                  </div>
                </>
              );
            })()}
          </section>

          <section className="analysis-grid" id="signals">
            <article className="panel chart-panel">
              <div className="panel-header">
                <div><div className="panel-title">Glucose trend <span className={`live-indicator ${replayStatus !== "idle" ? "replay" : streamSource}`}><i />{replayStatus === "playing" ? "GUIDED REPLAY" : replayStatus === "complete" ? "REPLAY COMPLETE" : streamSource === "backend" ? "BACKEND LIVE" : streamSource === "local" ? "LOCAL DEMO" : streamSource === "connecting" ? "CONNECTING" : "PAUSED"}</span></div><p>Five simulated minutes per sample · dashed line shows the next two-hour trend extrapolation.</p></div>
                <div className="chart-legend"><span><i className="legend-glucose" /> Glucose</span><span><i className="legend-projection" /> 2-hour projection</span><span><i className="legend-range" /> Reference band</span></div>
              </div>
              {replayStatus !== "idle" && (
                <div className="replay-progress" aria-live="polite">
                  <div className="replay-progress-heading">
                    <strong>{replayPhase} phase</strong>
                    <span>{replayIndex} / {guidedScenario.length} steps · {replayStatus === "complete" ? "Complete" : "replays at a fixed pace"}</span>
                  </div>
                  <div
                    className="replay-progress-track"
                    role="progressbar"
                    aria-label="Guided scenario replay progress"
                    aria-valuemin={0}
                    aria-valuemax={guidedScenario.length}
                    aria-valuenow={replayIndex}
                  >
                    <span style={{ width: `${(replayIndex / guidedScenario.length) * 100}%` }} />
                  </div>
                  <div className="replay-phase-list">
                    {["Baseline", "Rising signal", "Elevated signal", "Recovery"].map((phase) => (
                      <span className={replayPhase === phase ? "phase-active" : ""} key={phase}>{phase}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={forecastChartData} margin={{ top: 12, right: 8, left: -19, bottom: 0 }}>
                    <defs><linearGradient id="glucoseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ee765f" stopOpacity={0.2} /><stop offset="95%" stopColor="#ee765f" stopOpacity={0.01} /></linearGradient></defs>
                    <CartesianGrid stroke="#edf0f0" strokeDasharray="3 5" vertical={false} />
                    <ReferenceArea y1={70} y2={180} fill="#eaf6f2" fillOpacity={0.48} />
                    <XAxis dataKey="timestamp" tickFormatter={(timestamp: string) => formatTime(timestamp, replayStatus !== "idle")} tickLine={false} axisLine={false} minTickGap={36} tick={{ fill: "#99a4a4", fontSize: 11 }} />
                    <YAxis domain={[60, Math.max(replayStatus === "idle" ? 220 : 300, forecast.projected_glucose_mg_dl ?? 0)]} ticks={replayStatus === "idle" ? [60, 100, 140, 180, 220] : [60, 120, 180, 240, 300]} tickLine={false} axisLine={false} tick={{ fill: "#99a4a4", fontSize: 11 }} />
                    <Tooltip content={({ active, payload }) => {
                      const point = payload?.[0]?.payload;
                      const value = point?.forecast_glucose ?? point?.glucose;
                      return active && value != null
                        ? <div className="chart-tooltip"><strong>{value} mg/dL{point.forecast_glucose != null ? " · projection" : ""}</strong><span>{formatTime(String(point.timestamp), replayStatus !== "idle")}</span></div>
                        : null;
                    }} />
                    <ReferenceLine y={180} stroke="#d9a89f" strokeDasharray="4 4" />
                    <Area type="monotone" dataKey="glucose" stroke="#e77c67" strokeWidth={2.5} fill="url(#glucoseFill)" dot={false} activeDot={{ r: 4, fill: "#e77c67", stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
                    <Line type="linear" dataKey="forecast_glucose" stroke="#6c8c83" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, fill: "#6c8c83", stroke: "#fff", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-caption"><span><i className="target-dot" />Illustrative demo threshold: {forecast.threshold_mg_dl} mg/dL</span><span>Linear extrapolation from synthetic samples · not clinically validated</span></div>
            </article>

            <article className="panel risk-panel">
              <div className="panel-header">              <div><div className="panel-title">Current-input heuristic assessment</div><p>Static synthetic context + simulated live signals</p></div><span className="assessment-icon"><Sparkles size={17} /></span></div>
              <div className={`assessment-banner ${risk.level.toLowerCase()}`}>
                <div className="assessment-symbol">{risk.alert ? <AlertTriangle size={19} /> : <ShieldCheck size={19} />}</div>
                <div><strong>{risk.level === "High" ? "High demo index" : risk.level === "Moderate" ? "Moderate demo index" : "Low demo index"}</strong><span>Heuristic index {Math.round(risk.score * 100)} · current-input score</span></div>
              </div>
              <div className="assessment-section-label">CURRENT INPUTS</div>
              <div className="factor-row"><span className="factor-icon coral"><Activity size={15} /></span><span><strong>Glucose trend</strong><small>Latest sensor reading</small></span><b>{latest.glucose} <small>mg/dL</small></b></div>
              <div className="factor-row"><span className="factor-icon blue"><CalendarDays size={15} /></span><span><strong>HbA1c baseline</strong><small>Historical lab result</small></span><b>{patient.baseline_hba1c}<small>%</small></b></div>
              <div className="factor-row"><span className="factor-icon purple"><HeartPulse size={15} /></span><span><strong>Heart rate</strong><small>Wearable stream</small></span><b>{latest.heart_rate}<small> bpm</small></b></div>
              <div className="assessment-section-label">WHY THE INDEX CHANGES</div>
              {riskContributions.map((item) => (
                <div className="contribution-row" key={item.label}>
                  <span>{item.label}</span>
                  <div className="contribution-track" aria-label={`${item.label} contribution`}>
                    <span style={{ width: `${Math.min(100, (item.value / item.maximum) * 100)}%` }} />
                  </div>
                  <b>{item.value.toFixed(3)}</b>
                </div>
              ))}
              <div className="clinical-note"><div><Sparkles size={14} /> DEMO MODEL NOTE</div><p>The separate two-hour projection linearly extrapolates a short synthetic trend; neither output is clinically validated or a medical recommendation.</p></div>
              <div className="model-footnote">EHR HbA1c/BMI inform the contextual index · projection and threshold are demonstration choices</div>
            </article>
          </section>

          <section className="bottom-grid">
            <article className="panel profile-panel">
              <div className="panel-header"><div><div className="panel-title">Clinical context</div><p>Static EHR snapshot</p></div><span className="source-label"><span /> EHR</span></div>
              <div className="context-columns">
                <div className="context-item"><span>CONDITIONS</span><div className="chip-list">{patient.history.map((condition) => <span className="condition-chip" key={condition}>{condition}</span>)}</div></div>
                <div className="context-item"><span>MEDICATIONS</span><div className="medication"><span className="medication-icon">Rx</span><strong>{patient.medications[0] ?? "No medication on file"}</strong></div></div>
                <div className="context-item compact-context"><span>BMI</span><strong className="context-number">{patient.bmi}<small> kg/m²</small></strong></div>
              </div>
            </article>
            <article className="panel device-panel">
              <div className="panel-header"><div><div className="panel-title">Synthetic data sources</div><p>Simulation and profile status</p></div></div>
              <div className="device-row"><span className="device-icon"><Watch size={18} /></span><span><strong>Simulated wearable</strong><small>Generated glucose · heart rate</small></span><span className={`connection-state ${streamSource === "backend" ? "connected" : streamSource === "local" ? "local-source" : ""}`}><i />{streamSource === "backend" ? "API stream" : streamSource === "local" ? "Local demo" : streamSource === "connecting" ? "Connecting" : "Standby"}</span></div>
              <div className="device-row"><span className="device-icon ehr-icon"><CalendarDays size={18} /></span><span><strong>Synthetic EHR profile</strong><small>Static labs · diagnoses · history</small></span><span className={`connection-state ${profileSource === "backend" ? "connected" : "local-source"}`}><i />{profileSource === "backend" ? "API profile" : "Local demo"}</span></div>
            </article>
          </section>

          <section className="bottom-actions">
            <button className="button button-secondary" onClick={startGuidedReplay}>
              <RotateCcw size={15} />{replayStatus === "idle" ? "Run guided replay" : "Restart guided replay"}
            </button>
            <button className={`button ${anomaly ? "button-stop" : "button-anomaly"}`} onClick={toggleAnomaly} disabled={replayStatus === "playing"}>
              {anomaly ? <X size={15} /> : <Radio size={15} />}{anomaly ? "Stop excursion simulation" : "Simulate glucose excursion"}
            </button>
            <div className="footer-disclaimer"><ShieldCheck size={14} /> Synthetic demo data. Research prototype only—not a medical device.</div>
          </section>
          <footer className="app-footer"><span>PulseTwin <b>·</b> Digital Twin Challenge 2026</span><span>Prototype v0.1 <b>·</b> <a href="#overview">Back to top ↑</a></span></footer>
        </div>
      </section>
      {helpOpen && (
        <div className="help-backdrop" onClick={() => setHelpOpen(false)}>
          <section
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="help-dialog-heading">
              <div><strong id="help-title">About this demonstration</strong><span>PulseTwin synthetic-data prototype</span></div>
              <button className="icon-button" aria-label="Close help" onClick={() => setHelpOpen(false)}><X size={18} /></button>
            </div>
            <p>The profile and wearable readings are synthetic. The current-input index is a transparent rule-based demonstration. The separate two-hour projection is a linear extrapolation of synthetic readings; neither output is a probability, diagnosis, treatment recommendation, or clinically validated forecast.</p>
            <p>The simulated stream advances five minutes per sample for demonstration. Run the guided replay for the same accelerated baseline, rising, elevated, and recovery sequence each time; it is an illustrative synthetic scenario, not patient data.</p>
          </section>
        </div>
      )}
    </main>
  );
}
