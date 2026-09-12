/**
 * The one place that knows whether we are running inside Electron or in a
 * browser against the dev server.
 *
 * In the packaged app there is no HTTP server at all: the page is served from
 * a custom protocol and file access goes over IPC to the main process. During
 * `npm run dev` the same calls fall back to the SvelteKit `/api` routes, so the
 * UI can be worked on in a normal browser.
 */

export interface OpenedFile {
	path: string;
	text: string;
	mtimeMs: number;
}

export interface SavedFile {
	path: string;
	mtimeMs: number;
}

export interface PickResult {
	cancelled: boolean;
	path?: string;
}

/** What the preload script exposes. Every call resolves, never rejects. */
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

interface DesktopBridge {
	readFile(path: string): Promise<Result<OpenedFile>>;
	writeFile(input: { path: string; text: string; mtimeMs: number }): Promise<Result<SavedFile>>;
	pickFile(dir: string): Promise<Result<PickResult>>;
	initialFile(): Promise<string | null>;
	appInfo(): Promise<AppInfo>;
	ask(options: AskOptions): Promise<Result<{ response: number }>>;
	onMenu(handler: (action: string) => void): void;
	updateState(): Promise<UpdateState>;
	checkForUpdates(): Promise<Result<object>>;
	downloadUpdate(): Promise<Result<object>>;
	installUpdate(): Promise<Result<object>>;
	onUpdateState(handler: (state: UpdateState) => void): void;
	windowState(): Promise<WindowState>;
	windowCommand(command: WindowCommand): void;
	onWindowState(handler: (state: WindowState) => void): void;
}

export interface AskOptions {
	/** The question itself. This is the prominent line in the dialog. */
	message: string;
	detail?: string;
	buttons: string[];
	defaultId?: number;
	/** Index returned when the dialog is dismissed with Escape. */
	cancelId?: number;
}

export interface AppInfo {
	version: string;
	repository: string;
	/** Only present in the desktop app. */
	electron?: string;
	chrome?: string;
	node?: string;
	platform?: string;
}

export interface WindowState {
	maximized: boolean;
	fullscreen: boolean;
	focused: boolean;
}

/**
 * Where the self-updater is. `manual` says whether the user asked for the
 * check, which decides whether "you are up to date" and errors are worth
 * showing; the automatic check on start-up stays silent unless it finds one.
 */
export interface UpdateState {
	state:
		| 'unsupported'
		| 'idle'
		| 'checking'
		| 'available'
		| 'none'
		| 'downloading'
		| 'downloaded'
		| 'error';
	manual: boolean;
	/** The version on offer, once one is known. */
	version?: string;
	/** Download progress, 0 to 100. */
	percent?: number;
	error?: string;
	/** Why updates are unsupported here (browser, or an unpackaged app). */
	reason?: string;
}

/** Everything the custom title bar can ask the window to do. */
export type WindowCommand =
	| 'minimize'
	| 'toggle-maximize'
	| 'close'
	| 'toggle-fullscreen'
	| 'quit'
	| 'undo'
	| 'redo'
	| 'cut'
	| 'copy'
	| 'paste'
	| 'selectAll'
	| 'zoom-in'
	| 'zoom-out'
	| 'zoom-reset'
	| 'devtools';

declare global {
	interface Window {
		tomlEditor?: DesktopBridge;
	}
}

const bridge = (): DesktopBridge | undefined =>
	typeof window === 'undefined' ? undefined : window.tomlEditor;

/** True when running as the desktop app rather than in a browser tab. */
export const isDesktop = () => bridge() !== undefined;

function unwrap<T>(result: Result<T>): T {
	if (!result.ok) throw new Error(result.error);
	const { ok, ...rest } = result;
	void ok;
	return rest as T;
}

/** Turns a non-2xx JSON response from the dev server into a thrown Error. */
async function fromResponse<T>(response: Response): Promise<T> {
	const payload = await response.json();
	if (!response.ok) {
		throw new Error(payload?.message ?? `Request failed (${response.status})`);
	}
	return payload as T;
}

export async function readFile(path: string): Promise<OpenedFile> {
	const desktop = bridge();
	if (desktop) return unwrap(await desktop.readFile(path));
	return fromResponse(await fetch(`/api/file?path=${encodeURIComponent(path)}`));
}

