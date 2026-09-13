/**
 * Electron main process.
 *
 * The renderer is a static SPA served from a custom `app://` scheme rather than
 * from file:// (which breaks absolute asset paths and client-side routing) and
 * rather than from a bundled HTTP server (which would mean an open port). All
 * file access happens here, over IPC, with the same guards the web build used:
 * TOML extensions only, an mtime check against concurrent edits, and an atomic
 * write via a temp file and a rename.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const BUILD_DIR = path.join(__dirname, '..', 'build');
/**
 * Set by run.ps1 in debug mode: the window loads the Vite dev server instead of
 * the built bundle, so edits hot-reload, and DevTools opens with it.
 */
const DEV_URL = process.env.TOML_EDITOR_DEV_URL;
// Kept in step with src/lib/format/registry.ts by hand: a .cjs preload cannot
// import the TypeScript module, and this is the guard on the disk side.
const ALLOWED_EXTENSIONS = new Set(['.toml', '.tml', '.json', '.jsonc', '.yaml', '.yml']);
const SCHEME = 'app';

let mainWindow = null;
/** A path passed on the command line, handed to the renderer once it asks. */
let pendingFile = fileFromArgv(process.argv);

protocol.registerSchemesAsPrivileged([
	{
		scheme: SCHEME,
		privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
	}
]);

function fileFromArgv(argv) {
	const candidate = argv
		.slice(1)
		.find((arg) => !arg.startsWith('-') && ALLOWED_EXTENSIONS.has(path.extname(arg).toLowerCase()));
	return candidate ? path.resolve(candidate) : null;
}

