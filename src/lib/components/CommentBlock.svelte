<script lang="ts">
	import { renderMarkdown, summarise } from '$lib/markdown';
	import { prefs } from '$lib/prefs.svelte';

	let { lines, tone = 'entry' }: { lines: string[]; tone?: 'entry' | 'section' } = $props();

	const html = $derived(renderMarkdown(lines));
	const summary = $derived(summarise(lines));

	// A one- or two-line note is not worth a disclosure control; anything longer
	// is what the collapse is for.
	const collapsible = $derived(lines.filter((line) => line.trim()).length > 2);
	const open = $derived(prefs.comments === 'full');
</script>

{#if prefs.comments !== 'off' && lines.length > 0}
	{#if collapsible}
		<details class="comment {tone}" {open}>
			<summary><span class="summary-text">{summary}</span></summary>
			<div class="markdown">{@html html}</div>
		</details>
	{:else}
		<div class="comment {tone} flat">
			<div class="markdown">{@html html}</div>
		</div>
	{/if}
{/if}

<style>
	.comment {
		margin: 0 0 0.45rem;
		padding-left: 0.7rem;
		border-left: 2px solid var(--comment-rule);
		color: var(--comment);
		font-size: 0.82rem;
		line-height: 1.55;
	}

	.comment.section {
		margin: 0.5rem 0 0;
	}

	summary {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		margin-left: -0.35rem;
		padding: 0.15rem 0.35rem;
		border-radius: var(--radius-control);
		cursor: pointer;
		list-style: none;
		color: var(--comment);
	}

	summary::-webkit-details-marker {
		display: none;
	}

	/* A disclosure triangle drawn in the theme's own accent. */
	summary::before {
		content: '';
		flex: none;
		width: 0;
		height: 0;
		border-left: 4px solid currentColor;
		border-top: 3.5px solid transparent;
		border-bottom: 3.5px solid transparent;
		transform: translateY(-1px);
		transition: transform 0.12s ease;
		opacity: 0.75;
	}

	details[open] > summary::before {
		transform: translateY(-1px) rotate(90deg);
	}

	summary:hover {
		background: var(--surface-hover);
		color: var(--fg-muted);
	}

	.summary-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Open, the summary would only repeat the heading underneath it, so it
	   collapses to the marker alone -- padded to stay easy to hit. */
	details[open] > summary .summary-text {
		display: none;
	}

	/*
	 * Rendered Markdown is injected with {@html}, which scoped styles do not
	 * reach, so these are :global and namespaced under .markdown instead.
	 */
	.markdown :global(> *:first-child) {
		margin-top: 0;
	}

	.markdown :global(> *:last-child) {
		margin-bottom: 0;
	}

	.markdown :global(p) {
		margin: 0 0 0.5rem;
	}

	.markdown :global(h1),
	.markdown :global(h2),
	.markdown :global(h3),
	.markdown :global(h4),
	.markdown :global(h5),
	.markdown :global(h6) {
		margin: 0.7rem 0 0.35rem;
		color: var(--fg-muted);
		font-family: var(--sans);
		font-weight: 600;
		line-height: 1.3;
		letter-spacing: 0.01em;
	}

	.markdown :global(h1) {
		font-size: 0.95rem;
		color: var(--accent);
	}

	.markdown :global(h2) {
		font-size: 0.88rem;
		color: var(--accent);
	}

	.markdown :global(h3),
	.markdown :global(h4),
	.markdown :global(h5),
	.markdown :global(h6) {
		font-size: 0.82rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.markdown :global(ul),
	.markdown :global(ol) {
		margin: 0 0 0.5rem;
		padding-left: 1.15rem;
	}

	.markdown :global(li) {
		margin: 0.1rem 0;
	}

	.markdown :global(code) {
		padding: 0.05rem 0.28rem;
		border-radius: var(--radius-control);
		background: var(--badge-bg);
		color: var(--badge-fg);
		font-family: var(--mono);
		font-size: 0.92em;
	}

	.markdown :global(pre) {
		margin: 0 0 0.5rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--border-faint);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		overflow-x: auto;
	}

	.markdown :global(pre code) {
		padding: 0;
		background: none;
		color: var(--fg-muted);
		font-size: 0.9em;
	}

	.markdown :global(hr) {
		margin: 0.6rem 0;
		border: none;
		border-top: 1px solid var(--comment-rule);
		opacity: 0.7;
	}

	.markdown :global(blockquote) {
		margin: 0 0 0.5rem;
		padding-left: 0.6rem;
		border-left: 2px solid var(--border);
		color: var(--fg-faint);
	}

	.markdown :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.markdown :global(strong) {
		color: var(--fg-muted);
		font-weight: 600;
	}

	.markdown :global(del) {
		opacity: 0.7;
	}
</style>
