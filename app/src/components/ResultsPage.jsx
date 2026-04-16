import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { color } from "../constants/tailwind";
import {
  extractTelemetryMetrics,
  getTelemetryPeakValue,
  inferFlowSensorMode,
  SENSOR_MODE_AERIS,
  SENSOR_MODE_MIXED,
  toFiniteNumber,
} from "../constants/telemetryMetrics";
import { Map } from "./Map";
import { MethanePanel } from "./MethanePanel";
import { filterTraceDatasetBySelection } from "../data/methaneTraceData";
import { deleteMission, listMissions, runAerisAnalysis } from "../services/api";
import {
  SquarePen,
  Trash,
  RotateCcw,
  Play,
  Pause,
  Square,
  Download,
} from "lucide-react";
import { AerisPanel } from "./AerisPanel";
import { MissionModal } from "./MissionModal";
import { CSVImportModal } from "./CSVModal";

const ALL_DRONES_OPTION = "ALL";
const REPLAY_STEP_MS = 180;

const sensorModePresentation = (sensorMode) => {
  if (sensorMode === SENSOR_MODE_AERIS) {
    return {
      label: "Aeris",
      foreground: color.green,
      background: color.greenSoft,
    };
  }

  if (sensorMode === SENSOR_MODE_MIXED) {
    return {
      label: "Mixed",
      foreground: color.warning,
      background: "rgba(240, 193, 93, 0.18)",
    };
  }

  return {
    label: "Dual",
    foreground: color.textMuted,
    background: color.surface,
  };
};

const formatCompactValue = (value, digits = 2) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }

  return parsed.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
};

const buildTraceDatasetFromFlowData = (datasetFlowData) => ({
  type: "FeatureCollection",
  features: datasetFlowData
    .filter(
      (point) =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    )
    .map((point) => {
      const traceValue =
        point.sensorMode === SENSOR_MODE_AERIS
          ? Number(point.methane || 0)
          : Number.isFinite(Number(point.purway))
            ? Number(point.purway)
            : Number(point.methane || 0);

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [point.longitude, point.latitude],
        },
        properties: {
          id: `trace-${point.sampleOrder}`,
          sampleOrder: point.sampleOrder,
          sampleIndex: point.sampleIndex,
          timestampMs: point.timestampMs,
          timestampIso: point.timestampIso,
          timeLabel: point.time,
          altitude: point.altitude,
          sniffer: point.sniffer,
          purway: point.purway,
          acetylene: point.acetylene,
          nitrousOxide: point.nitrousOxide,
          sensorMode: point.sensorMode,
          ch4: point.methane,
          methane: traceValue,
          detected: traceValue > 0,
          pointColor: traceValue > 0 ? "#4ade80" : "#64748b",
        },
      };
    }),
});

const normalizeMissionPoint = (point, index, droneId) => {
  const metrics = extractTelemetryMetrics(point);
  const timestampIso =
    point.timestampIso ||
    point.ts ||
    point.timestamp ||
    new Date().toISOString();
  const rawTimestampMs = Number(point.timestampMs);
  const derivedTimestampMs = new Date(timestampIso).getTime();
  const timestampMs = Number.isFinite(rawTimestampMs)
    ? rawTimestampMs
    : Number.isFinite(derivedTimestampMs)
      ? derivedTimestampMs
      : Date.now();

  return {
    sampleOrder: index,
    sampleIndex: index + 1,
    timestampMs,
    timestampIso,
    time: new Date(timestampMs).toLocaleTimeString(),
    altitude: toFiniteNumber(point.altitude) ?? 0,
    latitude: toFiniteNumber(point.latitude) ?? 0,
    longitude: toFiniteNumber(point.longitude) ?? 0,
    sensorMode: metrics.sensorMode,
    sniffer: metrics.sniffer,
    purway: metrics.purway,
    methane: metrics.methane,
    acetylene: metrics.acetylene,
    nitrousOxide: metrics.nitrousOxide,
    droneId,
    payload: point.payload || {},
  };
};

const flattenMissionFlowData = (results) =>
  (Array.isArray(results) ? results : [])
    .flatMap((entry) => {
      const droneId = entry?.drone || "unknown-drone";
      const data = Array.isArray(entry?.data) ? entry.data : [];
      return data.map((point, index) =>
        normalizeMissionPoint(point, index, droneId),
      );
    })
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map((point, index) => ({
      ...point,
      sampleOrder: index,
      sampleIndex: index + 1,
    }));

