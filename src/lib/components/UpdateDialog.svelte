<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		checkForUpdates,
		downloadUpdate,
		installUpdate,
		onUpdateState,
		updateState,
		type UpdateState
	} from '$lib/platform';

	let {
		open = $bindable(false),
		beforeInstall
	}: {
		open?: boolean;
		/**
		 * Called before the app quits to install. Return false to keep it open;
		 * the page uses this to ask about unsaved edits.
		 */
		beforeInstall?: () => Promise<boolean> | boolean;
	} = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let current = $state<UpdateState>({ state: 'idle', manual: false });
	let failure = $state<string | null>(null);
	// The silent start-up check opens this once when it finds something.
	let announced = false;

	onMount(() => {
		void updateState().then((state) => (current = state));
		onUpdateState((state) => {
			current = state;
			failure = null;
			if (state.state === 'available' && !state.manual && !announced) {
				announced = true;
				open = true;
			}
		});
	});

	// Keep the native dialog in sync with the prop. Opening it from the menu
	// also starts a check, unless a download is already under way or done.
	// The state is read untracked so progress events do not re-run this.
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			const state = untrack(() => current.state);
			if (state !== 'downloading' && state !== 'downloaded') check();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	async function run(action: () => Promise<void>) {
		failure = null;
		try {
			await action();
		} catch (cause) {
			failure = (cause as Error).message;
		}
	}

	const check = () => run(checkForUpdates);
	const download = () => run(downloadUpdate);

	async function install() {
		if (beforeInstall && !(await beforeInstall())) return;
		await run(installUpdate);
	}

	const busy = $derived(current.state === 'checking' || current.state === 'downloading');
</script>

<dialog bind:this={dialog} onclose={() => (open = false)}>
	<div class="head">
		<span class="logo" aria-hidden="true">T</span>
		<div class="names">
			<h2>Updates</h2>
			<p>Installed version {__APP_VERSION__}</p>
		</div>
	</div>

	<div class="body" role="status" aria-live="polite">
		{#if failure}
			<p class="message error">{failure}</p>
		{:else if current.state === 'checking'}
			<p class="message">Checking for updates…</p>
		{:else if current.state === 'none'}
			<p class="message">You are up to date.</p>
		{:else if current.state === 'available'}
			<p class="message">
				<strong>Version {current.version}</strong> is available.
			</p>
			<p class="hint">Nothing is downloaded until you ask.</p>
		{:else if current.state === 'downloading'}
			<p class="message">
				Downloading version {current.version}… <span class="mono">{current.percent ?? 0}%</span>
			</p>
			<span class="bar" aria-hidden="true">
				<span class="fill" style="width: {current.percent ?? 0}%"></span>
			</span>
		{:else if current.state === 'downloaded'}
			<p class="message">
				<strong>Version {current.version}</strong> is ready to install.
			</p>
			<p class="hint">
				Restart now, or close this and it will install when you next quit the app.
			</p>
		{:else if current.state === 'error'}
			<p class="message error">Could not check for updates.</p>
			<p class="hint">{current.error}</p>
		{:else if current.state === 'unsupported'}
			<p class="message">{current.reason}</p>
		{:else}
			<p class="message">No check has run yet.</p>
		{/if}
	</div>

	<div class="actions">
		{#if current.state === 'available' && !failure}
			<button type="button" class="primary" onclick={download}>Download</button>
		{:else if current.state === 'downloaded' && !failure}
			<button type="button" class="primary" onclick={install}>Restart and install</button>
		{:else if current.state !== 'unsupported'}
			<button type="button" class="ghost" onclick={check} disabled={busy}>Check again</button>
		{/if}
		<button type="button" class="ghost" onclick={() => (open = false)}>Close</button>
	</div>
</dialog>

<style>
	dialog {
		width: min(420px, 92vw);
		padding: 1.1rem 1.2rem 1rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-panel);
		/* Opaque, like the About box and the menus: a translucent panel over
		   the grid is hard to read. */
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

	.body {
		margin: 1.1rem 0 0;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--border-faint);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		font-size: 0.85rem;
	}

	.message {
		margin: 0;
	}

	.message.error {
		color: var(--danger);
	}

	.hint {
		margin: 0.4rem 0 0;
		color: var(--fg-faint);
		font-size: 0.78rem;
		overflow-wrap: anywhere;
	}

	.mono {
		font-family: var(--mono);
	}

	.bar {
		display: block;
		height: 4px;
		margin-top: 0.7rem;
		border-radius: 999px;
		background: var(--accent-soft);
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 200ms linear;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	button {
		padding: 0.35rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.ghost {
		background: transparent;
		color: var(--fg-muted);
	}

	.ghost:hover:not(:disabled) {
		background: var(--surface-hover);
		color: var(--fg);
	}

	.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-fg);
		font-weight: 600;
	}

	.primary:hover {
		filter: brightness(1.1);
	}

	button:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: inset 0 0 0 2px var(--accent);
	}
</style>
