import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Messages } from "primereact/messages";
import "primereact/resources/themes/lara-light-indigo/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import { tw, color } from "./constants/tailwind";
import { DeviceTabs } from "./components/Tabs";
import { MethanePanel } from "./components/MethanePanel";
import { Map } from "./components/Map";
import { WindPanel } from "./components/WindPanel";
import { Position } from "./components/3DPosition";
import { DataPage } from "./components/DataPage";
import { ResultsPage } from "./components/ResultsPage";
import { MeasurementControls } from "./components/MeasurementControls";
import { MissionModal } from "./components/MissionModal";

import {
  filterTraceDatasetBySelection,
  flowChartData,
  methaneTraceDataset,
} from "./data/methaneTraceData";
import logoSvg from "./assets/EERL_logo_black.svg";
import {
  backendHttpUrl,
  createTelemetryWebSocket,
  getMeasurementStatus,
  pauseMeasurement,
  resumeMeasurement,
  saveMission,
  startMeasurement,
  stopMeasurement,
  updateMeasurementConfig,
  waitForBackendReady,
} from "./services/api";

const devices = [
  {
    id: "M350",
    name: "M350",
    type: "Drone",
    aerisEnabled: false,
    status: "online",
  },
  {
    id: "M400-1",
    name: "M400-1",
    type: "Drone",
    aerisEnabled: false,
    status: "online",
  },
  {
    id: "M400-2",
    name: "M400-2",
    type: "Drone",
    aerisEnabled: false,
    status: "warning",
  },
];

const initialAerisBoxByDrone = devices.reduce((accumulator, device) => {
  accumulator[device.id] = Boolean(device.aerisEnabled);
  return accumulator;
}, {});

const fallbackMaxSelectablePpm = Math.max(
  1,
  ...flowChartData.map((point) =>
    Math.max(point.sniffer, point.purway, point.methane),
  ),
);

const buildFlowDataFromHistory = (historyRows) => {
  const sortedRows = [...historyRows].sort(
    (a, b) => new Date(a.ts || 0).getTime() - new Date(b.ts || 0).getTime(),
  );

  return sortedRows.map((row, index) => {
    const payload = row.payload || {};
    const sniffer = Number(payload.sniffer_ppm ?? row.methane ?? 0);
    const purway = Number(payload.purway_ppn ?? row.purway_ppn ?? sniffer ?? 0);
    const methane = Number.isFinite((sniffer + purway) / 2)
      ? (sniffer + purway) / 2
      : 0;
    const timestampMs = new Date(row.ts || Date.now()).getTime();

    return {
      sampleOrder: index,
      sampleIndex: index + 1,
      timestampMs,
      timestampIso: row.ts,
      time: new Date(timestampMs).toLocaleTimeString(),
      sniffer: Number.isFinite(sniffer) ? sniffer : 0,
      purway: Number.isFinite(purway) ? purway : 0,
      methane: Number.isFinite(methane) ? methane : 0,
      altitude: Number(row.altitude ?? 0),
      latitude: Number(row.latitude ?? 0),
      longitude: Number(row.longitude ?? 0),
      wind_u: Number(payload.wind_u ?? 0),
      wind_v: Number(payload.wind_v ?? 0),
      wind_w: Number(payload.wind_w ?? 0),
      distance: row.distance ?? null,
    };
  });
};

