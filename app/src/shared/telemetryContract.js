const TELEMETRY_SCHEMA_VERSION = 1;

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toStringValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
};

const pickString = (...values) => {
  for (const value of values) {
    const normalized = toStringValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const getPayloadObject = (source) =>
  source && typeof source.payload === "object" && !Array.isArray(source.payload)
    ? source.payload
    : {};

const pickFiniteNumber = (...values) => {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const normalizeTelemetryPayload = (source = {}) => {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const payload = getPayloadObject(source);
  const missionId = pickString(
    source.missionId,
    source.mission_id,
    payload.missionId,
    payload.mission_id,
  );
  const droneId = pickString(
    source.droneId,
    source.drone_id,
    payload.droneId,
    payload.drone_id,
  );
  const topic = pickString(source.topic, payload.topic);
  const ts = pickString(source.ts, source.timestamp, payload.ts, payload.timestamp);
  const latitude = pickFiniteNumber(
    source.latitude,
    source.lat,
    source.position?.latitude,
    source.position?.lat,
    payload.latitude,
    payload.lat,
    payload.position?.latitude,
    payload.position?.lat,
  );
  const longitude = pickFiniteNumber(
    source.longitude,
    source.lon,
    source.lng,
    source.position?.longitude,
    source.position?.lon,
    source.position?.lng,
    payload.longitude,
    payload.lon,
    payload.lng,
    payload.position?.longitude,
    payload.position?.lon,
    payload.position?.lng,
  );
  const altitude = pickFiniteNumber(
    source.altitude,
    source.alt,
    source.position?.altitude,
    source.position?.alt,
    payload.altitude,
    payload.alt,
    payload.position?.altitude,
    payload.position?.alt,
  );
  const targetLatitude = pickFiniteNumber(
    source.targetLatitude,
    source.target_latitude,
    source.target?.latitude,
    source.target?.lat,
    source.target_position?.latitude,
    source.target_position?.lat,
    payload.targetLatitude,
    payload.target_latitude,
    payload.target?.latitude,
    payload.target?.lat,
    payload.target_position?.latitude,
    payload.target_position?.lat,
  );
  const targetLongitude = pickFiniteNumber(
    source.targetLongitude,
    source.target_longitude,
    source.target?.longitude,
    source.target?.lon,
    source.target?.lng,
    source.target_position?.longitude,
    source.target_position?.lon,
    source.target_position?.lng,
    payload.targetLongitude,
    payload.target_longitude,
    payload.target?.longitude,
    payload.target?.lon,
    payload.target?.lng,
    payload.target_position?.longitude,
    payload.target_position?.lon,
    payload.target_position?.lng,
  );

  const sensorMode = toStringValue(
    source.sensorMode ?? source.sensor_type ?? source.sensorType ?? payload.sensorMode ?? payload.sensor_type ?? payload.sensorType,
  );

  const methane = pickFiniteNumber(source.methane, source.methane_ppm, source.ch4, payload.methane, payload.methane_ppm, payload.ch4);
  const sniffer = pickFiniteNumber(source.sniffer, source.sniffer_ppm, source.sniffer_methane, payload.sniffer, payload.sniffer_ppm, payload.sniffer_methane);
  const purway = pickFiniteNumber(source.purway, source.purway_ppm_m, source.purway_ppm, source.purway_ppn, payload.purway, payload.purway_ppm_m, payload.purway_ppm, payload.purway_ppn);
  const acetylene = pickFiniteNumber(source.acetylene, source.c2h2, payload.acetylene, payload.c2h2);
  const nitrousOxide = pickFiniteNumber(source.nitrousOxide, source.nitrous_oxide, source.n2o, payload.nitrousOxide, payload.nitrous_oxide, payload.n2o);
  const methaneValid = pickFiniteNumber(source.methane_valid, source.methaneValid, payload.methane_valid, payload.methaneValid);
  const flightStatus = pickFiniteNumber(source.flight_status, source.flightStatus, payload.flight_status, payload.flightStatus);
  const windU = pickFiniteNumber(source.wind_u, source.windU, source.wind_direction?.x, payload.wind_u, payload.windU, payload.wind_direction?.x);
  const windV = pickFiniteNumber(source.wind_v, source.windV, source.wind_direction?.y, payload.wind_v, payload.windV, payload.wind_direction?.y);
  const windW = pickFiniteNumber(source.wind_w, source.windW, source.wind_direction?.z, payload.wind_w, payload.windW, payload.wind_direction?.z);
  const battery = pickFiniteNumber(source.battery, payload.battery);
  const speed = pickFiniteNumber(source.speed, payload.speed);
  const distance = pickFiniteNumber(source.distance, payload.distance);

  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: pickString(source.eventId, source.event_id, payload.eventId, payload.event_id),
    droneId,
    drone_id: droneId,
    missionId,
    mission_id: missionId,
    topic,
    ts,
    timestamp: ts,
    latitude,
    longitude,
    altitude,
    targetLatitude,
    targetLongitude,
    target_latitude: targetLatitude,
    target_longitude: targetLongitude,
    sensorMode,
    methane,
    sniffer,
    purway,
    acetylene,
    nitrousOxide,
    methaneValid,
    methane_valid: methaneValid,
    flightStatus,
    flight_status: flightStatus,
    wind_u: windU,
    wind_v: windV,
    wind_w: windW,
    battery,
    speed,
    distance,
    payload,
  };
};

export const normalizeTelemetryPacket = (packet) => {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return null;
  }

  const telemetry = normalizeTelemetryPayload(packet.data ?? packet.telemetry ?? packet);

  if (!telemetry) {
    return null;
  }

  const schemaVersion = toFiniteNumber(
    packet.schemaVersion ?? packet.data?.schemaVersion ?? packet.telemetry?.schemaVersion,
  );

  return {
    type: toStringValue(packet.type) ?? "telemetry",
    source: toStringValue(packet.source),
    schemaVersion: schemaVersion ?? TELEMETRY_SCHEMA_VERSION,
    eventId:
      pickString(packet.eventId, packet.data?.eventId, packet.telemetry?.eventId) ??
      `${telemetry.droneId || "unknown"}:${telemetry.ts || "unknown"}:${telemetry.topic || "telemetry"}:${toStringValue(packet.source) || "unknown"}`,
    telemetry,
  };
};

export const TELEMETRY_CONTRACT = {
  schemaVersion: TELEMETRY_SCHEMA_VERSION,
};
