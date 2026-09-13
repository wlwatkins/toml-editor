<script lang="ts">
	import { appInfo, type AppInfo } from '$lib/platform';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let info = $state<AppInfo | null>(null);
	let dialog = $state<HTMLDialogElement | null>(null);

	// Keep the native dialog in sync with the prop, and load the details the
	// first time it is shown.
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			if (!info) {
				void appInfo().then((result) => {
					info = result;
				});
			}
		}
		else if (!open && dialog.open) {
			dialog.close();
		}
	});

	const rows = $derived(
		info
			? [
					['Version', info.version],
					...(info.electron ? [['Electron', info.electron]] : []),
					...(info.chrome ? [['Chromium', info.chrome]] : []),
					...(info.node ? [['Node', info.node]] : []),
					...(info.platform ? [['Platform', info.platform]] : [])
				]
			: []
	);
</script>

<dialog bind:this={dialog} onclose={() => (open = false)}>
	<div class="head">
		<span class="logo" aria-hidden="true">T</span>
		<div class="names">
			<h2>TOML Editor</h2>
			<p>Edit a TOML, JSON, JSONC or YAML file as a form, without losing its comments.</p>
		</div>
	</div>

	{#if info}
		<dl class="details">
			{#each rows as [label, value] (label)}
				<dt>{label}</dt>
				<dd>{value}</dd>
			{/each}
		</dl>

		{#if info.repository}
			<p class="repo">
				<a href={info.repository} target="_blank" rel="noopener noreferrer">{info.repository}</a>
			</p>
		{/if}
	{:else}
		<p class="loading">Loading&hellip;</p>
	{/if}

	<div class="actions">
		<button type="button" class="close" onclick={() => (open = false)}>Close</button>
	</div>
</dialog>

<style>
	dialog {
		width: min(420px, 92vw);
		padding: 1.1rem 1.2rem 1rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-panel);
		/* Opaque, for the same reason the menus are: a translucent panel over the
		   grid is hard to read. */
		background: #07161f;
		color: var(--fg);
		box-shadow:
			0 0 0 1px rgb(34 224 255 / 0.12),
			0 24px 60px rgb(0 0 0 / 0.7);
	}

	dialog::backdrop {
		background: rgb(0 2 8 / 0.72);
	}

	.head {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.logo {
		display: grid;
		place-items: center;
		flex: none;
		width: 40px;
		height: 40px;
		border-radius: var(--radius-control);
		background: var(--accent);
		color: var(--accent-fg);
		font-family: var(--mono);
		font-size: 1.3rem;
		font-weight: 700;
	}

	.names h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.names p {
		margin: 0.15rem 0 0;
		color: var(--fg-muted);
		font-size: 0.82rem;
	}

	.details {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.3rem 1rem;
		margin: 1.1rem 0 0;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--border-faint);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		font-size: 0.8rem;
	}

	dt {
		color: var(--fg-faint);
	}

	dd {
		margin: 0;
		font-family: var(--mono);
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}

	.repo {
		margin: 0.7rem 0 0;
		font-size: 0.78rem;
		overflow-wrap: anywhere;
	}

	.repo a {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.loading {
		margin: 1rem 0 0;
		color: var(--fg-faint);
		font-size: 0.82rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 1rem;
	}

	.close {
		padding: 0.35rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--fg-muted);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.close:hover {
		background: var(--surface-hover);
		color: var(--fg);
	}

	.close:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: inset 0 0 0 2px var(--accent);
	}
</style>