export async function writeFile(input: {
	path: string;
	text: string;
	mtimeMs: number;
}): Promise<SavedFile> {
	const desktop = bridge();
	if (desktop) return unwrap(await desktop.writeFile(input));
	return fromResponse(
		await fetch('/api/file', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		})
	);
}

export async function pickFile(dir: string): Promise<PickResult> {
	const desktop = bridge();
	if (desktop) return unwrap(await desktop.pickFile(dir));
	return fromResponse(await fetch(`/api/pick?dir=${encodeURIComponent(dir)}`));
}

/**
 * A file the app was launched with -- `toml-editor config.toml`, or a .toml
 * dropped onto the app. Null in the browser.
 */
export async function initialFile(): Promise<string | null> {
	const desktop = bridge();
	return desktop ? desktop.initialFile() : null;
}

/**
 * Subscribes to menu actions sent by the main process. A no-op in the browser.
 *
 * The callback is wrapped so nothing is ever returned across the context
 * bridge: a handler whose last expression is an assignment returns that value,
 * and if it happens to be a Svelte `$state` proxy, Electron cannot structured-
 * clone it and throws on every event.
 */
export function onMenu(handler: (action: string) => void) {
	bridge()?.onMenu((action) => {
		handler(action);
	});
}

/**
 * Version and build details for the About box. The version is baked in at build
 * time so this works in the browser too; the desktop app adds its runtime
 * versions on top.
 */
export async function appInfo(): Promise<AppInfo> {
	const base: AppInfo = { version: __APP_VERSION__, repository: __APP_REPOSITORY__ };
	const desktop = bridge();
	if (!desktop) return base;
	try {
		return { ...base, ...(await desktop.appInfo()) };
	} catch {
		return base;
	}
}

/**
 * Puts a question with several answers and returns the index of the one chosen.
 * The desktop app gets a native message box; a browser has only a two-way
 * confirm, so the buttons are offered in order until one is accepted.
 */
export async function ask(options: AskOptions): Promise<number> {
	const cancelId = options.cancelId ?? options.buttons.length - 1;
	const desktop = bridge();

	if (!desktop) {
		for (let i = 0; i < options.buttons.length; i++) {
			if (i === cancelId) continue;
			const label = options.buttons[i];
			const text = [options.message, options.detail, `OK = ${label}`]
				.filter(Boolean)
				.join('\n\n');
			if (window.confirm(text)) return i;
		}
		return cancelId;
	}

	try {
		return unwrap(await desktop.ask(options)).response;
	} catch {
		return cancelId;
	}
}

const NO_UPDATES: UpdateState = {
	state: 'unsupported',
	manual: false,
	reason: 'Updates are only available in the installed desktop app.'
};

/** The updater's current state. Unsupported in a browser. */
export async function updateState(): Promise<UpdateState> {
	const desktop = bridge();
	if (!desktop) return NO_UPDATES;
	try {
		return await desktop.updateState();
	} catch {
		return NO_UPDATES;
	}
}

/**
 * Asks GitHub whether a newer release exists. Progress arrives through
 * onUpdateState(); the call itself only kicks it off.
 */
export async function checkForUpdates(): Promise<void> {
	const desktop = bridge();
	if (desktop) unwrap(await desktop.checkForUpdates());
}

export async function downloadUpdate(): Promise<void> {
	const desktop = bridge();
	if (desktop) unwrap(await desktop.downloadUpdate());
}

/** Quits and runs the downloaded installer. Only valid once state is 'downloaded'. */
export async function installUpdate(): Promise<void> {
	const desktop = bridge();
	if (desktop) unwrap(await desktop.installUpdate());
}

/** Updater state changes. Wrapped to return nothing; see onMenu(). */
export function onUpdateState(handler: (state: UpdateState) => void) {
	bridge()?.onUpdateState((state) => {
		handler(state);
	});
}

export async function windowState(): Promise<WindowState> {
	const desktop = bridge();
	if (!desktop) return { maximized: false, fullscreen: false, focused: true };
	return desktop.windowState();
}

export function windowCommand(command: WindowCommand) {
	bridge()?.windowCommand(command);
}

/** Window state changes. Wrapped to return nothing; see onMenu(). */
export function onWindowState(handler: (state: WindowState) => void) {
	bridge()?.onWindowState((state) => {
		handler(state);
	});
}
