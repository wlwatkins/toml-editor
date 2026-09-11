import type { ArrayNode, ScalarNode, TomlDocument, ValueNode } from './toml/ast.ts';
import { parseToml, TomlParseError } from './toml/parse.ts';
import { applyEdits, collectEdits, makeItem } from './toml/edit.ts';
import { originalDraft, type Drafts } from './toml/serialize.ts';
import { readFile, writeFile } from './platform.ts';

export interface Status {
	kind: 'info' | 'error' | 'success';
	text: string;
}

const RECENTS_KEY = 'toml-editor:recent';
const MAX_RECENTS = 8;

/**
 * Holds the open file, its parsed document and every pending edit.
 *
 * Drafts are keyed by node id and only exist once a field is actually touched,
 * which is what lets an untouched part of the file be written back verbatim.
 */
export class Editor {
	/** Path currently typed into the location bar (not necessarily open). */
	pathInput = $state('');
	/** Path of the document that is actually open. */
	openPath = $state('');
	doc = $state.raw<TomlDocument | null>(null);
	parseError = $state<string | null>(null);
	mtimeMs = $state(0);
	busy = $state(false);
	status = $state<Status | null>(null);
	recents = $state<string[]>([]);

	scalars = $state<Record<number, string | boolean>>({});
	arrays = $state.raw<Record<number, ValueNode[]>>({});

	drafts = $derived<Drafts>({ scalars: this.scalars, arrays: this.arrays });

	plan = $derived.by(() => {
		const doc = this.doc;
		if (!doc) return { edits: [], errors: {} };
		return collectEdits(doc, this.drafts);
	});

	errorCount = $derived(Object.keys(this.plan.errors).length);
	changeCount = $derived(this.plan.edits.length);
	dirty = $derived(this.changeCount > 0 || this.errorCount > 0);
	canSave = $derived(!!this.doc && this.changeCount > 0 && this.errorCount === 0 && !this.busy);

	/** The exact text that Save would write. */
	preview = $derived.by(() => {
		const doc = this.doc;
		if (!doc) return '';
		return applyEdits(doc.source, this.plan.edits);
	});

	// ---- drafts -----------------------------------------------------------

	valueOf(node: ScalarNode): string | boolean {
		const draft = this.scalars[node.id];
		return draft === undefined ? originalDraft(node) : draft;
	}

	textOf(node: ScalarNode): string {
		return String(this.valueOf(node));
	}

	set(node: ScalarNode, value: string | boolean) {
		this.scalars[node.id] = value;
	}

	errorOf(node: ValueNode): string | undefined {
		return this.plan.errors[node.id];
	}

	/** True when this value differs from what is on disk. */
	isEdited(node: ScalarNode): boolean {
		const draft = this.scalars[node.id];
		if (draft === undefined) return false;
		return draft !== originalDraft(node);
	}

	// ---- arrays -----------------------------------------------------------

	itemsOf(node: ArrayNode): ValueNode[] {
		return this.arrays[node.id] ?? node.items;
	}

	private setItems(node: ArrayNode, items: ValueNode[]) {
		this.arrays = { ...this.arrays, [node.id]: items };
	}

	addItem(node: ArrayNode) {
		const items = this.itemsOf(node);
		this.setItems(node, [...items, makeItem(items.at(-1) ?? node.items.at(-1))]);
	}

	removeItem(node: ArrayNode, index: number) {
		const items = this.itemsOf(node);
		this.setItems(node, items.filter((_, i) => i !== index));
	}

	moveItem(node: ArrayNode, index: number, delta: number) {
		const items = [...this.itemsOf(node)];
		const target = index + delta;
		if (target < 0 || target >= items.length) return;
		[items[index], items[target]] = [items[target], items[index]];
		this.setItems(node, items);
	}

	// ---- file operations --------------------------------------------------

	revert() {
		this.scalars = {};
		this.arrays = {};
		this.status = null;
	}

	/** Puts the editor back to its empty state, discarding any pending edits. */
	close() {
		this.doc = null;
		this.openPath = '';
		this.mtimeMs = 0;
		this.scalars = {};
		this.arrays = {};
		this.parseError = null;
		this.status = null;
	}

	/** Loads a document straight from text, with no file behind it. */
	loadText(label: string, text: string) {
		this.scalars = {};
		this.arrays = {};
		this.parseError = null;
		this.openPath = label;
		this.pathInput = label;
		this.mtimeMs = 0;
		this.doc = parseToml(text);
	}

	async open(path: string) {
		const target = path.trim();
		if (!target) return;
		this.busy = true;
		this.status = null;
		try {
			const payload = await readFile(target);

			this.scalars = {};
			this.arrays = {};
			this.parseError = null;
			this.openPath = payload.path;
			this.pathInput = payload.path;
			this.mtimeMs = payload.mtimeMs;

			try {
				this.doc = parseToml(payload.text);
			} catch (cause) {
				this.doc = null;
				this.parseError =
					cause instanceof TomlParseError ? cause.message : `Could not parse file: ${String(cause)}`;
				return;
			}
			this.remember(payload.path);
			this.status = { kind: 'info', text: `Opened ${payload.path}` };
		} catch (cause) {
			this.doc = null;
			this.openPath = '';
			this.status = { kind: 'error', text: (cause as Error).message };
		} finally {
			this.busy = false;
		}
	}

	async reload() {
		if (this.openPath) await this.open(this.openPath);
	}

	async save() {
		const doc = this.doc;
		if (!doc || !this.canSave) return;
		const text = this.preview;
		this.busy = true;
		try {
			const payload = await writeFile({
				path: this.openPath,
				text,
				mtimeMs: this.mtimeMs
			});

			const written = this.changeCount;
			// Re-parse from the saved text so spans line up with the new file.
			this.doc = parseToml(text);
			this.scalars = {};
			this.arrays = {};
			this.mtimeMs = payload.mtimeMs;
			this.status = {
				kind: 'success',
				text: `Saved ${written} change${written === 1 ? '' : 's'} to ${payload.path}`
			};
		} catch (cause) {
			this.status = { kind: 'error', text: (cause as Error).message };
		} finally {
			this.busy = false;
		}
	}

	// ---- recent files -----------------------------------------------------

	loadRecents() {
		try {
			const raw = localStorage.getItem(RECENTS_KEY);
			this.recents = raw ? (JSON.parse(raw) as string[]) : [];
		} catch {
			this.recents = [];
		}
	}

	private remember(path: string) {
		this.recents = [path, ...this.recents.filter((p) => p !== path)].slice(0, MAX_RECENTS);
		try {
			localStorage.setItem(RECENTS_KEY, JSON.stringify(this.recents));
		} catch {
			// Storage can be unavailable (private window, blocked site data); the
			// editor works fine without a recent-files list.
		}
	}

	forgetRecents() {
		this.recents = [];
		try {
			localStorage.removeItem(RECENTS_KEY);
		} catch {
			// ignored, see remember()
		}
	}
}
