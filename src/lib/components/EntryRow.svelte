<script lang="ts">
	import type { Entry } from '$lib/format/ast';
	import { typeLabel } from '$lib/format/ast';
	import type { Editor } from '$lib/editor.svelte';
	import ValueField from './ValueField.svelte';
	import CommentBlock from './CommentBlock.svelte';
	import { renderInline } from '$lib/markdown';
	import { prefs } from '$lib/prefs.svelte';

	let { entry, editor }: { entry: Entry; editor: Editor } = $props();

	// Arrays and inline tables need the full width; scalars sit beside the label.
	const block = $derived(entry.value.kind === 'array' || entry.value.kind === 'inline-table');
	// A trailing comment is shown with the marker its own format uses.
	const marker = $derived(editor.format.commentMarker ?? '#');
</script>

<div class="entry" class:block>
	{#each entry.detachedComments as block, i (i)}
		<CommentBlock lines={block} />
	{/each}
	{#if entry.leadingComments.length > 0}
		<CommentBlock lines={entry.leadingComments} />
	{/if}

	<div class="row">
		<label class="key" for="field-{entry.value.id}">
			<span class="key-name">{entry.keyRaw}</span>
			<span class="type">{typeLabel(entry.value)}</span>
		</label>
		<div class="value">
			<ValueField node={entry.value} {editor} />
			{#if entry.trailingComment && prefs.comments !== 'off'}
				<p class="trailing" style="--marker: '{marker} '">
					{@html renderInline(entry.trailingComment)}
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.entry {
		padding: 0.7rem 0;
		border-top: 1px solid var(--border-faint);
	}

	.entry:first-child {
		border-top: none;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(8rem, 16rem) 1fr;
		gap: 0.85rem;
		align-items: start;
	}

	.block .row {
		grid-template-columns: 1fr;
		gap: 0.35rem;
	}

	.key {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		padding-top: 0.45rem;
		min-width: 0;
		cursor: pointer;
	}

	.block .key {
		padding-top: 0;
	}

	.key-name {
		font-family: var(--mono);
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--fg);
		overflow-wrap: anywhere;
	}

	.type {
		flex: none;
		padding: 0.05rem 0.35rem;
		border-radius: var(--radius-control);
		background: var(--badge-bg);
		color: var(--badge-fg);
		font-family: var(--mono);
		font-size: 0.68rem;
		letter-spacing: 0.02em;
	}

	.value {
		min-width: 0;
	}

	.trailing {
		margin: 0.3rem 0 0;
		color: var(--comment);
		font-size: 0.78rem;
	}

	.trailing::before {
		content: var(--marker, '# ');
		opacity: 0.6;
	}

	.trailing :global(code) {
		padding: 0.05rem 0.28rem;
		border-radius: var(--radius-control);
		background: var(--badge-bg);
		color: var(--badge-fg);
		font-family: var(--mono);
		font-size: 0.92em;
	}

	.trailing :global(a) {
		color: var(--accent);
	}

	@media (max-width: 720px) {
		.row {
			grid-template-columns: 1fr;
			gap: 0.3rem;
		}

		.key {
			padding-top: 0;
		}
	}
</style>
