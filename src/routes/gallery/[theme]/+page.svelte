<script lang="ts">
	import '$lib/themes.css';
	import { page } from '$app/state';
	import { themes, themeById } from '$lib/themes';
	import ThemePreview from '$lib/components/ThemePreview.svelte';

	const id = $derived(page.params.theme ?? '');
	const theme = $derived(themeById(id));
	const index = $derived(themes.findIndex((t) => t.id === id));
	const previous = $derived(index > 0 ? themes[index - 1] : themes[themes.length - 1]);
	const next = $derived(themes[(index + 1) % themes.length]);
</script>

<svelte:head>
	<title>{theme ? `${theme.name} - theme preview` : 'Unknown theme'}</title>
</svelte:head>

{#if !theme}
	<div class="missing">
		<h1>No theme called &ldquo;{id}&rdquo;</h1>
		<p><a href="/gallery">Back to the gallery</a></p>
	</div>
{:else}
	<div class="chrome">
		<a class="back" href="/gallery">&larr; All themes</a>
		<div class="heading">
			<h1>{theme.name}</h1>
			<p>{theme.tagline}</p>
		</div>
		<div class="flip">
			<a href="/gallery/{previous.id}" title={previous.name}>&larr; {previous.name}</a>
			<a href="/gallery/{next.id}" title={next.name}>{next.name} &rarr;</a>
		</div>
	</div>

	<p class="blurb">{theme.blurb}</p>

	<p class="hint">
		This is the real editor, with live fields &mdash; type in them, toggle things, add an array item.
		Nothing here writes to disk.
	</p>

	<div class="frame">
		{#key theme.id}
			<ThemePreview themeId={theme.id} />
		{/key}
	</div>
{/if}

<style>
	.chrome {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		max-width: 1180px;
		margin: 0 auto;
		padding: 1.5rem 1.5rem 0;
	}

	.back {
		color: var(--fg-muted);
		font-size: 0.85rem;
		text-decoration: none;
		white-space: nowrap;
	}

	.back:hover {
		color: var(--accent);
	}

	.heading {
		flex: 1;
		min-width: 0;
	}

	.heading h1 {
		margin: 0;
		font-size: 1.35rem;
	}

	.heading p {
		margin: 0;
		color: var(--fg-faint);
		font-size: 0.82rem;
	}

	.flip {
		display: flex;
		gap: 0.75rem;
		flex: none;
	}

	.flip a {
		color: var(--fg-muted);
		font-size: 0.8rem;
		text-decoration: none;
		white-space: nowrap;
	}

	.flip a:hover {
		color: var(--accent);
	}

	.blurb,
	.hint {
		max-width: 1180px;
		margin: 0.85rem auto 0;
		padding: 0 1.5rem;
		color: var(--fg-muted);
		font-size: 0.9rem;
	}

	.hint {
		margin-top: 0.4rem;
		color: var(--fg-faint);
		font-size: 0.8rem;
	}

	.frame {
		max-width: 1180px;
		margin: 1.25rem auto 3rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
	}

	.missing {
		max-width: 30rem;
		margin: 5rem auto;
		text-align: center;
	}

	@media (max-width: 720px) {
		.chrome {
			flex-wrap: wrap;
			gap: 0.75rem;
		}
	}
</style>