/** Rejects any extension no format claims, so a typo cannot clobber a file. */
function checkPath(value) {
	if (typeof value !== 'string' || !value.trim()) throw new Error('No file path given');
	const resolved = path.resolve(value.trim());
	if (!ALLOWED_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
		throw new Error(`Only these files can be opened: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
	}
	return resolved;
}

function describe(cause, target) {
	const code = cause && cause.code;
	if (code === 'ENOENT') return `No such file: ${target}`;
	if (code === 'EACCES' || code === 'EPERM') return `Permission denied: ${target}`;
	if (code === 'EISDIR') return `That path is a directory: ${target}`;
	return cause && cause.message ? cause.message : String(cause);
}

/** Wraps a handler so the renderer always gets a result rather than a rejection. */
const handle = (channel, fn) =>
	ipcMain.handle(channel, async (_event, ...args) => {
		try {
			return { ok: true, ...(await fn(...args)) };
		} catch (cause) {
			return { ok: false, error: cause && cause.message ? cause.message : String(cause) };
		}
	});

handle('toml:read', async (target) => {
	const file = checkPath(target);
	try {
		const [text, info] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
		return { path: file, text, mtimeMs: info.mtimeMs };
	} catch (cause) {
		throw new Error(describe(cause, file));
	}
});

handle('toml:write', async (input) => {
	const file = checkPath(input && input.path);
	if (!input || typeof input.text !== 'string') throw new Error('Nothing to write');

	if (typeof input.mtimeMs === 'number' && input.mtimeMs > 0) {
		let current;
		try {
			current = await fs.stat(file);
		} catch (cause) {
			throw new Error(describe(cause, file));
		}
		if (Math.abs(current.mtimeMs - input.mtimeMs) > 1) {
			throw new Error('The file changed on disk since it was opened. Reload before saving.');
		}
	}

	const temp = `${file}.tmp-${Date.now().toString(36)}`;
	try {
		await fs.writeFile(temp, input.text, 'utf8');
		await fs.rename(temp, file);
	} catch (cause) {
		await fs.unlink(temp).catch(() => {});
		throw new Error(describe(cause, file));
	}
	const info = await fs.stat(file);
	return { path: file, mtimeMs: info.mtimeMs };
});

handle('toml:pick', async (startDir) => {
	const options = {
		title: 'Open a config file',
		properties: ['openFile'],
		filters: [
			{ name: 'Config files', extensions: ['toml', 'tml', 'json', 'jsonc', 'yaml', 'yml'] },
			{ name: 'TOML', extensions: ['toml', 'tml'] },
			{ name: 'JSON', extensions: ['json', 'jsonc'] },
			{ name: 'YAML', extensions: ['yaml', 'yml'] },
			{ name: 'All files', extensions: ['*'] }
		]
	};
	if (typeof startDir === 'string' && startDir.trim()) {
		options.defaultPath = startDir.trim();
	}
	const result = await dialog.showOpenDialog(mainWindow, options);
	if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
	return { cancelled: false, path: result.filePaths[0] };
});

handle('app:ask', async (options) => {
	const buttons = (options && options.buttons) || ['OK', 'Cancel'];
	const result = await dialog.showMessageBox(mainWindow, {
		type: (options && options.type) || 'question',
		// On Windows the caption is the app name, not this; `message` is the
		// prominent line, so that is where the actual question belongs.
		title: (options && options.title) || '',
		message: (options && options.message) || '',
		detail: (options && options.detail) || '',
		buttons,
		defaultId: (options && options.defaultId) ?? 0,
		cancelId: (options && options.cancelId) ?? buttons.length - 1,
		noLink: true
	});
	return { response: result.response };
});

ipcMain.handle('app:info', () => ({
	version: app.getVersion(),
	electron: process.versions.electron,
	chrome: process.versions.chrome,
	node: process.versions.node,
	platform: `${process.platform} ${process.arch}`
}));

ipcMain.handle('toml:initial', () => {
	const file = pendingFile;
	pendingFile = null;
	return file;
});

// ---------------------------------------------------------------------------
// Self-update, via electron-updater against the GitHub releases.
//
// publish.ps1 attaches latest.yml and the installer's blockmap to every
// release; electron-updater reads the former to learn the newest version and
// uses the latter to download only the blocks that changed. The `publish`
// block in package.json is what tells it which repository to ask, and is
// also what makes electron-builder write app-update.yml into the package.
//
// Nothing downloads without the user saying so. The start-up check is silent:
// only an actual update is shown. A check from the Help menu is `manual` and
// reports "up to date" and errors as well.
// ---------------------------------------------------------------------------

/**
 * Null where self-update can work. Unpackaged runs have nothing to update;
 * macOS builds are unsigned (no Apple developer account) and electron-updater
 * refuses to update an unsigned app there, so it is not offered at all.
 */
const UPDATES_UNSUPPORTED = !app.isPackaged
	? 'Updates are only available in the installed app, not when run from source.'
	: process.platform === 'darwin'
		? 'Updates on macOS need a signed build. Get new versions from the GitHub releases page.'
		: null;

let updateState = UPDATES_UNSUPPORTED
	? { state: 'unsupported', manual: false, reason: UPDATES_UNSUPPORTED }
	: { state: 'idle', manual: false };

/**
 * Everything the updater says goes to updater.log in the user-data folder, so
 * "it did not update" can be answered after the fact. The path is included in
 * the state so the dialog can point at it.
 */
const updateLogPath = () => path.join(app.getPath('userData'), 'updater.log');

function updateLog(level, message) {
	const line = `${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`;
	fs.appendFile(updateLogPath(), line, 'utf8').catch(() => {});
}

/** Keeps the log from growing forever: over 1 MB it is started afresh. */
async function rotateUpdateLog() {
	const file = updateLogPath();
	try {
		const info = await fs.stat(file);
		if (info.size > 1024 * 1024) await fs.rename(file, `${file}.old`);
	} catch {
		// No log yet.
	}
}

/** Replaces the state; `manual` carries over unless the caller sets it. */
function setUpdateState(next) {
	updateState = { manual: updateState.manual, logPath: updateLogPath(), ...next };
	updateLog('state', JSON.stringify(next));
	send('update:state', updateState);
}

/** Created on first use so an unpackaged run never loads the module. */
let updater = null;
function getUpdater() {
	if (updater) return updater;
	void rotateUpdateLog();
	const { autoUpdater } = require('electron-updater');
	autoUpdater.autoDownload = false;
	// Installing only ever happens through "Restart and install". A silent
	// install on quit would fail without a word for an app installed somewhere
	// that needs elevation, such as Program Files; the explicit path runs the
	// normal installer, which asks for it.
	autoUpdater.autoInstallOnAppQuit = false;
	autoUpdater.logger = {
		info: (message) => updateLog('info', message),
		warn: (message) => updateLog('warn', message),
		error: (message) => updateLog('error', message),
		debug: (message) => updateLog('debug', message)
	};
	updateLog('info', `updater created; app ${app.getVersion()}, electron ${process.versions.electron}`);

	autoUpdater.on('checking-for-update', () => setUpdateState({ state: 'checking' }));
	autoUpdater.on('update-available', (info) =>
		setUpdateState({ state: 'available', version: info.version })
	);
	autoUpdater.on('update-not-available', (info) =>
		setUpdateState({ state: 'none', version: info.version })
	);
	autoUpdater.on('download-progress', (progress) =>
		setUpdateState({
			state: 'downloading',
			version: updateState.version,
			percent: Math.round(progress.percent)
		})
	);
	autoUpdater.on('update-downloaded', (info) =>
		setUpdateState({ state: 'downloaded', version: info.version })
	);
	autoUpdater.on('error', (cause) => {
		// The silent check has nothing useful to say about a flaky network.
		if (!updateState.manual) {
			setUpdateState({ state: 'idle' });
			return;
		}
		setUpdateState({
			state: 'error',
			version: updateState.version,
			error: cause && cause.message ? cause.message : String(cause)
		});
	});
	updater = autoUpdater;
	return updater;
}

function requireUpdates() {
	if (UPDATES_UNSUPPORTED) throw new Error(UPDATES_UNSUPPORTED);
}

ipcMain.handle('update:state', () => updateState);

handle('update:check', async () => {
	if (UPDATES_UNSUPPORTED) {
		// Say so in the dialog rather than failing silently.
		setUpdateState({ ...updateState, manual: true });
		return {};
	}
	if (updateState.state === 'checking' || updateState.state === 'downloading') return {};
	if (updateState.state === 'downloaded') {
		// Already sitting on one; just say so again.
		setUpdateState({ ...updateState, manual: true });
		return {};
	}
	setUpdateState({ state: 'checking', manual: true });
	// Failures surface through the 'error' event; the promise is not awaited
	// so the menu action returns at once.
	startUpdateCheck();
	return {};
});

/**
 * Runs a check. electron-updater resolves null without emitting anything when
 * it considers itself inactive, which would otherwise leave the state parked
 * on 'checking' and every later check returning early.
 */
function startUpdateCheck() {
	getUpdater()
		.checkForUpdates()
		.then((result) => {
			if (result === null) {
				updateLog('warn', 'checkForUpdates resolved null: updater inactive');
				setUpdateState({ state: 'idle' });
			}
		})
		.catch(() => {});
}

handle('update:download', async () => {
	requireUpdates();
	if (updateState.state !== 'available') throw new Error('There is no update to download.');
	setUpdateState({ state: 'downloading', version: updateState.version, percent: 0 });
	getUpdater().downloadUpdate().catch(() => {});
	return {};
});

handle('update:install', async () => {
	requireUpdates();
	if (updateState.state !== 'downloaded') throw new Error('The update has not finished downloading.');
	// isSilent = false shows the installer; isForceRunAfter = true relaunches.
	setImmediate(() => getUpdater().quitAndInstall(false, true));
	return {};
});

/** The quiet check on start-up, a few seconds after the window is up. */
function scheduleStartupUpdateCheck() {
	if (UPDATES_UNSUPPORTED || process.env.TOML_EDITOR_NO_UPDATE_CHECK) return;
	setTimeout(() => {
		if (updateState.state !== 'idle') return;
		setUpdateState({ state: 'checking', manual: false });
		startUpdateCheck();
	}, 5000);
}

/** Serves the built SPA, falling back to index.html so routing works. */
function serveBundle() {
	protocol.handle(SCHEME, async (request) => {
		const url = new URL(request.url);
		const requested = path.normalize(path.join(BUILD_DIR, decodeURIComponent(url.pathname)));

		let target = requested;
		if (!target.startsWith(BUILD_DIR)) {
			return new Response('Forbidden', { status: 403 });
		}
		try {
			const info = await fs.stat(target);
			if (info.isDirectory()) throw new Error('directory');
		} catch {
			target = path.join(BUILD_DIR, 'index.html');
		}
		return net.fetch(pathToFileURL(target).toString());
	});
}

function send(channel, payload) {
	if (mainWindow) mainWindow.webContents.send(channel, payload);
}

/** Pushes the current window state so the title bar can draw the right icons. */
function pushWindowState() {
	if (!mainWindow) return;
	send('window:state', {
		maximized: mainWindow.isMaximized(),
		fullscreen: mainWindow.isFullScreen(),
		focused: mainWindow.isFocused()
	});
}

const currentState = () =>
	mainWindow
		? {
				maximized: mainWindow.isMaximized(),
				fullscreen: mainWindow.isFullScreen(),
				focused: mainWindow.isFocused()
			}
		: { maximized: false, fullscreen: false, focused: true };

ipcMain.handle('window:state', () => currentState());

ipcMain.on('window:command', (_event, command) => {
	if (!mainWindow) return;
	switch (command) {
		case 'minimize':
			mainWindow.minimize();
			break;
		case 'toggle-maximize':
			if (mainWindow.isMaximized()) mainWindow.unmaximize();
			else mainWindow.maximize();
			break;
		case 'close':
			mainWindow.close();
			break;
		case 'toggle-fullscreen':
			mainWindow.setFullScreen(!mainWindow.isFullScreen());
			break;
		case 'quit':
			app.quit();
			break;
		// Edit and view actions that used to come free with the native menu.
		case 'undo':
		case 'redo':
		case 'cut':
		case 'copy':
		case 'paste':
		case 'selectAll':
			mainWindow.webContents[command]();
			break;
		case 'zoom-in':
			mainWindow.webContents.setZoomLevel(Math.min(5, mainWindow.webContents.getZoomLevel() + 0.5));
			break;
		case 'zoom-out':
			mainWindow.webContents.setZoomLevel(Math.max(-5, mainWindow.webContents.getZoomLevel() - 0.5));
			break;
		case 'zoom-reset':
			mainWindow.webContents.setZoomLevel(0);
			break;
		case 'devtools':
			mainWindow.webContents.toggleDevTools();
			break;
	}
});

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 880,
		minWidth: 720,
		minHeight: 480,
		// The title bar and menu are drawn by the app. `frame: false` keeps the
		// native sizing border on Windows, so edge-drag resizing still works.
		frame: false,
		// Matches the Grid theme, so there is no white flash before paint.
		backgroundColor: '#000208',
		show: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true
		}
	});

	mainWindow.once('ready-to-show', () => mainWindow.show());
	mainWindow.on('closed', () => {
		mainWindow = null;
	});

	for (const event of [
		'maximize',
		'unmaximize',
		'enter-full-screen',
		'leave-full-screen',
		'focus',
		'blur'
	]) {
		mainWindow.on(event, pushWindowState);
	}

	// Links in comments open in the real browser, never in the app window.
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//i.test(url)) shell.openExternal(url);
		return { action: 'deny' };
	});
	mainWindow.webContents.on('will-navigate', (event, url) => {
		const internal = url.startsWith(`${SCHEME}://`) || (DEV_URL && url.startsWith(DEV_URL));
		if (!internal) {
			event.preventDefault();
			if (/^https?:\/\//i.test(url)) shell.openExternal(url);
		}
	});

	if (DEV_URL) {
		// The dev server's socket starts accepting a moment before it will answer
		// a request, so a single attempt can land on a connection-refused page
		// that never retries. Keep trying until it answers, then stop.
		let attempts = 0;
		const load = () => {
			mainWindow.loadURL(DEV_URL).catch((cause) => {
				if (!mainWindow || ++attempts > 40) {
					console.error(`Could not reach the dev server at ${DEV_URL}: ${cause.message}`);
					return;
				}
				setTimeout(load, 400);
			});
		};
		load();

		if (!process.env.TOML_EDITOR_NO_DEVTOOLS) {
			mainWindow.webContents.openDevTools({ mode: 'bottom' });
		}
		mainWindow.webContents.on('render-process-gone', (_event, details) =>
			console.error('renderer gone:', details.reason)
		);
	} else {
		mainWindow.loadURL(`${SCHEME}://bundle/`);
	}
}

// One instance only: a second launch focuses the open window and hands it the
// file it was started with.
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', (_event, argv) => {
		const file = fileFromArgv(argv);
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
			if (file) mainWindow.webContents.send('menu', `open-file:${file}`);
		}
	});

	app.whenReady().then(() => {
		serveBundle();
		// No native menu: the app draws its own.
		Menu.setApplicationMenu(null);
		createWindow();
		scheduleStartupUpdateCheck();

		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});
}
