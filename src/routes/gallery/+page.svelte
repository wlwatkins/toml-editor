<script lang="ts">
	import { themes } from '$lib/themes';
</script>

<svelte:head>
	<title>Theme gallery</title>
</svelte:head>

<div class="page">
	<header>
		<p class="eyebrow">TOML Editor</p>
		<h1>Six ways this could look</h1>
		<p class="lede">
			Each one is a complete dark theme, not a colour swap. Open any of them to see the real editor
			&mdash; every field type, comments, sections &mdash; rendered in that style. Tell me which to
			apply.
		</p>
	</header>

	<ul class="grid">
		{#each themes as theme (theme.id)}
			<li>
				<a class="card" href="/gallery/{theme.id}">
					<span
						class="preview"
						style="--c0: {theme.swatch[0]}; --c1: {theme.swatch[1]}; --c2: {theme.swatch[2]}"
						aria-hidden="true"
					>
						<span class="mini-bar"></span>
						<span class="mini-body">
							<span class="mini-row"><span class="mini-key"></span><span class="mini-input"></span></span>
							<span class="mini-row"><span class="mini-key"></span><span class="mini-input wide"></span></span>
							<span class="mini-row"><span class="mini-key"></span><span class="mini-pill"></span></span>
						</span>
					</span>
					<span class="body">
						<span class="title-row">
							<h2>{theme.name}</h2>
							<span class="tagline">{theme.tagline}</span>
						</span>
						<p>{theme.blurb}</p>
						<span class="cta">See it &rarr;</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
</div>

<style>
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 3rem 1.5rem 4rem;
	}

	.eyebrow {
		margin: 0 0 0.4rem;
		color: var(--fg-faint);
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	h1 {
		margin: 0 0 0.6rem;
		font-size: 1.9rem;
		letter-spacing: -0.01em;
	}

	.lede {
		margin: 0 0 2.5rem;
		max-width: 42rem;
		color: var(--fg-muted);
		font-size: 1rem;
	}

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 1.25rem;
	}

	.card {
		display: flex;
		flex-direction: column;
		height: 100%;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		overflow: hidden;
		text-decoration: none;
		color: inherit;
		transition:
			border-color 0.15s,
			transform 0.15s;
	}

	.card:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
	}

	/* A tiny abstraction of the editor, painted in the theme's own colours. */
	.preview {
		display: block;
		padding: 0.75rem;
		background: var(--c0);
		border-bottom: 1px solid var(--border);
	}

	.mini-bar {
		display: block;
		height: 10px;
		margin-bottom: 0.6rem;
		border-radius: 3px;
		background: var(--c2);
	}

	.mini-body {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.mini-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.mini-key {
		width: 28%;
		height: 7px;
		border-radius: 2px;
		background: var(--c1);
		opacity: 0.75;
	}

	.mini-input {
		flex: 1;
		height: 14px;
		border-radius: 3px;
		border: 1px solid var(--c2);
		background: color-mix(in srgb, var(--c0) 80%, var(--c1));
	}

	.mini-input.wide {
		height: 22px;
	}

	.mini-pill {
		width: 30px;
		height: 14px;
		border-radius: 999px;
		background: var(--c1);
	}

	.body {
		display: flex;
		flex-direction: column;
		flex: 1;
		padding: 0.9rem 1rem 1rem;
	}

	.title-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.tagline {
		color: var(--fg-faint);
		font-size: 0.78rem;
	}

	.body p {
		margin: 0.45rem 0 0;
		color: var(--fg-muted);
		font-size: 0.85rem;
		line-height: 1.5;
	}

	.cta {
		margin-top: auto;
		padding-top: 0.85rem;
		color: var(--accent);
		font-size: 0.82rem;
		font-weight: 600;
	}
</style>
