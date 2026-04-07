import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { color } from "../constants/tailwind";
import { Map } from "./Map";
import { MethanePanel } from "./MethanePanel";
import { filterTraceDatasetBySelection } from "../data/methaneTraceData";
import { deleteMission, listMissions } from "../services/api";
import { SquarePen, Trash } from 'lucide-react';


const ALL_DRONES_OPTION = "ALL";
const REPLAY_STEP_MS = 180;

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
    .map((point) => ({
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
        methane: point.methane,
        detected: point.methane > 0,
        pointColor: point.methane > 0 ? "#4ade80" : "#64748b",
      },
    })),
});

const normalizeMissionPoint = (point, index, droneId) => {
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

  const sniffer = Number(
    point.sniffer ?? point.payload?.sniffer_ppm ?? point.methane ?? 0,
  );
  const purway = Number(
    point.purway ??
      point.payload?.purway_ppn ??
      point.payload?.purway_ppm ??
      point.methane ??
      0,
  );
  const methane = Number.isFinite(Number(point.methane))
    ? Number(point.methane)
    : Number.isFinite((sniffer + purway) / 2)
      ? (sniffer + purway) / 2
      : 0;

  return {
    sampleOrder: index,
    sampleIndex: index + 1,
    timestampMs,
    timestampIso,
    time: new Date(timestampMs).toLocaleTimeString(),
    altitude: Number(point.altitude ?? 0),
    latitude: Number(point.latitude ?? 0),
    longitude: Number(point.longitude ?? 0),
    sniffer: Number.isFinite(sniffer) ? sniffer : 0,
    purway: Number.isFinite(purway) ? purway : 0,
    methane: Number.isFinite(methane) ? methane : 0,
    droneId,
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

export function ResultsPage({ selectedDeviceId, onSelectDevice }) {
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
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const replayTimerRef = useRef(null);
  const replayEndIndexRef = useRef(0);

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

  const maxSelectablePpm = Math.max(
    1,
    ...selectedFlowData.map((point) =>
      Math.max(point.sniffer || 0, point.purway || 0, point.methane || 0),
    ),
  );
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
    const score = Math.round((sampleCoverage * 0.65 + plumeCoverage * 0.35) * 100);
    return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  }, [selectedFlowData.length, thresholdSamples]);

  const unifiedEmissionRate = useMemo(() => {
    if (!selectedMission?.flowData?.length) {
      return 0;
    }

    const averageFluxProxy = averageMethane * Math.max(1, selectedMission.flowData.length / 80);
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

  return (
    <div className="grid h-full w-full gap-4 p-3 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside
        className="rounded-lg border p-3"
        style={{ backgroundColor: color.card, borderColor: color.border }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex flex-row gap-3">
            <h2 className="text-sm font-semibold" style={{ color: color.text }}>
            Saved Missions
          </h2>
          <span
            className="rounded-full px-2 py-0.5 text-xs"
            style={{ backgroundColor: color.surface, color: color.textMuted }}
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
                    onSelectDevice?.(mission.primaryDroneId || selectedDeviceId);
                  }}
                  className="relative z-10 flex w-full flex-row rounded-md border px-3 py-2 text-left"
                  style={{
                    borderColor: isActive ? color.orange : color.border,
                    backgroundColor: isActive ? color.orangeSoft : color.surface,
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
                      style={{ color: isActive ? color.orange : color.textDim }}
                    >
                      {mission.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: color.textMuted }}>
                    {mission.sampleCount} samples across {mission.droneIds.length}{" "}
                    drone(s)
                  </p>
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
                    transform: isDeleteMode ? "translateX(0)" : "translateX(100%)",
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
{selectedMission?.sampleCount || 0} samples across {selectedMission?.droneIds.length || 0}{" "}
                  drone(s)              </p>
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
              >
                Run Analysis
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border px-3 py-3" style={{ backgroundColor: color.card, borderColor: color.border }}>
            <p className="text-[11px] uppercase tracking-[0.12em]" style={{ color: color.textDim }}>
              Unified Emission
            </p>
            <p className="mt-1 text-xl font-semibold" style={{ color: color.text }}>
              {formatCompactValue(unifiedEmissionRate, 3)} kg/h
            </p>
          </div>
          <div className="rounded-lg border px-3 py-3" style={{ backgroundColor: color.card, borderColor: color.border }}>
            <p className="text-[11px] uppercase tracking-[0.12em]" style={{ color: color.textDim }}>
              Confidence
            </p>
            <p className="mt-1 text-xl font-semibold" style={{ color: color.text }}>
              {confidenceScore}%
            </p>
          </div>
          <div className="rounded-lg border px-3 py-3" style={{ backgroundColor: color.card, borderColor: color.border }}>
            <p className="text-[11px] uppercase tracking-[0.12em]" style={{ color: color.textDim }}>
              Avg Methane
            </p>
            <p className="mt-1 text-xl font-semibold" style={{ color: color.text }}>
              {averageMethane.toFixed(2)} ppm
            </p>
          </div>
          <div className="rounded-lg border px-3 py-3" style={{ backgroundColor: color.card, borderColor: color.border }}>
            <p className="text-[11px] uppercase tracking-[0.12em]" style={{ color: color.textDim }}>
              Threshold Samples
            </p>
            <p className="mt-1 text-xl font-semibold" style={{ color: color.text }}>
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
              <div className="flex items-center gap-2 mr-4">
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
                    backgroundColor: color.surface,
                    opacity:
                      !selectedFlowData.length || isReplayPlaying ? 0.55 : 1,
                  }}
                >
                  {replayEndIndexRef.current >=
                  Math.max(0, selectedFlowData.length - 1)
                    ? "Replay"
                    : "Play"}
                </button>
                <button
                  onClick={pauseFlight}
                  type="button"
                  className="rounded px-2 py-1"
                  disabled={!isReplayPlaying}
                  style={{
                    backgroundColor: color.surface,
                    opacity: isReplayPlaying ? 1 : 0.55,
                  }}
                >
                  Pause
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-1"
                  disabled={!selectedFlowData.length}
                  style={{
                    backgroundColor: color.surface,
                    opacity: selectedFlowData.length ? 1 : 0.55,
                  }}
                  onClick={resetFlight}
                >
                  Reset
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
          </div>

          <div className="grid gap-3 h-full">
            <div
              className="min-h-[150px] rounded-lg border p-3"
              style={{ backgroundColor: color.card, borderColor: color.border }}
            >
              <h4
                className="text-sm font-semibold"
                style={{ color: color.text }}
              >
                Method Stack
              </h4>
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
                      <p className="text-xs font-semibold" style={{ color: color.text }}>
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
                    <p className="mt-1 text-[11px]" style={{ color: color.textMuted }}>
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
                <MethanePanel
                  flowData={selectedFlowData}
                  selection={selectedWindow}
                  onSelectionChange={setSelectedWindow}
                  resultsPageMode={true}
                />
              </div>
            </div>

            <div
              className="min-h-[100px] rounded-lg border p-3"
              style={{ backgroundColor: color.card, borderColor: color.border }}
            >
              <h4
                className="text-sm font-semibold"
                style={{ color: color.text }}
              >
                Analysis Outputs
              </h4>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-xs"
                  style={{
                    backgroundColor: color.surface,
                    color: color.textMuted,
                  }}
                >
                  CSV Report
                </button>
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-xs"
                  style={{
                    backgroundColor: color.surface,
                    color: color.textMuted,
                  }}
                >
                  GeoJSON
                </button>
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-xs"
                  style={{
                    backgroundColor: color.surface,
                    color: color.textMuted,
                  }}
                >
                  Method Audit
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
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
        </div>
      </section>
    </div>
  );
}
