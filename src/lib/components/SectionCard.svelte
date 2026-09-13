<script lang="ts">
	import type { TableNode } from '$lib/format/ast';
	import type { Editor } from '$lib/editor.svelte';
	import EntryRow from './EntryRow.svelte';
	import CommentBlock from './CommentBlock.svelte';

	let { table, editor, anchor }: { table: TableNode; editor: Editor; anchor: string } = $props();

	const title = $derived(table.kind === 'root' ? 'Top level' : table.path.join('.'));
	// Nested tables sit slightly inside their parent to mirror the file's shape.
	const depth = $derived(table.kind === 'root' ? 0 : Math.min(table.path.length - 1, 3));
	// `[section]` is how TOML writes a header; in JSON and YAML a section is
	// just a nested key, so the brackets would be inventing syntax.
	const brackets = $derived(editor.format.id === 'toml');
</script>

<section id={anchor} class="card" style="--depth: {depth}">
	<header>
		<div class="title-row">
			<h2>
				{#if table.kind === 'root'}
					<span class="root-title">{title}</span>
				{:else if brackets}
					<span class="bracket">{table.kind === 'array-table' ? '[[' : '['}</span
					><span class="path">{title}</span><span class="bracket"
						>{table.kind === 'array-table' ? ']]' : ']'}</span
					>
				{:else}
					<span class="path">{title}</span>
				{/if}
			</h2>
			{#if table.kind === 'array-table'}
				<span class="index-badge">#{(table.index ?? 0) + 1}</span>
			{/if}
		</div>

		{#each table.detachedComments as block, i (i)}
			<CommentBlock lines={block} tone="section" />
		{/each}
		{#if table.leadingComments.length > 0}
			<CommentBlock lines={table.leadingComments} tone="section" />
		{/if}
		{#if table.trailingComment}
			<CommentBlock lines={[table.trailingComment]} tone="section" />
		{/if}
	</header>

	{#if table.entries.length === 0}
		<p class="empty">No keys in this section.</p>
	{:else}
		<div class="entries">
			{#each table.entries as entry (entry.id)}
				<EntryRow {entry} {editor} />
			{/each}
		</div>
	{/if}
</section>

<style>
	.card {
		margin-left: calc(var(--depth) * 1.25rem);
		padding: 1rem 1.1rem 1.1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		background: var(--surface);
		box-shadow: var(--panel-shadow, none);
		backdrop-filter: var(--panel-backdrop, none);
		scroll-margin-top: 1rem;
	}

	header {
		margin-bottom: 0.35rem;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	h2 {
		margin: 0;
		font-family: var(--mono);
		font-size: 0.95rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.bracket {
		color: var(--fg-faint);
	}

	.path {
		color: var(--accent);
	}

	.root-title {
		color: var(--fg-muted);
		font-family: var(--sans);
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.index-badge {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--badge-bg);
		color: var(--badge-fg);
		font-family: var(--mono);
		font-size: 0.7rem;
	}

	.empty {
		margin: 0.6rem 0 0;
		color: var(--fg-faint);
		font-size: 0.85rem;
		font-style: italic;
	}
</style>
