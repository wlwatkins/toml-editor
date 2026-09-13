<script lang="ts">
	/**
	 * Writes the open document out in another format.
	 *
	 * Unlike Save, this cannot be lossless -- the target has different syntax
	 * for everything, so the file is regenerated rather than patched. The
	 * dialog therefore leads with what that costs (from `convert`, which
	 * reports exactly what it had to give up) and shows the output in full
	 * before anything reaches the disk.
	 *
	 * It never touches the file that is open: the conversion is written to a
	 * new path, which defaults to the same name with the new extension.
	 */
	import type { Editor } from '$lib/editor.svelte';
	import { convert, retarget, type Conversion } from '$lib/format/convert';
	import { FORMATS } from '$lib/format/registry';
	import type { Format } from '$lib/format/drafts';
	import { ask, readFile, writeFile } from '$lib/platform';

	let {
		open = $bindable(false),
		editor
	}: { open?: boolean; editor: Editor } = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let target = $state<Format | null>(null);
	let destination = $state('');
	/** False once the user edits the path, so a format change stops overwriting it. */
	let autoPath = $state(true);
	let busy = $state(false);
	let result = $state<{ kind: 'error' | 'success'; text: string } | null>(null);
	let copied = $state(false);

	const targets = $derived(FORMATS.filter((format) => format.id !== editor.format.id));

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			// Start from a clean slate each time it is opened.
			target = targets[0] ?? null;
			autoPath = true;
			result = null;
			copied = false;
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	// The converted text comes from the preview, not from the file on disk, so
	// pending edits are carried across rather than silently left behind.
	const conversion = $derived.by<Conversion | null>(() => {
		if (!open || !target || !editor.doc) return null;
		try {
			return convert(editor.format.parse(editor.preview), target);
		} catch (cause) {
			return { text: '', warnings: [], error: (cause as Error).message };
		}
	});

	const suggested = $derived(
		target && editor.openPath ? retarget(editor.openPath, target) : ''
	);

	// Keep the destination in step with the chosen format until it is typed in.
	$effect(() => {
		if (autoPath) destination = suggested;
	});

	const canWrite = $derived(
		!!conversion && !conversion.error && destination.trim() !== '' && !busy
	);

	function choose(format: Format) {
		target = format;
		result = null;
		copied = false;
	}

	/** True when something is already at this path, so it can be asked about. */
	async function exists(path: string): Promise<boolean> {
		try {
			await readFile(path);
			return true;
		} catch {
			return false;
		}
	}

	async function write() {
		const text = conversion?.text;
		if (!canWrite || text === undefined) return;
		const path = destination.trim();

		busy = true;
		result = null;
		try {
			// Converting writes a whole file, so an existing one would go in its
			// entirety. Ask before that happens, the same as Close does.
			if (await exists(path)) {
				const choice = await ask({
					message: 'Replace the existing file?',
					detail: `${path} already exists. Converting will overwrite all of it.`,
					buttons: ['Replace', 'Cancel'],
					defaultId: 1,
					cancelId: 1
				});
				if (choice !== 0) return;
			}

			// mtimeMs 0: there is no read to be stale against, and the file may
			// not exist yet.
			const saved = await writeFile({ path, text, mtimeMs: 0 });
			result = { kind: 'success', text: `Wrote ${saved.path}` };
		} catch (cause) {
			result = { kind: 'error', text: (cause as Error).message };
		} finally {
			busy = false;
		}
	}

	async function copy() {
		if (!conversion?.text) return;
		try {
			await navigator.clipboard.writeText(conversion.text);
			copied = true;
		} catch (cause) {
			result = { kind: 'error', text: `Could not copy: ${(cause as Error).message}` };
		}
	}

	/** Opens what was just written. Guarded, because it replaces the open file. */
	async function openResult() {
		open = false;
		await editor.open(destination.trim());
	}
</script>

