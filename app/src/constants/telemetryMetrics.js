export const SENSOR_MODE_DUAL = "dual";
export const SENSOR_MODE_AERIS = "aeris";
export const SENSOR_MODE_MIXED = "mixed";
export const SENSOR_MODE_UNKNOWN = "unknown";

export const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const pickFiniteMetric = (...values) => {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const normalizeSensorMode = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (["aeris", "aeris-box", "aeris_box"].includes(normalized)) {
    return SENSOR_MODE_AERIS;
  }

  if (["dual", "sniffer-purway", "sniffer_purway", "methane"].includes(normalized)) {
    return SENSOR_MODE_DUAL;
  }

  return null;
};

export const extractTelemetryMetrics = (source) => {
  const payload = source?.payload && typeof source.payload === "object"
    ? source.payload
    : {};
  const aerisPayload =
    payload.aeris && typeof payload.aeris === "object" ? payload.aeris : {};

  const explicitSensorMode = normalizeSensorMode(
    source?.sensorMode ??
      source?.sensor_type ??
      source?.sensorType ??
      payload.sensorMode ??
      payload.sensor_type ??
      payload.sensorType,
  );

  const methane = pickFiniteMetric(
    source?.methane,
    source?.methane_concentration,
    source?.methane_ppm,
    source?.ch4,
    source?.ch4_ppm,
    payload.methane,
    payload.methane_concentration,
    payload.methane_ppm,
    payload.ch4,
    payload.ch4_ppm,
    aerisPayload.methane,
  );
  const sniffer = pickFiniteMetric(
    source?.sniffer,
    source?.sniffer_ppm,
    source?.sniffer_methane,
    payload.sniffer,
    payload.sniffer_ppm,
    payload.sniffer_methane,
  );
  const purway = pickFiniteMetric(
    source?.purway,
    source?.purway_ppm_m,
    source?.purway_ppn,
    source?.purway_ppm,
    payload.purway,
    payload.purway_ppm_m,
    payload.purway_ppn,
    payload.purway_ppm,
  );
  const acetylene = pickFiniteMetric(
    source?.acetylene,
    source?.c2h2,
    payload.acetylene,
    payload.c2h2,
    aerisPayload.acetylene,
  );
  const nitrousOxide = pickFiniteMetric(
    source?.nitrousOxide,
    source?.nitrous_oxide,
    source?.n2o,
    payload.nitrousOxide,
    payload.nitrous_oxide,
    payload.n2o,
    aerisPayload.nitrousOxide,
    aerisPayload.nitrous_oxide,
    aerisPayload.n2o,
    source?.ethylene,
    source?.c2h4,
    payload.ethylene,
    payload.c2h4,
    aerisPayload.ethylene,
  );

  const hasAerisMetrics = acetylene !== null || nitrousOxide !== null;
  const hasDualMetrics = sniffer !== null || purway !== null;

  let resolvedMethane = methane;
  if (resolvedMethane === null) {
    resolvedMethane = sniffer ?? acetylene;
  }

  const sensorMode =
    explicitSensorMode ||
    (hasAerisMetrics ? SENSOR_MODE_AERIS : SENSOR_MODE_DUAL);

  const resolvedSniffer =
    sniffer ?? (sensorMode === SENSOR_MODE_DUAL ? resolvedMethane : null);
  const resolvedPurway = purway;

  return {
    sensorMode,
    methane: resolvedMethane ?? 0,
    sniffer: resolvedSniffer,
    purway: resolvedPurway,
    acetylene,
    nitrousOxide,
  };
};

export const inferFlowSensorMode = (flowData) => {
  const sensorModes = new Set(
    (Array.isArray(flowData) ? flowData : [])
      .map((point) => extractTelemetryMetrics(point).sensorMode)
      .filter(Boolean),
  );

  if (sensorModes.size > 1) {
    return SENSOR_MODE_MIXED;
  }

  return sensorModes.values().next().value || SENSOR_MODE_UNKNOWN;
};

export const isAerisFlow = (flowData) =>
  inferFlowSensorMode(flowData) === SENSOR_MODE_AERIS;

export const getTelemetryPeakValue = (flowData) =>
  Math.max(
    1,
    ...(Array.isArray(flowData) ? flowData : []).flatMap((point) => {
      const metrics = extractTelemetryMetrics(point);
      return [
        metrics.methane,
        metrics.sniffer,
        metrics.purway,
        metrics.acetylene,
        metrics.nitrousOxide,
      ].map((value) => Number(value || 0));
    }),
  );