export function ResultsPage({ devices = [], sensorsMode = [], selectedDeviceId, onSelectDevice }) {
  const [selectedMissionId, setSelectedMissionId] = useState(null);

  const [selectedResultDroneId, setSelectedResultDroneId] =
    useState(ALL_DRONES_OPTION);
  const [missionsSample, setMissionsSample] = useState([]);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [deletingMissionId, setDeletingMissionId] = useState(null);
  const [legendScale, setLegendScale] = useState({
    lowerLimit: 0,
    upperLimit: 5,
  });
  const [plumeViewByMission, setPlumeViewByMission] = useState({});
  const isPlumeViewEnabled = plumeViewByMission[selectedMissionId] ?? false;
  const [heatmapViewByMission, setHeatmapViewByMission] = useState({});
  const isHeatmapEnabled = heatmapViewByMission[selectedMissionId] ?? true;
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [isAnalyzeModalOpen, setIsAnalyzeModalOpen] = useState(false);
  const [isNotebookRunning, setIsNotebookRunning] = useState(false);
  const [analysisOutputText, setAnalysisOutputText] = useState("");
  const [analysisImageDataUri, setAnalysisImageDataUri] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [analysisExecutedAt, setAnalysisExecutedAt] = useState("");
  const [analysisTracerRates, setAnalysisTracerRates] = useState({
    acetylene: "0.0",
    nitrousOxide: "0.0",
  });
  const replayTimerRef = useRef(null);
  const replayEndIndexRef = useRef(0);
  const [csvModalFile, setCsvModalFile] = useState(null);
  const [importMessage, setImportMessage] = useState(null);

  const openCsvPicker = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = (event) => {
      const file = event.target.files?.[0] || null;
      if (file) setCsvModalFile(file);
    };
    input.click();
  };

  const missions = useMemo(() => {
    return missionsSample
      .map((mission) => {
        const flowData = flattenMissionFlowData(mission.results);
        const droneIds = (Array.isArray(mission.results) ? mission.results : [])
          .map((entry) => entry?.drone)
          .filter(Boolean);
        const startTs = flowData[0]?.timestampIso || mission.createdAt || null;
        const endTs =
          flowData[flowData.length - 1]?.timestampIso ||
          mission.createdAt ||
          null;
        const peakMethane = flowData.reduce(
          (maxValue, point) => Math.max(maxValue, Number(point.methane || 0)),
          0,
        );
        const droneSensorModeById = droneIds.reduce((accumulator, droneId) => {
          const droneFlowData = flowData.filter(
            (point) => point.droneId === droneId,
          );
          accumulator[droneId] = inferFlowSensorMode(droneFlowData);
          return accumulator;
        }, {});

        return {
          id: mission.id,
          name: mission.name || "Untitled Mission",
          sampleCount: flowData.length,
          droneIds,
          primaryDroneId: droneIds[0] || null,
          startTs,
          endTs,
          createdAt: mission.createdAt || null,
          elapsedSeconds: Number(mission.elapsedSeconds || 0),
          peakMethane,
          status: flowData.length > 0 ? "Ready" : "No Data",
          droneSensorModeById,
          flowData,
        };
      })
      .sort((a, b) => {
        const aTs = new Date(a.endTs || 0).getTime();
        const bTs = new Date(b.endTs || 0).getTime();
        return bTs - aTs;
      });
  }, [missionsSample]);

  useEffect(() => {
    const loadMissions = async () => {
      const loadedMissions = await listMissions();
      setMissionsSample(loadedMissions);
    };
    void loadMissions();
  }, []);

  useEffect(() => {
    if (!missions.length) {
      setSelectedMissionId(null);
      return;
    }

    const selectedMissionStillExists = missions.some(
      (mission) => mission.id === selectedMissionId,
    );

    if (!selectedMissionStillExists) {
      const preferred = missions.find(
        (mission) => mission.id === selectedDeviceId,
      );
      setSelectedMissionId((preferred || missions[0]).id);
    }
  }, [missions, selectedDeviceId, selectedMissionId]);

  const selectedMission = useMemo(
    () => missions.find((mission) => mission.id === selectedMissionId) || null,
    [missions, selectedMissionId],
  );

  useEffect(() => {
    if (!selectedMission) {
      setSelectedResultDroneId(ALL_DRONES_OPTION);
      return;
    }

    if (
      selectedResultDroneId !== ALL_DRONES_OPTION &&
      !selectedMission.droneIds.includes(selectedResultDroneId)
    ) {
      setSelectedResultDroneId(ALL_DRONES_OPTION);
    }
  }, [selectedMission, selectedResultDroneId]);

  const selectedFlowData = useMemo(() => {
    if (!selectedMission?.flowData) {
      return [];
    }

    if (selectedResultDroneId === ALL_DRONES_OPTION) {
      return selectedMission.flowData;
    }

    return selectedMission.flowData.filter(
      (point) => point.droneId === selectedResultDroneId,
    );
  }, [selectedMission, selectedResultDroneId]);

  const droneFilterOptions = useMemo(() => {
    const missionDroneIds = selectedMission?.droneIds || [];
    return [
      { id: ALL_DRONES_OPTION, name: "All Drones" },
      ...missionDroneIds.map((droneId) => ({ id: droneId, name: droneId })),
    ];
  }, [selectedMission]);

  const selectedSensorMode = useMemo(
    () => inferFlowSensorMode(selectedFlowData),
    [selectedFlowData],
  );
  const hasAerisTraceData = useMemo(
    () =>
      selectedFlowData.some(
        (point) =>
          point.sensorMode === SENSOR_MODE_AERIS ||
          Number.isFinite(Number(point.acetylene)) ||
          Number.isFinite(Number(point.nitrousOxide)),
      ),
    [selectedFlowData],
  );
  const hasDualTraceData = useMemo(
    () =>
      selectedFlowData.some(
        (point) =>
          point.sensorMode !== SENSOR_MODE_AERIS ||
          Number.isFinite(Number(point.sniffer)) ||
          Number.isFinite(Number(point.purway)),
      ),
    [selectedFlowData],
  );

  const maxSelectablePpm = Math.max(1, getTelemetryPeakValue(selectedFlowData));
  const [selectedWindow, setSelectedWindow] = useState({
    startIndex: 0,
    endIndex: Math.max(0, selectedFlowData.length - 1),
    ppmMin: 0,
    ppmMax: maxSelectablePpm,
  });

  const clearReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      window.clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    setSelectedWindow({
      startIndex: 0,
      endIndex: Math.max(0, selectedFlowData.length - 1),
      ppmMin: 0,
      ppmMax: maxSelectablePpm,
    });
    replayEndIndexRef.current = Math.max(0, selectedFlowData.length - 1);
    clearReplayTimer();
    setIsReplayPlaying(false);
  }, [
    clearReplayTimer,
    selectedMissionId,
    selectedFlowData.length,
    maxSelectablePpm,
    selectedResultDroneId,
  ]);

  useEffect(() => {
    replayEndIndexRef.current = selectedWindow.endIndex;
  }, [selectedWindow.endIndex]);

  useEffect(() => () => clearReplayTimer(), [clearReplayTimer]);

  const activeTraceDataset = useMemo(
    () => buildTraceDatasetFromFlowData(selectedFlowData),
    [selectedFlowData],
  );

  const filteredTraceDataset = useMemo(
    () => filterTraceDatasetBySelection(activeTraceDataset, selectedWindow),
    [activeTraceDataset, selectedWindow],
  );

  const notebookAnalysisSamples = useMemo(() => {
    if (!selectedFlowData.length) {
      return [];
    }

    const safeStart = Math.max(
      0,
      Math.min(selectedWindow.startIndex, selectedFlowData.length - 1),
    );
    const safeEnd = Math.max(
      safeStart,
      Math.min(selectedWindow.endIndex, selectedFlowData.length - 1),
    );

    return selectedFlowData
      .slice(safeStart, safeEnd + 1)
      .filter((point) => {
        const methane = Number(point?.methane ?? 0);
        return methane >= selectedWindow.ppmMin && methane <= selectedWindow.ppmMax;
      })
      .map((point) => ({
        ts: point.timestampIso || point.ts || null,
        timestampMs: point.timestampMs ?? null,
        droneId: point.droneId || null,
        topic: point.topic || null,
        latitude: point.latitude ?? null,
        longitude: point.longitude ?? null,
        altitude: point.altitude ?? null,
        methane: Number(point?.methane ?? 0),
        acetylene: Number(point?.acetylene ?? 0),
        nitrousOxide: Number(point?.nitrousOxide ?? 0),
      }));
  }, [selectedFlowData, selectedWindow]);

  const averageMethane = useMemo(() => {
    if (!selectedFlowData.length) {
      return 0;
    }

    const total = selectedFlowData.reduce(
      (sum, point) => sum + Number(point.methane || 0),
      0,
    );
    return total / selectedFlowData.length;
  }, [selectedFlowData]);

  const thresholdSamples = useMemo(
    () =>
      selectedFlowData.filter((point) => Number(point.methane || 0) >= 2)
        .length,
    [selectedFlowData],
  );

  const analysisReadiness = useMemo(() => {
    if (!selectedMission || selectedFlowData.length === 0) {
      return {
        label: "No Data",
        tone: color.red,
        background: "rgba(239, 68, 68, 0.12)",
      };
    }

    if (selectedFlowData.length < 30) {
      return {
        label: "Partial Data",
        tone: color.warning,
        background: "rgba(240, 193, 93, 0.16)",
      };
    }

    return {
      label: "Ready",
      tone: color.green,
      background: color.greenSoft,
    };
  }, [selectedMission, selectedFlowData.length]);

  const confidenceScore = useMemo(() => {
    const sampleCoverage = Math.min(1, selectedFlowData.length / 220);
    const plumeCoverage = Math.min(1, thresholdSamples / 55);
    const score = Math.round(
      (sampleCoverage * 0.65 + plumeCoverage * 0.35) * 100,
    );
    return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  }, [selectedFlowData.length, thresholdSamples]);

  const unifiedEmissionRate = useMemo(() => {
    if (!selectedMission?.flowData?.length) {
      return 0;
    }

    const averageFluxProxy =
      averageMethane * Math.max(1, selectedMission.flowData.length / 80);
    return Number((averageFluxProxy * 0.032).toFixed(3));
  }, [averageMethane, selectedMission]);

  const analysisMethods = useMemo(
    () => [
      {
        name: "Mass Flux Estimation",
        estimate: `${formatCompactValue(unifiedEmissionRate * 1.08, 3)} kg/h`,
        uncertainty: "±12%",
        assumptions: "Wind stable, plume transect complete",
        quality: confidenceScore >= 70 ? "High" : "Medium",
      },
      // {
      //   name: "Control Surface Flux",
      //   estimate: `${formatCompactValue(unifiedEmissionRate * 0.97, 3)} kg/h`,
      //   uncertainty: "±15%",
      //   assumptions: "Control plane intersects plume",
      //   quality: confidenceScore >= 65 ? "High" : "Medium",
      // },
      // {
      //   name: "Gaussian Plume Model",
      //   estimate: `${formatCompactValue(unifiedEmissionRate * 1.21, 3)} kg/h`,
      //   uncertainty: "±22%",
      //   assumptions: "Steady-state wind and source",
      //   quality: confidenceScore >= 75 ? "Medium" : "Low",
      // },
      // {
      //   name: "Numerical Integration (Riemann)",
      //   estimate: `${formatCompactValue(unifiedEmissionRate * 0.91, 3)} kg/h`,
      //   uncertainty: "±10%",
      //   assumptions: "Uniform sampling density",
      //   quality: confidenceScore >= 60 ? "High" : "Medium",
      // },
      // {
      //   name: "Spatial Interpolation (IDW)",
      //   estimate: `${formatCompactValue(unifiedEmissionRate * 1.03, 3)} kg/h`,
      //   uncertainty: "±16%",
      //   assumptions: "Neighborhood radius representative",
      //   quality: confidenceScore >= 70 ? "High" : "Medium",
      // },
      {
        name: "Emission Rate Estimation",
        estimate: `${formatCompactValue(unifiedEmissionRate, 3)} kg/h`,
        uncertainty: "±14%",
        assumptions: "Sensor calibration in range",
        quality: confidenceScore >= 65 ? "High" : "Medium",
      },
      // {
      //   name: "Mass Balance Method",
      //   estimate: `${formatCompactValue(unifiedEmissionRate * 1.14, 3)} kg/h`,
      //   uncertainty: "±20%",
      //   assumptions: "Upwind/downwind split resolved",
      //   quality: confidenceScore >= 78 ? "Medium" : "Low",
      // },
    ],
    [confidenceScore, unifiedEmissionRate],
  );

  const missionDurationText = useMemo(() => {
    if (!selectedMission?.startTs || !selectedMission?.endTs) {
      return "-";
    }

    const start = new Date(selectedMission.startTs).getTime();
    const end = new Date(selectedMission.endTs).getTime();
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainderSeconds = seconds % 60;
    return `${minutes}m ${remainderSeconds}s`;
  }, [selectedMission]);

  const formatTimestamp = (value) => {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString();
  };

  const playFlight = () => {
    if (!selectedFlowData.length) {
      return;
    }

    const lastIndex = Math.max(0, selectedFlowData.length - 1);
    const shouldRestart = replayEndIndexRef.current >= lastIndex;

    clearReplayTimer();
    setIsReplayPlaying(true);

    if (shouldRestart) {
      replayEndIndexRef.current = 0;
      setSelectedWindow((prev) => ({
        ...prev,
        startIndex: 0,
        endIndex: 0,
        ppmMin: 0,
        ppmMax: maxSelectablePpm,
      }));
    }

    replayTimerRef.current = window.setInterval(() => {
      if (replayEndIndexRef.current >= lastIndex) {
        clearReplayTimer();
        setIsReplayPlaying(false);
        return;
      }

      const nextEndIndex = replayEndIndexRef.current + 1;
      replayEndIndexRef.current = nextEndIndex;
      setSelectedWindow((prev) => ({
        ...prev,
        startIndex: 0,
        endIndex: nextEndIndex,
        ppmMin: 0,
        ppmMax: maxSelectablePpm,
      }));
    }, REPLAY_STEP_MS);
  };

  const pauseFlight = () => {
    clearReplayTimer();
    setIsReplayPlaying(false);
  };

  const resetFlight = () => {
    clearReplayTimer();
    setIsReplayPlaying(false);
    const lastIndex = Math.max(0, selectedFlowData.length - 1);
    replayEndIndexRef.current = lastIndex;
    setSelectedWindow({
      startIndex: 0,
      endIndex: lastIndex,
      ppmMin: 0,
      ppmMax: maxSelectablePpm,
    });
  };

  const handleDeleteMission = async (missionId) => {
    if (!missionId || deletingMissionId) {
      return;
    }

    setDeletingMissionId(missionId);
    const deleted = await deleteMission(missionId);

    if (deleted) {
      setMissionsSample((previous) =>
        previous.filter((mission) => mission.id !== missionId),
      );
    }

    setDeletingMissionId(null);
  };

  const handleRunNotebookAnalysis = useCallback(async (tracerRates = {}) => {
    setIsAnalyzeModalOpen(true);
    setIsNotebookRunning(true);
    setAnalysisError("");
    setAnalysisOutputText("");
    setAnalysisImageDataUri("");

    const nextTracerRates = {
      acetylene:
        tracerRates?.acetyleneTracerRate ?? analysisTracerRates.acetylene ?? "",
      nitrousOxide:
        tracerRates?.nitrousOxideTracerRate ?? analysisTracerRates.nitrousOxide ?? "",
    };
    const acetyleneTracerRate = Number.parseFloat(nextTracerRates.acetylene);
    const nitrousOxideTracerRate = Number.parseFloat(nextTracerRates.nitrousOxide);

    setAnalysisTracerRates(nextTracerRates);

    const result = await runAerisAnalysis({
      samples: notebookAnalysisSamples,
      tracerReleaseRates: {
        acetylene: Number.isFinite(acetyleneTracerRate)
          ? acetyleneTracerRate
          : null,
        nitrousOxide: Number.isFinite(nitrousOxideTracerRate)
          ? nitrousOxideTracerRate
          : null,
      },
      selection: {
        ...selectedWindow,
        sampleCount: notebookAnalysisSamples.length,
      },
      mission: {
        id: selectedMission?.id || null,
        name: selectedMission?.name || null,
        droneId:
          selectedResultDroneId === ALL_DRONES_OPTION ? null : selectedResultDroneId,
      },
    });

    if (!result?.ok) {
      setAnalysisError(result?.error || "Aeris analysis failed");
      setIsNotebookRunning(false);
      return;
    }

    setAnalysisExecutedAt(result.executedAt || new Date().toISOString());
    setAnalysisImageDataUri(result.imageDataUri || "");
    setAnalysisOutputText(
      result.outputText ||
        "Notebook ran successfully, but returned no output text.",
    );
    setIsNotebookRunning(false);
  }, [
    analysisTracerRates.acetylene,
    analysisTracerRates.nitrousOxide,
    notebookAnalysisSamples,
    selectedMission?.id,
    selectedMission?.name,
    selectedResultDroneId,
    selectedWindow,
  ]);

  const handleDownloadAnalysis = useCallback(() => {
    if (!analysisImageDataUri && !analysisOutputText) {
      return;
    }

    const link = document.createElement("a");
    const timestamp = analysisExecutedAt
      ? new Date(analysisExecutedAt).toISOString().replace(/[:.]/g, "-")
      : new Date().toISOString().replace(/[:.]/g, "-");

    if (analysisImageDataUri) {
      link.href = analysisImageDataUri;
      link.download = `aeris-analysis-${timestamp}.png`;
      link.click();
      return;
    }

    const blob = new Blob([analysisOutputText], {
      type: "text/plain;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `aeris-analysis-${timestamp}.txt`;
    link.click();
    URL.revokeObjectURL(objectUrl);
  }, [analysisExecutedAt, analysisImageDataUri, analysisOutputText]);

  return (
    <div className="grid h-full w-full gap-4 p-3 lg:grid-cols-[250px_minmax(0,1fr)]">
      {isAnalyzeModalOpen ? (
        <MissionModal size="wide" onClose={() => setIsAnalyzeModalOpen(false)}>
          <div className="flex h-full min-h-[78vh] flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-10">
              <div>
                <p
                  className="text-[11px] uppercase tracking-[0.2em]"
                  style={{ color: color.textDim }}
                >
                  Aeris Notebook
                </p>
                <h2
                  className="text-2xl font-semibold"
                  style={{ color: color.text }}
                >
                  Analysis Result
                </h2>
                <p className="text-sm" style={{ color: color.textMuted }}>
                  {isNotebookRunning
                    ? "Running all notebook cells..."
                    : analysisExecutedAt
                      ? `Completed at ${new Date(analysisExecutedAt).toLocaleString()}`
                      : "Awaiting notebook output"}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
                  style={{
                    backgroundColor: color.surface,
                    borderColor: color.borderStrong,
                    color: color.text,
                  }}
                  onClick={handleDownloadAnalysis}
                  disabled={!analysisImageDataUri && !analysisOutputText}
                >
                  <Download size={16} />
                  Download
                </button>
                <button
                  type="button"
                  className="rounded-md px-4 py-2 text-white"
                  style={{ backgroundColor: color.orange }}
                  onClick={() => setIsAnalyzeModalOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
              <div
                className="min-h-[420px] overflow-auto rounded-xl border p-4"
                style={{
                  backgroundColor: color.surface,
                  borderColor: color.border,
                }}
              >
                {isNotebookRunning ? (
                  <p className="text-sm" style={{ color: color.textMuted }}>
                    Executing notebook. This can take a little while...
                  </p>
                ) : analysisError ? (
                  <p
                    className="text-sm whitespace-pre-wrap"
                    style={{ color: color.red }}
                  >
                    {analysisError}
                  </p>
                ) : analysisImageDataUri ? (
                  <img
                    src={analysisImageDataUri}
                    alt="Notebook analysis plot"
                    className="w-full rounded-lg border"
                    style={{
                      borderColor: color.borderStrong,
                      backgroundColor: color.card,
                    }}
                  />
                ) : (
                  <p className="text-sm" style={{ color: color.textMuted }}>
                    No figure was returned by the notebook.
                  </p>
                )}
              </div>

              <div
                className="min-h-[420px] overflow-auto rounded-xl border p-4"
                style={{
                  backgroundColor: color.surface,
                  borderColor: color.border,
                }}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3
                    className="text-sm font-semibold uppercase tracking-[0.12em]"
                    style={{ color: color.textDim }}
                  >
                    Console Output
                  </h3>
                  {analysisImageDataUri ? (
                    <span
                      className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                      style={{
                        backgroundColor: color.greenSoft,
                        color: color.green,
                      }}
                    >
                      Figure Ready
                    </span>
                  ) : null}
                </div>
                {isNotebookRunning ? (
                  <p className="text-sm" style={{ color: color.textMuted }}>
                    Waiting for analysis logs...
                  </p>
                ) : analysisError ? (
                  <p
                    className="text-sm whitespace-pre-wrap"
                    style={{ color: color.red }}
                  >
                    {analysisError}
                  </p>
                ) : analysisOutputText ? (
                  <pre
                    className="text-xs whitespace-pre-wrap"
                    style={{ color: color.text, margin: 0 }}
                  >
                    {analysisOutputText}
                  </pre>
                ) : (
                  <p className="text-sm" style={{ color: color.textMuted }}>
                    No text output was returned by the notebook.
                  </p>
                )}
              </div>
            </div>
          </div>
        </MissionModal>
      ) : null}
      <div className="flex items-center flex-col gap-3">
        <button
          type="button"
          onClick={openCsvPicker}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-lg font-medium transition-colors w-full justify-center"
          style={{
            backgroundColor: color.surface,
            borderColor: color.borderStrong,
            color: color.green,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 13 13"
            fill="none"
            transform="rotate(180)"
          >
            <path
              d="M6.5 1v7M3.5 5l3 3 3-3M2 10h9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Upload CSV
        </button>

        {importMessage && (
          <p className="text-xs text-center" style={{ color: color.green }}>
            {importMessage}
          </p>
        )}

        <aside
          className="rounded-lg border p-3 w-full"
          style={{ backgroundColor: color.card, borderColor: color.border }}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex flex-row gap-3">
              <h2
                className="text-sm font-semibold"
                style={{ color: color.text }}
              >
                Saved Missions
              </h2>
              <span
                className="rounded-full px-2 py-0.5 text-xs"
                style={{
                  backgroundColor: color.surface,
                  color: color.textMuted,
                }}
              >
                {missions.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsDeleteMode((previous) => !previous);
              }}
              style={{
                color: isDeleteMode ? color.orange : color.textMuted,
              }}
            >
              <SquarePen size={17} />
            </button>
          </div>

          <div className="space-y-2">
            {missions.map((mission) => {
              const isActive = mission.id === selectedMissionId;
              const isDeleting = deletingMissionId === mission.id;
              return (
                <div
                  key={mission.id}
                  className="relative w-full overflow-hidden rounded-md"
                  style={{
                    backgroundColor: color.surface,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMissionId(mission.id);
                      setSelectedResultDroneId(ALL_DRONES_OPTION);
                      onSelectDevice?.(
                        mission.primaryDroneId || selectedDeviceId,
                      );
                    }}
                    className="relative z-10 flex w-full flex-row rounded-md border px-3 py-2 text-left"
                    style={{
                      borderColor: isActive ? color.orange : color.border,
                      backgroundColor: isActive
                        ? color.orangeSoft
                        : color.surface,
                    }}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <p
                          className="text-sm font-semibold"
                          style={{ color: color.text }}
                        >
                          {mission.name}
                        </p>
                        <span
                          className="text-[11px]"
                          style={{
                            color: isActive ? color.orange : color.textDim,
                          }}
                        >
                          {mission.status}
                        </span>
                      </div>
                      <p
                        className="mt-1 text-xs"
                        style={{ color: color.textMuted }}
                      >
                        {mission.sampleCount} samples across{" "}
                        {mission.droneIds.length} drone(s)
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {mission.droneIds.map((droneId) => {
                          const presentation = sensorModePresentation(
                            mission.droneSensorModeById?.[droneId],
                          );

                          return (
                            <span
                              key={`${mission.id}-${droneId}`}
                              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                color: presentation.foreground,
                                backgroundColor: presentation.background,
                              }}
                            >
                              {droneId} • {presentation.label}
                            </span>
                          );
                        })}
                      </div>
                      <p
                        className="mt-1 text-[11px]"
                        style={{ color: color.textDim }}
                      >
                        {formatTimestamp(mission.endTs)}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDeleteMission(mission.id);
                    }}
                    disabled={!isDeleteMode || isDeleting}
                    className="absolute right-0 top-0 z-20 flex h-full w-1/3 items-center justify-center transition-transform duration-300 ease-out"
                    style={{
                      backgroundColor: color.red,
                      color: "#ffffff",
                      transform: isDeleteMode
                        ? "translateX(0)"
                        : "translateX(100%)",
                      opacity: isDeleteMode ? 1 : 0,
                      pointerEvents: isDeleteMode ? "auto" : "none",
                    }}
                    aria-label={`Delete mission ${mission.name}`}
                  >
                    <Trash size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      <section className="grid gap-3 h-full">
        <div
          className="rounded-lg border p-4"
          style={{
            backgroundColor: color.card,
            borderColor: color.border,
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p
                className="text-xs uppercase tracking-[0.12em]"
                style={{ color: color.textDim }}
              >
                Analysis Control
              </p>
              <h3
                className="text-xl font-semibold"
                style={{ color: color.text }}
              >
                {selectedMission?.name || "No mission selected"}
              </h3>
              <p className="text-xs" style={{ color: color.textMuted }}>
                {selectedMission?.sampleCount || 0} samples across{" "}
                {selectedMission?.droneIds.length || 0} drone(s){" "}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className="rounded-full px-3 py-1 font-semibold"
                style={{
                  backgroundColor: analysisReadiness.background,
                  color: analysisReadiness.tone,
                }}
              >
                {analysisReadiness.label}
              </span>
              <span
                className="rounded-full px-3 py-1"
                style={{
                  backgroundColor: color.surface,
                  color: color.textMuted,
                }}
              >
                Samples {selectedMission?.sampleCount || 0}
              </span>
              <span
                className="rounded-full px-3 py-1"
                style={{
                  backgroundColor: color.orangeSoft,
                  color: color.orange,
                }}
              >
                Peak CH4 {Number(selectedMission?.peakMethane || 0).toFixed(2)}{" "}
                ppm
              </span>
              <span
                className="rounded-full px-3 py-1"
                style={{ backgroundColor: color.greenSoft, color: color.green }}
              >
                Duration {missionDurationText}
              </span>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 font-semibold"
                style={{
                  backgroundColor: color.orange,
                  color: "#ffffff",
                }}
                onClick={() => {
                  void handleRunNotebookAnalysis();
                }}
                disabled={isNotebookRunning}
              >
                {isNotebookRunning ? "Running..." : "Run Analysis"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div
            className="rounded-lg border px-3 py-3"
            style={{ backgroundColor: color.card, borderColor: color.border }}
          >
            <p
              className="text-[11px] uppercase tracking-[0.12em]"
              style={{ color: color.textDim }}
            >
              Unified Emission
            </p>
            <p
              className="mt-1 text-xl font-semibold"
              style={{ color: color.text }}
            >
              {formatCompactValue(unifiedEmissionRate, 3)} kg/h
            </p>
          </div>
          <div
            className="rounded-lg border px-3 py-3"
            style={{ backgroundColor: color.card, borderColor: color.border }}
          >
            <p
              className="text-[11px] uppercase tracking-[0.12em]"
              style={{ color: color.textDim }}
            >
              Confidence
            </p>
            <p
              className="mt-1 text-xl font-semibold"
              style={{ color: color.text }}
            >
              {confidenceScore}%
            </p>
          </div>
          <div
            className="rounded-lg border px-3 py-3"
            style={{ backgroundColor: color.card, borderColor: color.border }}
          >
            <p
              className="text-[11px] uppercase tracking-[0.12em]"
              style={{ color: color.textDim }}
            >
              Avg Methane
            </p>
            <p
              className="mt-1 text-xl font-semibold"
              style={{ color: color.text }}
            >
              {averageMethane.toFixed(2)} ppm
            </p>
          </div>
          <div
            className="rounded-lg border px-3 py-3"
            style={{ backgroundColor: color.card, borderColor: color.border }}
          >
            <p
              className="text-[11px] uppercase tracking-[0.12em]"
              style={{ color: color.textDim }}
            >
              Threshold Samples
            </p>
            <p
              className="mt-1 text-xl font-semibold"
              style={{ color: color.text }}
            >
              {thresholdSamples}
            </p>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.35fr_0.65fr] h-full">
          <div
            className="min-h-[320px] rounded-lg border p-4"
            style={{ backgroundColor: color.card, borderColor: color.border }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h4
                className="text-sm font-semibold"
                style={{ color: color.text }}
              >
                Flight Replay + Analysis Map
              </h4>
              <div className="relative">
                <select
                  value={selectedResultDroneId}
                  onChange={(e) => {
                    const nextDroneId = e.target.value;
                    setSelectedResultDroneId(nextDroneId);
                    if (nextDroneId !== ALL_DRONES_OPTION) {
                      onSelectDevice?.(nextDroneId);
                    }
                  }}
                  className="appearance-none rounded-lg border py-2 pl-3 pr-8 text-sm font-medium focus:outline-none"
                  style={{
                    backgroundColor: color.card,
                    borderColor: color.borderStrong,
                    color: color.text,
                  }}
                >
                  {droneFilterOptions.map((d) => (
                    <option
                      key={d.id}
                      value={d.id}
                      style={{ backgroundColor: color.card }}
                    >
                      {d.name}
                    </option>
                  ))}
                </select>
                <svg
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path
                    d="M2 4l4 4 4-4"
                    stroke={color.textMuted}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="flex items-center gap-4 mr-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!selectedMissionId) {
                        return;
                      }

                      setHeatmapViewByMission((previous) => ({
                        ...previous,
                        [selectedMissionId]: !(
                          previous[selectedMissionId] ?? true
                        ),
                      }));
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out focus:outline-none ${isHeatmapEnabled ? "bg-sky-500" : "bg-gray-300"}`}
                  >
                    <span
                      className={`translate-x-0 inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-300 ease-in-out ${isHeatmapEnabled ? "translate-x-5" : ""}`}
                    />
                  </button>
                  <span className="">Heatmap</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setPlumeViewByMission((previous) => ({
                        ...previous,
                        [selectedMissionId]: !(
                          previous[selectedMissionId] ?? false
                        ),
                      }));
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out focus:outline-none ${isPlumeViewEnabled ? "bg-green-600" : "bg-gray-300"}`}
                  >
                    <span
                      className={`translate-x-0 inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-300 ease-in-out ${isPlumeViewEnabled ? "translate-x-5" : ""}`}
                    />
                  </button>
                  <span className="">Plume View</span>
                </div>
              </div>
              <div
                className="flex items-center gap-2 text-xs"
                style={{ color: color.textMuted }}
              >
                <button
                  onClick={playFlight}
                  type="button"
                  className="rounded px-2 py-1"
                  disabled={!selectedFlowData.length || isReplayPlaying}
                  style={{
                    opacity:
                      !selectedFlowData.length || isReplayPlaying ? 0.55 : 1,
                  }}
                >
                  {replayEndIndexRef.current >=
                  Math.max(0, selectedFlowData.length - 1) ? (
                    <RotateCcw size={20} />
                  ) : (
                    <Play size={20} />
                  )}
                </button>
                <button
                  onClick={pauseFlight}
                  type="button"
                  className="rounded px-2 py-1"
                  disabled={!isReplayPlaying}
                  style={{
                    opacity: isReplayPlaying ? 1 : 0.55,
                  }}
                >
                  <Pause size={20} />
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-1"
                  disabled={!selectedFlowData.length}
                  style={{
                    opacity: selectedFlowData.length ? 1 : 0.55,
                  }}
                  onClick={resetFlight}
                >
                  <Square size={20} />
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-md">
              <Map
                traceDataset={filteredTraceDataset}
                onScaleChange={setLegendScale}
                selectedDroneId={
                  selectedResultDroneId === ALL_DRONES_OPTION
                    ? selectedMission?.primaryDroneId || selectedDeviceId
                    : selectedResultDroneId
                }
                resultsPageMode={true}
                heatmapEnabled={isHeatmapEnabled}
                plumeViewEnabled={isPlumeViewEnabled}
                onPlumeViewAutoChange={(enabled) => {
                  if (!selectedMissionId) {
                    return;
                  }

                  setPlumeViewByMission((previous) => {
                    if ((previous[selectedMissionId] ?? false) === enabled) {
                      return previous;
                    }

                    return {
                      ...previous,
                      [selectedMissionId]: enabled,
                    };
                  });
                }}
              />
            </div>

            <div
              className="mt-3 grid grid-cols-3 gap-2 text-xs"
              style={{ color: color.textMuted }}
            >
              <div
                className="rounded-md px-3 py-2"
                style={{ backgroundColor: color.surface }}
              >
                Start: {formatTimestamp(selectedMission?.startTs)}
              </div>
              <div
                className="rounded-md px-3 py-2"
                style={{ backgroundColor: color.surface }}
              >
                End: {formatTimestamp(selectedMission?.endTs)}
              </div>
              <div
                className="rounded-md px-3 py-2"
                style={{ backgroundColor: color.surface }}
              >
                Trace points: {selectedFlowData.length}
              </div>
            </div>

            <div
              className="mt-2 grid grid-cols-2 gap-2 text-xs"
              style={{ color: color.textMuted }}
            >
              <div
                className="rounded-md px-3 py-2"
                style={{ backgroundColor: color.surface }}
              >
                Legend Min: {legendScale.lowerLimit.toFixed(2)}
              </div>
              <div
                className="rounded-md px-3 py-2"
                style={{ backgroundColor: color.surface }}
              >
                Legend Max: {legendScale.upperLimit.toFixed(2)}
              </div>
            </div>

            <div
              className="mt-2 rounded-md px-3 py-2 text-xs"
              style={{ backgroundColor: color.surface, color: color.textMuted }}
            >
              Drones: {selectedMission?.droneIds?.join(", ") || "-"} • View:{" "}
              {selectedResultDroneId}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {(selectedMission?.droneIds || []).map((droneId) => {
                const presentation = sensorModePresentation(
                  selectedMission?.droneSensorModeById?.[droneId],
                );

                return (
                  <span
                    key={`selected-${selectedMission?.id || "none"}-${droneId}`}
                    className="rounded-full px-2.5 py-1 font-semibold"
                    style={{
                      color: presentation.foreground,
                      backgroundColor: presentation.background,
                    }}
                  >
                    {droneId} • {presentation.label}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 h-full">
            <div
              className="min-h-[150px] rounded-lg border p-3"
              style={{ backgroundColor: color.card, borderColor: color.border }}
            >
              {/* <h4
                className="text-sm font-semibold"
                style={{ color: color.text }}
              >
                Method Stack
              </h4> */}
              <div className="mt-2 space-y-2">
                {analysisMethods.slice(0, 4).map((method) => (
                  <div
                    key={method.name}
                    className="rounded-md border px-2.5 py-2"
                    style={{
                      backgroundColor: color.surface,
                      borderColor: color.border,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className="text-xs font-semibold"
                        style={{ color: color.text }}
                      >
                        {method.name}
                      </p>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px]"
                        style={{
                          backgroundColor:
                            method.quality === "High"
                              ? color.greenSoft
                              : method.quality === "Medium"
                                ? "rgba(240, 193, 93, 0.16)"
                                : "rgba(239, 68, 68, 0.12)",
                          color:
                            method.quality === "High"
                              ? color.green
                              : method.quality === "Medium"
                                ? color.warning
                                : color.red,
                        }}
                      >
                        {method.quality}
                      </span>
                    </div>
                    <p
                      className="mt-1 text-[11px]"
                      style={{ color: color.textMuted }}
                    >
                      {method.estimate} • {method.uncertainty}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="min-h-[280px] rounded-lg border p-3"
              style={{ backgroundColor: color.card, borderColor: color.border }}
            >
              <h4
                className="text-sm font-semibold"
                style={{ color: color.text }}
              >
                Trace Graphs
              </h4>
              <div className="mt-2 h-full">
                {selectedSensorMode ===
                SENSOR_MODE_AERIS ? null : selectedSensorMode ===
                  SENSOR_MODE_MIXED ? (
                  <div className="space-y-3">
                    {hasDualTraceData ? (
                      <MethanePanel
                        flowData={selectedFlowData}
                        selection={selectedWindow}
                        onSelectionChange={setSelectedWindow}
                        resultsPageMode={true}
                      />
                    ) : null}
                  </div>
                ) : (
                  <MethanePanel
                    flowData={selectedFlowData}
                    selection={selectedWindow}
                    onSelectionChange={setSelectedWindow}
                    resultsPageMode={true}
                  />
                )}
              </div>
            </div>

            <div
              className="min-h-[120px]  rounded-lg border p-3"
              style={{
                backgroundColor: color.card,
                borderColor: color.border,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4
                    className="text-sm font-semibold"
                    style={{ color: color.text }}
                  >
                    Analysis Outputs
                  </h4>
                  <p
                    className="mt-0.5 text-[11px]"
                    style={{ color: color.textDim }}
                  >
                    Export mission artifacts with one tap.
                  </p>
                </div>
                <span
                  className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{
                    color: color.text,
                    backgroundColor: color.surface,
                    border: `1px solid ${color.borderStrong}`,
                  }}
                >
                  Ready
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  className="flex justify-center items-center group relative overflow-hidden rounded-xl border p-3 text-left transition-transform duration-200 hover:-translate-y-[1px]"
                  style={{
                    borderColor: "rgba(106, 214, 194, 0.45)",
                    background:
                      "linear-gradient(150deg, rgba(106, 214, 194, 0.24) 0%, rgba(106, 214, 194, 0.08) 45%, rgba(8, 15, 17, 0.6) 100%)",
                  }}
                >
                  <p
                    className="mt-1 text-sm font-semibold"
                    style={{ color: "#ffffff" }}
                  >
                    Spreadsheet
                  </p>
                </button>

                <button
                  type="button"
                  className="flex justify-center items-center group relative overflow-hidden rounded-xl border p-3 text-left transition-transform duration-200 hover:-translate-y-[1px]"
                  style={{
                    borderColor: "rgba(86, 142, 255, 0.45)",
                    background:
                      "linear-gradient(150deg, rgba(86, 142, 255, 0.25) 0%, rgba(86, 142, 255, 0.08) 45%, rgba(8, 13, 26, 0.58) 100%)",
                  }}
                >
                  <p
                    className="mt-1 text-sm font-semibold"
                    style={{ color: "#ffffff" }}
                  >
                    GeoJSON
                  </p>
                </button>

                <button
                  type="button"
                  className="flex justify-center items-center group relative overflow-hidden rounded-xl border p-3 text-left transition-transform duration-200 hover:-translate-y-[1px]"
                  style={{
                    borderColor: "rgba(253, 148, 86, 0.45)",
                    background:
                      "linear-gradient(150deg, rgba(253, 148, 86, 0.28) 0%, rgba(253, 148, 86, 0.08) 50%, rgba(10, 14, 20, 0.55) 100%)",
                  }}
                >
                  <p
                    className="mt-1 text-sm font-semibold"
                    style={{ color: "#ffffff" }}
                  >
                    Report
                  </p>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-2 h-full">
          {selectedSensorMode === SENSOR_MODE_AERIS ? (
            <AerisPanel
              flowData={selectedFlowData}
              selection={selectedWindow}
              onSelectionChange={setSelectedWindow}
              resultsPageMode={true}
              initialTracerRates={analysisTracerRates}
              onAnalyze={(tracerRates) => {
                void handleRunNotebookAnalysis(tracerRates);
              }}
              analyzeBusy={isNotebookRunning}
            />
          ) : selectedSensorMode === SENSOR_MODE_MIXED ? (
            <div className="space-y-3">
              {hasAerisTraceData ? (
                <AerisPanel
                  flowData={selectedFlowData}
                  selection={selectedWindow}
                  onSelectionChange={setSelectedWindow}
                  resultsPageMode={true}
                  initialTracerRates={analysisTracerRates}
                  onAnalyze={(tracerRates) => {
                    void handleRunNotebookAnalysis(tracerRates);
                  }}
                  analyzeBusy={isNotebookRunning}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {/* <div
          className="rounded-lg border p-3"
          style={{ backgroundColor: color.card, borderColor: color.border }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold" style={{ color: color.text }}>
              Method Comparison
            </h4>
            <span className="text-xs" style={{ color: color.textMuted }}>
              {analysisMethods.length} methods
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs" style={{ color: color.textMuted }}>
              <thead>
                <tr>
                  <th className="px-2 py-2">Method</th>
                  <th className="px-2 py-2">Estimate</th>
                  <th className="px-2 py-2">Uncertainty</th>
                  <th className="px-2 py-2">Quality</th>
                  <th className="px-2 py-2">Assumptions</th>
                </tr>
              </thead>
              <tbody>
                {analysisMethods.map((method) => (
                  <tr key={method.name} style={{ borderTop: `1px solid ${color.border}` }}>
                    <td className="px-2 py-2" style={{ color: color.text }}>
                      {method.name}
                    </td>
                    <td className="px-2 py-2">{method.estimate}</td>
                    <td className="px-2 py-2">{method.uncertainty}</td>
                    <td className="px-2 py-2">{method.quality}</td>
                    <td className="px-2 py-2">{method.assumptions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div> */}
      </section>

      {csvModalFile && (
        <CSVImportModal
          file={csvModalFile}
          devices={devices}
          sensorsMode={sensorsMode}
          preferredDroneId={selectedDeviceId}
          onClose={() => setCsvModalFile(null)}
          onComplete={(msg) => {
            setImportMessage(msg);
            window.setTimeout(() => setImportMessage(null), 4000);
            listMissions().then(setMissionsSample);
          }}
        />
      )}
    </div>
  );
}
