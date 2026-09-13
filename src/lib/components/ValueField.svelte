<script lang="ts">
	import type { ArrayNode, InlineTableNode, ScalarNode, ValueNode } from '$lib/format/ast';
	import { typeLabel } from '$lib/format/ast';
	import type { Editor } from '$lib/editor.svelte';
	import Self from './ValueField.svelte';

	let { node, editor }: { node: ValueNode; editor: Editor } = $props();

	const inputId = $derived(`field-${node.id}`);

	// A plain decimal gets a real number input; hex, octal, binary and
	// underscore-grouped literals stay as text so their formatting survives.
	const isPlainDecimal = (raw: string) => /^[+-]?\d+$/.test(raw);

	/** `datetime-local` inputs need a `T`; TOML also permits a space. */
	const toInputValue = (raw: string) => raw.replace(' ', 'T');
	const fromInputValue = (value: string, original: string) =>
		original.includes(' ') ? value.replace('T', ' ') : value;

	const usesTextarea = (scalar: ScalarNode) =>
		scalar.kind === 'string' &&
		(scalar.style === 'multiline-basic' ||
			scalar.style === 'multiline-literal' ||
			String(editor.valueOf(scalar)).includes('\n'));
</script>

{#if node.kind === 'array'}
	{@const array = node as ArrayNode}
	{@const items = editor.itemsOf(array)}
	<div class="array">
		{#if items.length === 0}
			<p class="empty">Empty array</p>
		{:else}
			<ol class="items">
				{#each items as item, index (item.id)}
					<li>
						<span class="index">{index}</span>
						<div class="item-value">
							<Self node={item} {editor} />
						</div>
						<div class="item-actions">
							<button
								type="button"
								class="icon"
								title="Move up"
								aria-label="Move item {index} up"
								disabled={index === 0}
								onclick={() => editor.moveItem(array, index, -1)}>&uarr;</button
							>
							<button
								type="button"
								class="icon"
								title="Move down"
								aria-label="Move item {index} down"
								disabled={index === items.length - 1}
								onclick={() => editor.moveItem(array, index, 1)}>&darr;</button
							>
							<button
								type="button"
								class="icon danger"
								title="Remove"
								aria-label="Remove item {index}"
								onclick={() => editor.removeItem(array, index)}>&times;</button
							>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
		<button type="button" class="add" onclick={() => editor.addItem(array)}>+ Add item</button>
	</div>
{:else if node.kind === 'inline-table'}
	{@const table = node as InlineTableNode}
	<div class="inline-table">
		{#each table.entries as entry (entry.id)}
			<div class="inline-entry">
				<span class="inline-key">{entry.keyRaw}</span>
				<div class="inline-value">
					<Self node={entry.value} {editor} />
				</div>
			</div>
		{/each}
	</div>
{:else}
	{@const scalar = node as ScalarNode}
	{@const error = editor.errorOf(scalar)}
	<div class="scalar" class:edited={editor.isEdited(scalar)} class:invalid={!!error}>
		{#if scalar.kind === 'boolean'}
			<label class="toggle">
				<input
					id={inputId}
					type="checkbox"
					checked={editor.valueOf(scalar) === true}
					onchange={(e) => editor.set(scalar, e.currentTarget.checked)}
				/>
				<span class="track"><span class="thumb"></span></span>
				<span class="toggle-text">{editor.valueOf(scalar) ? 'true' : 'false'}</span>
			</label>
		{:else if scalar.kind === 'literal' && !scalar.editable}
			<!--
				A YAML alias or a tagged node. It is shown so the field is not a
				mystery, but rewriting the reference here would not change what it
				points at, so it is not an input.
			-->
			<p class="readonly">{scalar.raw}</p>
		{:else if scalar.kind === 'literal'}
			<!-- `null` and friends are edited as the literal the file holds. -->
			<input
				id={inputId}
				class="numeric"
				type="text"
				value={editor.textOf(scalar)}
				oninput={(e) => editor.set(scalar, e.currentTarget.value)}
			/>
		{:else if usesTextarea(scalar)}
			<textarea
				id={inputId}
				rows={Math.min(12, Math.max(3, editor.textOf(scalar).split('\n').length + 1))}
				value={editor.textOf(scalar)}
				oninput={(e) => editor.set(scalar, e.currentTarget.value)}
			></textarea>
		{:else if scalar.kind === 'string'}
			<input
				id={inputId}
				type="text"
				value={editor.textOf(scalar)}
				oninput={(e) => editor.set(scalar, e.currentTarget.value)}
			/>
		{:else if scalar.kind === 'integer'}
			<input
				id={inputId}
				class="numeric"
				type={isPlainDecimal(scalar.raw) ? 'number' : 'text'}
				step="1"
				value={editor.textOf(scalar)}
				oninput={(e) => editor.set(scalar, e.currentTarget.value)}
			/>
		{:else if scalar.kind === 'float'}
			<input
				id={inputId}
				class="numeric"
				type={/^[+-]?[\d._]+(e[+-]?\d+)?$/i.test(scalar.raw) && !scalar.raw.includes('_')
					? 'number'
					: 'text'}
				step="any"
				value={editor.textOf(scalar)}
				oninput={(e) => editor.set(scalar, e.currentTarget.value)}
			/>
		{:else if scalar.kind === 'datetime' && scalar.sub === 'date'}
			<input
				id={inputId}
				type="date"
				value={editor.textOf(scalar)}
				oninput={(e) => editor.set(scalar, e.currentTarget.value)}
			/>
		{:else if scalar.kind === 'datetime' && scalar.sub === 'time'}
			<input
				id={inputId}
				type="time"
				step="1"
				value={editor.textOf(scalar)}
				oninput={(e) => editor.set(scalar, e.currentTarget.value)}
			/>
		{:else if scalar.kind === 'datetime' && scalar.sub === 'local'}
			<input
				id={inputId}
				type="datetime-local"
				step="1"
				value={toInputValue(editor.textOf(scalar))}
				oninput={(e) => editor.set(scalar, fromInputValue(e.currentTarget.value, scalar.raw))}
			/>
		{:else}
			<!-- Offset date-times have no native control that keeps the zone. -->
			<input
				id={inputId}
				class="numeric"
				type="text"
				value={editor.textOf(scalar)}
				oninput={(e) => editor.set(scalar, e.currentTarget.value)}
			/>
		{/if}

		{#if error}
			<p class="error">{error}</p>
		{/if}
	</div>
{/if}

<style>
	.scalar {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	input[type='text'],
	input[type='number'],
	input[type='date'],
	input[type='time'],
	input[type='datetime-local'],
	textarea {
		width: 100%;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--input-bg);
		color: var(--fg);
		font: inherit;
		font-size: 0.875rem;
		transition: border-color 0.12s, box-shadow 0.12s;
	}

	textarea,
	.numeric {
		font-family: var(--mono);
	}

	textarea {
		resize: vertical;
		line-height: 1.5;
	}

	input:focus-visible,
	textarea:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.edited input,
	.edited textarea {
		border-color: var(--edited);
		background: var(--edited-bg);
	}

	.invalid input,
	.invalid textarea {
		border-color: var(--danger);
	}

	.error {
		margin: 0;
		color: var(--danger);
		font-size: 0.78rem;
	}

	/* A value that can be shown but not safely rewritten. */
	.readonly {
		margin: 0;
		padding: 0.4rem 0.55rem;
		border: 1px dashed var(--border);
		border-radius: var(--radius-control);
		color: var(--fg-muted);
		font-family: var(--mono);
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	/* Boolean toggle */
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		cursor: pointer;
		user-select: none;
	}

	.toggle input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.track {
		position: relative;
		width: 38px;
		height: 22px;
		border-radius: 999px;
		background: var(--border-strong);
		transition: background 0.15s;
		flex: none;
	}

	.thumb {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.15s;
	}

	.toggle input:checked + .track {
		background: var(--accent);
	}

	.toggle input:checked + .track .thumb {
		transform: translateX(16px);
	}

	.toggle input:focus-visible + .track {
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.toggle-text {
		font-family: var(--mono);
		font-size: 0.82rem;
		color: var(--fg-muted);
	}

	/* Arrays */
	.array {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.items li {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.index {
		flex: none;
		min-width: 1.6rem;
		padding-top: 0.45rem;
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 0.75rem;
		text-align: right;
	}

	.item-value {
		flex: 1;
		min-width: 0;
	}

	.item-actions {
		display: flex;
		gap: 0.15rem;
		flex: none;
	}

	.icon {
		width: 26px;
		height: 30px;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--fg-muted);
		cursor: pointer;
		font-size: 0.9rem;
		line-height: 1;
	}

	.icon:hover:not(:disabled) {
		background: var(--surface-hover);
		border-color: var(--border);
		color: var(--fg);
	}

	.icon:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.icon.danger:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
	}

	.add {
		align-self: flex-start;
		padding: 0.25rem 0.6rem;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--fg-muted);
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.add:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	.empty {
		margin: 0;
		color: var(--fg-faint);
		font-size: 0.82rem;
		font-style: italic;
	}

	/* Inline tables */
	.inline-table {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		background: var(--surface-sunken);
		min-width: 0;
	}

	.inline-entry {
		display: grid;
		grid-template-columns: minmax(5rem, 12rem) 1fr;
		gap: 0.6rem;
		align-items: center;
	}

	.inline-key {
		font-family: var(--mono);
		font-size: 0.8rem;
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}

	.inline-value {
		min-width: 0;
	}

	@media (max-width: 640px) {
		.inline-entry {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
	}
</style>
