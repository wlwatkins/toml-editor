/**
 * The only bridge between the page and the main process.
 *
 * Nothing from Node is handed to the renderer -- just these thin wrappers over
 * named IPC channels. The page runs with contextIsolation on and sandbox on, so
 * this is its entire privileged surface. `windowCommand` takes a plain string
 * that the main process matches against a fixed list, never a function to call.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tomlEditor', {
	readFile: (path) => ipcRenderer.invoke('toml:read', path),
	writeFile: (input) => ipcRenderer.invoke('toml:write', input),
	pickFile: (dir) => ipcRenderer.invoke('toml:pick', dir),
	initialFile: () => ipcRenderer.invoke('toml:initial'),
	appInfo: () => ipcRenderer.invoke('app:info'),
	ask: (options) => ipcRenderer.invoke('app:ask', options),
	onMenu: (handler) => {
		ipcRenderer.on('menu', (_event, action) => handler(action));
	},

	windowState: () => ipcRenderer.invoke('window:state'),
	windowCommand: (command) => ipcRenderer.send('window:command', String(command)),
	onWindowState: (handler) => {
		ipcRenderer.on('window:state', (_event, state) => handler(state));
	}
});
