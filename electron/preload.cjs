const { contextBridge } = require('electron');

function parseBackendPortFromArgv() {
	const token = process.argv.find((arg) =>
		typeof arg === 'string' && arg.startsWith('--backend-port='),
	);

	if (!token) {
		return null;
	}

	const rawPort = token.split('=')[1];
	const numericPort = Number(rawPort);
	if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
		return null;
	}

	return numericPort;
}

const backendPort = parseBackendPortFromArgv();

// Expose a minimal, explicit API surface for future secure IPC additions.
contextBridge.exposeInMainWorld('electronAPI', {
	getBackendConfig: () => ({
		port: backendPort,
	}),
});
