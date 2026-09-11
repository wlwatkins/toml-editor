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
	onMenu(handler: (action: string) => void): void;
	windowState(): Promise<WindowState>;
	windowCommand(command: WindowCommand): void;
	onWindowState(handler: (state: WindowState) => void): void;
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
