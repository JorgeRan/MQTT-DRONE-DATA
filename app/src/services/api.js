const DEFAULT_LOCAL_BACKEND_HOST = '127.0.0.1';
const DEFAULT_LOCAL_BACKEND_PORT = 3000;

const resolveBackendHost = () => {
	if (typeof window === 'undefined') {
		return DEFAULT_LOCAL_BACKEND_HOST;
	}

	const hostname = (window.location.hostname || '').trim();

	if (window.location.protocol === 'file:' || !hostname) {
		return DEFAULT_LOCAL_BACKEND_HOST;
	}

	return hostname;
};

const sleep = (delayMs) => new Promise((resolve) => {
	window.setTimeout(resolve, delayMs);
});

const backendHost = resolveBackendHost();

export const backendHttpUrl = `http://${backendHost}:${DEFAULT_LOCAL_BACKEND_PORT}`;
export const backendWsBaseUrl = `ws://${backendHost}:${DEFAULT_LOCAL_BACKEND_PORT}`;

export async function waitForBackendReady({ attempts = 20, delayMs = 500 } = {}) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const response = await fetch(`${backendHttpUrl}/api/health`, {
				cache: 'no-store',
			});

			if (response.ok) {
				return true;
			}
		} catch {
		}

		if (attempt < attempts - 1) {
			await sleep(delayMs);
		}
	}

	return false;
}

export function createTelemetryWebSocket() {
	return new WebSocket(`${backendWsBaseUrl}/ws/telemetry`);
}

const requestMeasurement = async (path, method = 'GET', body) => {
	try {
		const requestInit = {
			method,
			headers: {
				'Content-Type': 'application/json',
			},
			cache: 'no-store',
		};

		if (body !== undefined) {
			requestInit.body = JSON.stringify(body);
		}

		const response = await fetch(`${backendHttpUrl}${path}`, {
			...requestInit,
		});

		if (!response.ok) {
			return null;
		}

		const payload = await response.json();
		return {
			status: payload.status || 'idle',
			elapsedSeconds: Number(payload.elapsedSeconds || 0),
		};
	} catch {
		return null;
	}
};

export const getMeasurementStatus = () => requestMeasurement('/api/measurement/status');
export const startMeasurement = (payload) => requestMeasurement('/api/measurement/start', 'POST', payload);
export const pauseMeasurement = () => requestMeasurement('/api/measurement/pause', 'POST');
export const resumeMeasurement = () => requestMeasurement('/api/measurement/resume', 'POST');
export const stopMeasurement = () => requestMeasurement('/api/measurement/stop', 'POST');
export const updateMeasurementConfig = (payload) =>
	requestMeasurement('/api/measurement/config', 'POST', payload);

export async function saveMission(mission) {
	try {
		const response = await fetch(`${backendHttpUrl}/api/missions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			cache: 'no-store',
			body: JSON.stringify(mission),
		});

		if (!response.ok) {
			return null;
		}

		return response.json();
	} catch {
		return null;
	}
}

export async function listMissions() {
	try {
		const response = await fetch(`${backendHttpUrl}/api/missions`, {
			cache: 'no-store',
		});

		if (!response.ok) {
			return [];
		}

		const payload = await response.json();
		return Array.isArray(payload?.data) ? payload.data : [];
	} catch {
		return [];
	}
}

export async function deleteMission(missionId) {
	if (!missionId) {
		return false;
	}

	try {
		const response = await fetch(`${backendHttpUrl}/api/missions/${encodeURIComponent(missionId)}`, {
			method: 'DELETE',
			cache: 'no-store',
		});

		return response.ok;
	} catch {
		return false;
	}
}