<dialog bind:this={dialog} onclose={() => (open = false)}>
	<h2>Convert to another format</h2>
	<p class="lede">
		{editor.openPath || 'This document'} is {editor.format.label}. Converting writes a
		<strong>new file</strong> and leaves this one alone.
	</p>

	<div class="formats" role="group" aria-label="Target format">
		{#each targets as format (format.id)}
			<button
				type="button"
				class:on={target?.id === format.id}
				aria-pressed={target?.id === format.id}
				onclick={() => choose(format)}
			>
				<span class="format-label">{format.label}</span>
				<span class="format-ext">{format.extensions[0]}</span>
			</button>
		{/each}
	</div>

	{#if conversion?.error}
		<p class="blocked">{conversion.error}</p>
	{:else if conversion}
		{#if editor.changeCount > 0}
			<p class="pending">
				Your {editor.changeCount} unsaved change{editor.changeCount === 1 ? '' : 's'}
				{editor.changeCount === 1 ? 'is' : 'are'} included in the conversion. The
				{editor.format.label} file still has {editor.changeCount === 1 ? 'it' : 'them'} pending.
			</p>
		{/if}

		<div class="warnings">
			<p class="warnings-head">What changes</p>
			<ul>
				{#each conversion.warnings as warning, i (i)}
					<li class={warning.level}>{warning.text}</li>
				{/each}
			</ul>
		</div>

		<label class="path">
			<span>Write to</span>
			<input
				type="text"
				spellcheck="false"
				autocomplete="off"
				value={destination}
				oninput={(event) => {
					destination = event.currentTarget.value;
					autoPath = false;
					result = null;
				}}
			/>
		</label>

		<details>
			<summary>Preview the {target?.label} output</summary>
			<pre>{conversion.text}</pre>
		</details>
	{/if}

	{#if result}
		<p class="result {result.kind}">
			{result.text}
			{#if result.kind === 'success'}
				<button type="button" class="link" onclick={openResult}>Open it</button>
			{/if}
		</p>
	{/if}

	<div class="actions">
		<button type="button" class="ghost" onclick={copy} disabled={!conversion || !!conversion.error}>
			{copied ? 'Copied' : 'Copy'}
		</button>
		<span class="spacer"></span>
		<button type="button" class="ghost" onclick={() => (open = false)}>Close</button>
		<button type="button" class="primary" onclick={write} disabled={!canWrite}>
			{busy ? 'Writing…' : 'Convert'}
		</button>
	</div>
</dialog>

<style>
	dialog {
		width: min(720px, 94vw);
		max-height: 88vh;
		padding: 1.1rem 1.2rem 1rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-panel);
		/* Opaque, like the other dialogs: the grid behind it is unreadable
		   through a translucent panel. */
		background: #07161f;
		color: var(--fg);
		box-shadow:
			0 0 0 1px rgb(34 224 255 / 0.12),
			0 24px 60px rgb(0 0 0 / 0.7);
	}

	dialog::backdrop {
		background: rgb(0 2 8 / 0.72);
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.lede {
		margin: 0.25rem 0 0.9rem;
		color: var(--fg-muted);
		font-size: 0.82rem;
		overflow-wrap: anywhere;
	}

	.lede strong {
		color: var(--fg);
	}

	.formats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.formats button {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--fg-muted);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.formats button:hover {
		background: var(--surface-hover);
		color: var(--fg);
	}

	.formats button.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}

	.format-ext {
		font-family: var(--mono);
		font-size: 0.72rem;
		opacity: 0.7;
	}

	.pending {
		margin: 0.9rem 0 0;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border-faint);
		border-radius: var(--radius-control);
		background: var(--edited-bg);
		color: var(--edited);
		font-size: 0.78rem;
	}

	.blocked {
		margin: 0.9rem 0 0;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--danger);
		border-radius: var(--radius-control);
		color: var(--danger);
		font-size: 0.82rem;
	}

	.warnings {
		margin-top: 0.9rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border-faint);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
	}

	.warnings-head {
		margin: 0 0 0.35rem;
		color: var(--fg-faint);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}

	.warnings ul {
		margin: 0;
		padding-left: 1.1rem;
	}

	.warnings li {
		margin-bottom: 0.25rem;
		font-size: 0.8rem;
		line-height: 1.45;
	}

	.warnings li.note {
		color: var(--fg-muted);
	}

	/* The ones that actually cost something read as warnings, not as notes. */
	.warnings li.loss {
		color: var(--edited);
	}

	.path {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.9rem;
	}

	.path span {
		flex: none;
		color: var(--fg-faint);
		font-size: 0.78rem;
	}

	.path input {
		flex: 1;
		min-width: 0;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		color: var(--fg);
		font-family: var(--mono);
		font-size: 0.78rem;
	}

	.path input:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: inset 0 0 0 2px var(--accent-soft);
	}

	details {
		margin-top: 0.8rem;
	}

	summary {
		color: var(--fg-faint);
		font-size: 0.78rem;
		cursor: pointer;
	}

	summary:hover {
		color: var(--accent);
	}

	summary:focus-visible {
		outline: none;
		color: var(--accent);
	}

	pre {
		max-height: 34vh;
		margin: 0.5rem 0 0;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--border-faint);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		font-family: var(--mono);
		font-size: 0.74rem;
		line-height: 1.55;
		overflow: auto;
		white-space: pre;
		tab-size: 4;
	}

	.result {
		margin: 0.8rem 0 0;
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}

	.result.success {
		color: var(--success);
	}

	.result.error {
		color: var(--danger);
	}

	.link {
		margin-left: 0.4rem;
		border: none;
		background: none;
		color: var(--accent);
		font: inherit;
		font-size: 0.8rem;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 1rem;
	}

	.spacer {
		flex: 1;
	}

	.actions button {
		padding: 0.35rem 0.9rem;
		border-radius: var(--radius-control);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.actions .ghost {
		border: 1px solid var(--border);
		background: transparent;
		color: var(--fg-muted);
	}

	.actions .ghost:hover:not(:disabled) {
		background: var(--surface-hover);
		color: var(--fg);
	}

	.actions .primary {
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--accent-fg);
		font-weight: 600;
	}

	.actions .primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.formats button:focus-visible,
	.actions button:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: inset 0 0 0 2px var(--accent);
	}
</style>