const buildFlowPointFromTelemetry = (telemetryRow, sampleOrder) => {
  const payload = telemetryRow.payload || {};
  const sniffer = Number(payload.sniffer_ppm ?? telemetryRow.methane ?? 0);
  const purway = Number(
    payload.purway_ppn ?? payload.sniffer_ppm ?? telemetryRow.methane ?? 0,
  );
  const methane = Number.isFinite((sniffer + purway) / 2)
    ? (sniffer + purway) / 2
    : 0;
  const timestampMs = new Date(telemetryRow.ts || Date.now()).getTime();

  return {
    sampleOrder,
    sampleIndex: sampleOrder + 1,
    timestampMs,
    timestampIso: telemetryRow.ts,
    time: new Date(timestampMs).toLocaleTimeString(),
    sniffer: Number.isFinite(sniffer) ? sniffer : 0,
    purway: Number.isFinite(purway) ? purway : 0,
    methane: Number.isFinite(methane) ? methane : 0,
    altitude: Number(telemetryRow.altitude ?? 0),
    latitude: Number(telemetryRow.latitude ?? 0),
    longitude: Number(telemetryRow.longitude ?? 0),
    wind_u: Number(payload.wind_u ?? 0),
    wind_v: Number(payload.wind_v ?? 0),
    wind_w: Number(payload.wind_w ?? 0),
    distance: telemetryRow.distance ?? null,
  };
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

const appendFlowPoint = (series, telemetryRow) => {
  const existingSeries = series || [];
  const nextPoint = buildFlowPointFromTelemetry(
    telemetryRow,
    existingSeries.length,
  );

  return [...existingSeries, nextPoint]
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .slice(-1000)
    .map((point, index) => ({
      ...point,
      sampleOrder: index,
      sampleIndex: index + 1,
    }));
};

const HOLD_DELAY = 2000;
const PRE_MISSION_BACKFILL_SECONDS = 120;
const MOVEMENT_THRESHOLD_METERS = 1.5;
const START_MISSION_PROMPT_COOLDOWN_MS = 45000;
const START_MISSION_PROMPT_SNOOZE_AFTER_SAVE_MS = 120000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const calculateDistanceMeters = (
  latitudeA,
  longitudeA,
  latitudeB,
  longitudeB,
) => {
  const earthRadiusMeters = 6371000;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLongitude / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
};

const filterRecentFlowData = (series, windowSeconds) => {
  const safeSeries = Array.isArray(series) ? series : [];
  if (!safeSeries.length) {
    return [];
  }

  const latestTimestampMs = safeSeries[safeSeries.length - 1]?.timestampMs;
  if (!Number.isFinite(latestTimestampMs)) {
    return safeSeries;
  }

  const windowMs = Math.max(1, Number(windowSeconds) || 0) * 1000;
  const thresholdMs = latestTimestampMs - windowMs;

  return safeSeries.filter((point) => {
    const timestampMs = Number(point?.timestampMs);
    return Number.isFinite(timestampMs) && timestampMs >= thresholdMs;
  });
};

function App() {
  const [currentView, setCurrentView] = useState("dashboard");
  const [selectedDeviceId, setSelectedDeviceId] = useState(devices[0].id);
  const [measurementStatus, setMeasurementStatus] = useState("idle");
  const [measurementElapsedSeconds, setMeasurementElapsedSeconds] = useState(0);
  const [measurementBusy, setMeasurementBusy] = useState(false);
  const [recordedFlowDataByDrone, setRecordedFlowDataByDrone] = useState({});
  const [measurementTraceByDrone, setMeasurementTraceByDrone] = useState({});
  const [liveTelemetryByDrone, setLiveTelemetryByDrone] = useState({});
  const measurementStatusRef = useRef(measurementStatus);
  const aerisBoxByDroneRef = useRef(initialAerisBoxByDrone);
  const telemetrySourceByDroneRef = useRef({});
  const lastKnownPositionByDroneRef = useRef({});
  const lastMissionPromptAtRef = useRef(0);
  const missionPromptSnoozeUntilRef = useRef(0);
  const msgs = useRef(null);
  const [aerisBoxByDrone, setAerisBoxByDrone] = useState(
    initialAerisBoxByDrone,
  );

  const [isMissionModalOpen, setIsMissionModalOpen] = useState(false);
  const [missionName, setMissionName] = useState("");
  const [deleteHoldProgress, setDeleteHoldProgress] = useState(0);
  const deleteHoldRafRef = useRef(null);

  const [telemetrySource, setTelemetrySource] = useState("MQTT");
  const [legendScale, setLegendScale] = useState({
    lowerLimit: 0,
    upperLimit: 5,
  });
  const measurementTraceData = useMemo(
    () => measurementTraceByDrone[selectedDeviceId] || [],
    [measurementTraceByDrone, selectedDeviceId],
  );

  const recordedFlowData = useMemo(
    () => recordedFlowDataByDrone[selectedDeviceId] || [],
    [recordedFlowDataByDrone, selectedDeviceId],
  );

  const liveFlowData = useMemo(() => {
    const selectedDroneData = liveTelemetryByDrone[selectedDeviceId];
    if (Array.isArray(selectedDroneData) && selectedDroneData.length > 0) {
      return selectedDroneData;
    }

    const selectedRecordedData = recordedFlowDataByDrone[selectedDeviceId];
    if (
      Array.isArray(selectedRecordedData) &&
      selectedRecordedData.length > 0
    ) {
      return selectedRecordedData;
    }

    return flowChartData;
  }, [liveTelemetryByDrone, recordedFlowDataByDrone, selectedDeviceId]);

  const isAerisBoxEnabled = aerisBoxByDrone[selectedDeviceId] ?? false;
  const getExcludedDroneIds = useCallback(
    () =>
      Object.entries(aerisBoxByDroneRef.current)
        .filter(([, isEnabled]) => Boolean(isEnabled))
        .map(([droneId]) => droneId),
    [],
  );

  const maxSelectablePpm = Math.max(
    1,
    ...liveFlowData.map((point) =>
      Math.max(point.sniffer, point.purway, point.methane),
    ),
  );
  const [selectedWindow, setSelectedWindow] = useState({
    startIndex: 0,
    endIndex: liveFlowData.length - 1,
    ppmMin: 0,
    ppmMax: fallbackMaxSelectablePpm,
  });

  useEffect(() => {
    let isCancelled = false;

    const loadHistoryForDrone = async (droneId) => {
      try {
        console.log(
          `[App] Loading history for ${droneId} from ${backendHttpUrl}/api/drones/${droneId}/history`,
        );
        const response = await fetch(
          `${backendHttpUrl}/api/drones/${droneId}/history?limit=1000`,
        );
        if (!response.ok) {
          console.warn(
            `[App] History fetch failed for ${droneId}: ${response.status} ${response.statusText}`,
          );
          return;
        }

        const payload = await response.json();
        console.log(
          `[App] Got history for ${droneId}:`,
          payload.data?.length ?? 0,
          "rows",
        );
        if (
          isCancelled ||
          !Array.isArray(payload?.data) ||
          payload.data.length === 0
        ) {
          console.warn(
            `[App] No data for ${droneId} (cancelled=${isCancelled})`,
          );
          return;
        }

        const flowData = buildFlowDataFromHistory(payload.data);
        console.log(
          `[App] Built flow data for ${droneId}:`,
          flowData.length,
          "samples",
        );
        setRecordedFlowDataByDrone((previous) => ({
          ...previous,
          [droneId]: flowData,
        }));
      } catch (error) {
        console.error(`[App] History fetch error for ${droneId}:`, error);
      }
    };

    void (async () => {
      const isBackendReady = await waitForBackendReady();
      if (!isBackendReady || isCancelled) {
        return;
      }

      devices.forEach((device) => {
        loadHistoryForDrone(device.id);
      });
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let socket;
    let reconnectTimer;

    const connectTelemetrySocket = () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }

      try {
        socket = createTelemetryWebSocket();

        socket.onerror = () => {
          socket?.close();
        };

        socket.onclose = () => {
          reconnectTimer = window.setTimeout(connectTelemetrySocket, 1000);
        };

        socket.onmessage = (event) => {
          try {
            const packet = JSON.parse(event.data);
            if (packet?.type !== "telemetry" || !packet.data?.drone_id) {
              return;
            }
            const droneId = packet.data.drone_id;
            const source =
              packet.source === "UDP"
                ? "UDP"
                : packet.source === "MQTT"
                  ? "MQTT"
                  : null;

            if (source) {
              const previousSource = telemetrySourceByDroneRef.current[droneId];
              if (previousSource && previousSource != source) {
                msgs.current?.clear();
                msgs.current?.show({
                  life: 3000,
                  severity: "info",
                  summary: "Data Source Changed",
                  detail: `${droneId} switched from ${previousSource} to ${source}.`,
                  closable: true,
                });
              }

              telemetrySourceByDroneRef.current[droneId] = source;
              setTelemetrySource(source);
            }

            setLiveTelemetryByDrone((previous) => ({
              ...previous,
              [droneId]: appendFlowPoint(previous[droneId], packet.data),
            }));

            const latitude = Number(packet.data.latitude);
            const longitude = Number(packet.data.longitude);
            const previousPosition =
              lastKnownPositionByDroneRef.current[droneId];
            const hasValidPosition =
              Number.isFinite(latitude) && Number.isFinite(longitude);
            let isDroneMoving = false;

            if (
              hasValidPosition &&
              previousPosition &&
              Number.isFinite(previousPosition.latitude) &&
              Number.isFinite(previousPosition.longitude)
            ) {
              const distanceMovedMeters = calculateDistanceMeters(
                previousPosition.latitude,
                previousPosition.longitude,
                latitude,
                longitude,
              );
              isDroneMoving = distanceMovedMeters > MOVEMENT_THRESHOLD_METERS;
            }

            if (hasValidPosition) {
              lastKnownPositionByDroneRef.current[droneId] = {
                latitude,
                longitude,
              };
            }

            if (measurementStatusRef.current === "idle" && isDroneMoving) {
              const now = Date.now();
              if (now < missionPromptSnoozeUntilRef.current) {
                return;
              }

              if (
                now - lastMissionPromptAtRef.current >=
                START_MISSION_PROMPT_COOLDOWN_MS
              ) {
                lastMissionPromptAtRef.current = now;
                msgs.current?.show({
                  life: 4500,
                  severity: "warn",
                  summary: "Drone Movement Detected",
                  detail:
                    "Drone is moving while mission is idle. Start Mission to keep a full record (only last 2 minutes are buffered).",
                  closable: true,
                });
              }
            }

            const excludedDroneIds = getExcludedDroneIds();
            const isExcludedDrone = excludedDroneIds.includes(droneId);

            if (
              measurementStatusRef.current === "running" &&
              !isExcludedDrone
            ) {
              setMeasurementTraceByDrone((previous) => ({
                ...previous,
                [droneId]: appendFlowPoint(previous[droneId], packet.data),
              }));

              setRecordedFlowDataByDrone((previous) => ({
                ...previous,
                [droneId]: appendFlowPoint(previous[droneId], packet.data),
              }));
            }
          } catch {
            // Ignore malformed websocket payloads.
          }
        };
      } catch {
        reconnectTimer = window.setTimeout(connectTelemetrySocket, 1000);
      }
    };

    void waitForBackendReady().then((isBackendReady) => {
      if (isBackendReady) {
        connectTelemetrySocket();
      }
    });

    return () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }

      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [getExcludedDroneIds]);

  useEffect(() => {
    setSelectedWindow({
      startIndex: 0,
      endIndex: Math.max(0, liveFlowData.length - 1),
      ppmMin: 0,
      ppmMax: maxSelectablePpm,
    });
  }, [liveFlowData, maxSelectablePpm]);

  const activeTraceDataset = useMemo(
    () => buildTraceDatasetFromFlowData(measurementTraceData),
    [measurementTraceData],
  );

  const filteredTraceDataset = useMemo(
    () => filterTraceDatasetBySelection(activeTraceDataset, selectedWindow),
    [activeTraceDataset, selectedWindow],
  );

  const windSamples = useMemo(
    () =>
      liveFlowData.map((point) => ({
        u: point.wind_u ?? 0,
        v: point.wind_v ?? 0,
        w: point.wind_w ?? 0,
      })),
    [liveFlowData],
  );

  const latestPointByDrone = useMemo(() => {
    const entries = {};

    devices.forEach((device) => {
      const liveSeries = liveTelemetryByDrone[device.id] || [];
      const recordedSeries = recordedFlowDataByDrone[device.id] || [];
      const activeSeries = liveSeries.length > 0 ? liveSeries : recordedSeries;
      entries[device.id] = activeSeries.length
        ? activeSeries[activeSeries.length - 1]
        : null;
    });

    return entries;
  }, [liveTelemetryByDrone, recordedFlowDataByDrone]);

  const reloadHistory = useCallback(
    async (droneId) => {
      try {
        const response = await fetch(
          `${backendHttpUrl}/api/drones/${droneId}/history?limit=1000`,
        );
        if (!response.ok) return false;

        const payload = await response.json();
        if (!Array.isArray(payload?.data) || payload.data.length === 0)
          return false;

        const flowData = buildFlowDataFromHistory(payload.data);
        const previousFlowData = recordedFlowDataByDrone[droneId] || [];
        const previousLastPoint =
          previousFlowData[previousFlowData.length - 1] || null;
        const nextLastPoint = flowData[flowData.length - 1] || null;
        const hasChanged =
          previousFlowData.length !== flowData.length ||
          previousLastPoint?.timestampIso !== nextLastPoint?.timestampIso ||
          previousLastPoint?.distance !== nextLastPoint?.distance ||
          previousLastPoint?.methane !== nextLastPoint?.methane;

        if (hasChanged) {
          setRecordedFlowDataByDrone((previous) => ({
            ...previous,
            [droneId]: flowData,
          }));
        }

        return hasChanged;
      } catch {
        return false;
      }
    },
    [recordedFlowDataByDrone],
  );

  const reloadAllHistory = useCallback(async () => {
    const refreshResults = await Promise.all(
      devices.map((device) => reloadHistory(device.id)),
    );

    return refreshResults.some(Boolean);
  }, [reloadHistory]);

  const activeDevice =
    devices.find((device) => device.id === selectedDeviceId) || devices[0];
  const activePoint = latestPointByDrone[selectedDeviceId] || null;
  const missionDroneIds = useMemo(
    () =>
      devices
        .map((device) => device.id)
        .filter(
          (droneId) => (measurementTraceByDrone[droneId] || []).length > 0,
        ),
    [devices, measurementTraceByDrone],
  );

  useEffect(() => {
    measurementStatusRef.current = measurementStatus;
  }, [measurementStatus]);

  useEffect(() => {
    aerisBoxByDroneRef.current = aerisBoxByDrone;
  }, [aerisBoxByDrone]);

  useEffect(() => {
    if (measurementStatus !== "running") {
      return;
    }

    void updateMeasurementConfig({
      excludedDroneIds: getExcludedDroneIds(),
    });
  }, [aerisBoxByDrone, getExcludedDroneIds, measurementStatus]);

  useEffect(() => {
    let cancelled = false;

    const syncMeasurementStatus = async () => {
      const status = await getMeasurementStatus();
      if (!status || cancelled) {
        return;
      }

      setMeasurementStatus(status.status);
      setMeasurementElapsedSeconds(status.elapsedSeconds);
    };

    void syncMeasurementStatus();
    const intervalId = window.setInterval(() => {
      void syncMeasurementStatus();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const handleStartMeasurement = async () => {
    setMeasurementBusy(true);
    const excludedDroneIds = new Set(getExcludedDroneIds());
    const seededTraceByDrone = devices.reduce((accumulator, device) => {
      if (excludedDroneIds.has(device.id)) {
        return accumulator;
      }

      const recentPoints = filterRecentFlowData(
        liveTelemetryByDrone[device.id],
        PRE_MISSION_BACKFILL_SECONDS,
      );

      if (recentPoints.length > 0) {
        accumulator[device.id] = recentPoints;
      }

      return accumulator;
    }, {});

    setMeasurementTraceByDrone(seededTraceByDrone);
    setMissionName("");
    const status = await startMeasurement({
      excludedDroneIds: Array.from(excludedDroneIds),
    });
    if (status) {
      setMeasurementStatus(status.status);
      setMeasurementElapsedSeconds(status.elapsedSeconds);
    }
    setMeasurementBusy(false);
  };

  const handlePauseMeasurement = async () => {
    setMeasurementBusy(true);
    const status = await pauseMeasurement();
    if (status) {
      setMeasurementStatus(status.status);
      setMeasurementElapsedSeconds(status.elapsedSeconds);
    }
    setMeasurementBusy(false);
  };

  const handleResumeMeasurement = async () => {
    setMeasurementBusy(true);
    const status = await resumeMeasurement();
    if (status) {
      setMeasurementStatus(status.status);
      setMeasurementElapsedSeconds(status.elapsedSeconds);
    }
    setMeasurementBusy(false);
  };

  const handleDiscardMeasurement = async () => {
    setMeasurementBusy(true);
    const status = await stopMeasurement();
    if (status) {
      setMeasurementStatus(status.status);
      setMeasurementElapsedSeconds(status.elapsedSeconds);
    }
    setMissionName("");
    setMeasurementBusy(false);
  };

  const startDeleteHold = () => {
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(100, (elapsed / HOLD_DELAY) * 100);
      setDeleteHoldProgress(progress);
      if (progress < 100) {
        deleteHoldRafRef.current = requestAnimationFrame(tick);
      } else {
        deleteHoldRafRef.current = null;
        setDeleteHoldProgress(0);
        void handleDiscardMeasurement();
        setIsMissionModalOpen(false);
      }
    };
    deleteHoldRafRef.current = requestAnimationFrame(tick);
  };

  const cancelDeleteHold = () => {
    if (deleteHoldRafRef.current) {
      cancelAnimationFrame(deleteHoldRafRef.current);
      deleteHoldRafRef.current = null;
    }
    setDeleteHoldProgress(0);
  };

  const handleSaveMeasurement = async () => {
    setMeasurementBusy(true);

    const missionResults = devices
      .map((device) => ({
        drone: device.id,
        data: measurementTraceByDrone[device.id] || [],
      }))
      .filter((entry) => Array.isArray(entry.data) && entry.data.length > 0);

    if (missionResults.length === 0) {
      msgs.current?.clear();
      msgs.current?.show({
        life: 3500,
        severity: "warn",
        summary: "No Mission Data",
        detail: "No telemetry was captured for any drone during this mission.",
        closable: true,
      });
      setMeasurementBusy(false);
      return;
    }

    const missionPayload = {
      id: `mission-${Date.now()}`,
      name: missionName.trim() || `Mission ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      elapsedSeconds: measurementElapsedSeconds,
      results: missionResults,
    };

    const savedMission = await saveMission(missionPayload);

    if (!savedMission) {
      msgs.current?.clear();
      msgs.current?.show({
        life: 3500,
        severity: "error",
        summary: "Mission Save Failed",
        detail: "Could not save mission data. Please try again.",
        closable: true,
      });
      setMeasurementBusy(false);
      return;
    }

    const status = await stopMeasurement();
    if (status) {
      setMeasurementStatus(status.status);
      setMeasurementElapsedSeconds(status.elapsedSeconds);
    }

    msgs.current?.clear();
    msgs.current?.show({
      life: 3000,
      severity: "success",
      summary: "Mission Saved",
      detail: `${savedMission.name} saved with ${savedMission.results.length} drone result(s).`,
      closable: true,
    });

    missionPromptSnoozeUntilRef.current =
      Date.now() + START_MISSION_PROMPT_SNOOZE_AFTER_SAVE_MS;

    setMissionName("");
    setMeasurementBusy(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f8fafc] text-slate-900 font-sans">
      {isMissionModalOpen && (
        <MissionModal onClose={() => setIsMissionModalOpen(false)}>
          <div className="flex flex-col gap-5 pr-8">
            <div className="space-y-1">
              <p
                className="text-[11px] uppercase tracking-[0.2em]"
                style={{ color: color.textDim }}
              >
                End Mission
              </p>
              <h2
                className="text-2xl font-semibold"
                style={{ color: color.text }}
              >
                Save Mission Snapshot
              </h2>
              <p className="text-sm" style={{ color: color.textMuted }}>
                Add a label before saving this mission. You can review this run
                later in results.
              </p>
            </div>

            <div
              className="rounded-xl border px-3 py-3"
              style={{
                backgroundColor: color.surface,
                borderColor: color.border,
              }}
            >
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: color.textMuted }}>
                  Drones in Mission
                </span>
                <span style={{ color: color.text }}>
                  {missionDroneIds.length > 0
                    ? `${missionDroneIds.length} (${missionDroneIds.join(", ")})`
                    : "0"}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span style={{ color: color.textMuted }}>Elapsed</span>
                <span style={{ color: color.text }}>
                  {Math.floor(measurementElapsedSeconds / 60)}m{" "}
                  {measurementElapsedSeconds % 60}s
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full">
              <input
                placeholder="Mission name"
                value={missionName}
                onChange={(event) => setMissionName(event.target.value)}
                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                style={{
                  backgroundColor: color.surface,
                  borderColor: color.border,
                  color: color.text,
                }}
              />
            </div>
            <div className="flex flex-row justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    await handleSaveMeasurement();
                    setIsMissionModalOpen(false);
                  }}
                  disabled={measurementBusy}
                  className="rounded-md px-4 py-2 text-white transition-colors disabled:opacity-60"
                  style={{ backgroundColor: color.saveGreen }}
                >
                  {measurementBusy ? "Saving..." : "Save Mission"}
                </button>

                <button
                  onClick={() => setIsMissionModalOpen(false)}
                  className="rounded-md px-4 py-2 text-white transition-colors"
                  style={{
                    backgroundColor: color.red,
                    color: "#ffffff",
                  }}
                >
                  Cancel
                </button>
              </div>
              <button
                onPointerDown={startDeleteHold}
                onPointerUp={cancelDeleteHold}
                onPointerLeave={cancelDeleteHold}
                className="relative overflow-hidden rounded-md px-4 py-2 text-white select-none"
                style={{
                  backgroundColor: "#f33232",
                  color: "#ffffff",
                  minWidth: "80px",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: "rgba(0,0,0,0.28)",
                    width: `${deleteHoldProgress}%`,
                    transition:
                      deleteHoldProgress === 0 ? "none" : "width 0.05s linear",
                  }}
                />
                <span style={{ position: "relative" }}>
                  {deleteHoldProgress > 0 ? "Hold..." : "Delete"}
                </span>
              </button>
            </div>
          </div>
        </MissionModal>
      )}
      <header
        className="flex items-center justify-between border-b px-4 py-2.5"
        style={{ backgroundColor: color.surface, borderColor: color.border }}
      >
        <div className="flex items-center gap-2">
          <img
            src={logoSvg}
            alt="EERL Logo"
            className="h-7 w-auto object-contain"
          />
          <span
            className="text-xs font-semibold tracking-[0.12em] uppercase"
            style={{ color: color.textMuted }}
          >
            Drone Monitor
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {[
            { id: "dashboard", label: "Dashboard" },
            { id: "results", label: "Analysis" },
            { id: "data", label: "Data" },
          ].map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => setCurrentView(view.id)}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor:
                  currentView === view.id ? color.orangeSoft : "transparent",
                color: currentView === view.id ? color.orange : color.textMuted,
              }}
            >
              {view.label}
            </button>
          ))}
        </nav>
      </header>

      <main
        className={`flex-1 bg-slate-100 ${color.text}`}
        style={{ backgroundColor: color.background, color: color.text }}
      >
        {currentView === "results" ? (
          <ResultsPage
            devices={devices}
            flowDataByDrone={recordedFlowDataByDrone}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
          />
        ) : currentView === "data" ? (
          <DataPage
            devices={devices}
            flowDataByDrone={recordedFlowDataByDrone}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            onImportComplete={() => reloadHistory(selectedDeviceId)}
            onRefresh={reloadAllHistory}
          />
        ) : null}
        <div className="pointer-events-none fixed top-3 left-1/2 z-50 w-full max-w-3xl -translate-x-1/2 px-3">
          <div className="pointer-events-auto rounded-xl bg-white/90 shadow-md backdrop-blur-sm">
            <Messages ref={msgs} />
          </div>
        </div>

        <section
          className={tw.shell}
          style={{ display: currentView === "dashboard" ? undefined : "none" }}
        >
          <div className="grid w-full gap-3 lg:grid-cols-[96px_minmax(0,1fr)]">
            <div className="flex h-fit flex-col gap-3">
              <DeviceTabs
                devices={devices}
                activeDeviceId={selectedDeviceId}
                onSelectDevice={setSelectedDeviceId}
                latestPointByDrone={latestPointByDrone}
              />
            </div>

            <div className="grid w-full gap-3">
              <div className="flex h-full w-full flex-row justify-between  items-center gap-3">
                <div
                  className="flex-2 rounded-lg border px-4 py-3 h-full w-full"
                  style={{
                    backgroundColor: color.card,
                    borderColor: color.border,
                  }}
                >
                  <div className="flex flex-wrap items-center h-full justify-between gap-3">
                    <div>
                      <p
                        className="text-[11px] uppercase tracking-[0.16em]"
                        style={{ color: color.green }}
                      >
                        Active Drone
                      </p>
                      <p
                        className="text-xl font-bold tracking-tight"
                        style={{ color: color.text }}
                      >
                        {activeDevice.name}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <div className="flex items-center gap-2 mr-4">
                        <button
                          onClick={() => {
                            const nextEnabled = !(
                              aerisBoxByDroneRef.current[selectedDeviceId] ??
                              false
                            );
                            const nextAerisByDrone = {
                              ...aerisBoxByDroneRef.current,
                              [selectedDeviceId]: nextEnabled,
                            };
                            aerisBoxByDroneRef.current = nextAerisByDrone;
                            setAerisBoxByDrone((previous) => ({
                              ...previous,
                              [selectedDeviceId]: nextEnabled,
                            }));

                            if (measurementStatusRef.current === "running") {
                              const excludedDroneIds = Object.entries(
                                nextAerisByDrone,
                              )
                                .filter(([, isEnabled]) => Boolean(isEnabled))
                                .map(([droneId]) => droneId);

                              void updateMeasurementConfig({
                                excludedDroneIds,
                              });
                            }
                          }}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isAerisBoxEnabled ? "bg-green-600" : "bg-gray-300"}`}
                        >
                          <span
                            className={`translate-x-0 inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out ${isAerisBoxEnabled ? "translate-x-5" : ""}`}
                          />
                        </button>
                        <span className="">Aeris Box</span>
                      </div>
                      <span
                        className="rounded-full px-3 py-1"
                        style={{
                          backgroundColor: color.surface,
                          color: color.textMuted,
                        }}
                      >
                        Type {activeDevice.type}
                      </span>
                      <span
                        className="rounded-full px-3 py-1"
                        style={{
                          backgroundColor: color.orangeSoft,
                          color: color.orange,
                        }}
                      >
                        CH4 {Number(activePoint?.methane ?? 0).toFixed(2)} ppm
                      </span>
                      <span
                        className="rounded-full px-3 py-1"
                        style={{
                          backgroundColor: color.greenSoft,
                          color: color.green,
                        }}
                      >
                        Alt {Number(activePoint?.altitude ?? 0).toFixed(1)} m
                      </span>
                    </div>
                  </div>
                </div>
                <MeasurementControls
                  status={measurementStatus}
                  elapsedSeconds={measurementElapsedSeconds}
                  isBusy={measurementBusy}
                  onStart={handleStartMeasurement}
                  onPause={handlePauseMeasurement}
                  onResume={handleResumeMeasurement}
                  onStop={() => setIsMissionModalOpen(true)}
                />
              </div>

              <div className="grid w-full gap-3 xl:grid-cols-[1.4fr_0.8fr]">
                <Map
                  traceDataset={filteredTraceDataset}
                  onScaleChange={setLegendScale}
                  selectedDroneId={selectedDeviceId}
                  resultsPageMode={false}
                />
                <Position
                  traceDataset={filteredTraceDataset}
                  lowerLimit={legendScale.lowerLimit}
                  upperLimit={legendScale.upperLimit}
                  selectedDroneId={selectedDeviceId}
                  focusCoordinates={[
                    activePoint?.longitude,
                    activePoint?.latitude,
                  ]}
                />
              </div>

              <div className="grid w-full gap-3 xl:grid-cols-[1.4fr_0.8fr]">
                <MethanePanel
                  flowData={liveFlowData}
                  selection={selectedWindow}
                  onSelectionChange={setSelectedWindow}
                  resultsPageMode={false}
                />
                <WindPanel windSamples={windSamples} />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
