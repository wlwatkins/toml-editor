<script lang="ts">
	import { onMount } from 'svelte';
	import {
		downloadUpdate,
		installUpdate,
		onUpdateState,
		updateState,
		type UpdateState
	} from '$lib/platform';

	/**
	 * Called before the app quits to install. Return false to keep it open;
	 * the page uses this to ask about unsaved edits.
	 */
	let { beforeInstall }: { beforeInstall?: () => Promise<boolean> | boolean } = $props();

	let current = $state<UpdateState>({ state: 'idle', manual: false });
	// A dismissed offer stays hidden until the state moves on.
	let dismissed = $state<string | null>(null);
	let failure = $state<string | null>(null);

	onMount(() => {
		void updateState().then((state) => (current = state));
		onUpdateState((state) => {
			current = state;
			failure = null;
			if (state.state !== 'available') dismissed = null;
		});
	});

	const visible = $derived.by(() => {
		if (dismissed === `${current.state}:${current.version}`) return false;
		switch (current.state) {
			case 'available':
			case 'downloading':
			case 'downloaded':
				return true;
			case 'checking':
			case 'none':
			case 'error':
			case 'unsupported':
				return current.manual;
			default:
				return false;
		}
	});

	const dismiss = () => (dismissed = `${current.state}:${current.version}`);

	async function download() {
		try {
			await downloadUpdate();
		} catch (cause) {
			failure = (cause as Error).message;
		}
	}

	async function install() {
		if (beforeInstall && !(await beforeInstall())) return;
		try {
			await installUpdate();
		} catch (cause) {
			failure = (cause as Error).message;
		}
	}
</script>

{#if visible}
	<div class="notice" class:error={current.state === 'error'} role="status" aria-live="polite">
		<div class="inner">
			{#if failure}
				<span class="text">{failure}</span>
				<button type="button" class="ghost" onclick={dismiss}>Dismiss</button>
			{:else if current.state === 'checking'}
				<span class="text">Checking for updates…</span>
			{:else if current.state === 'none'}
				<span class="text">You are up to date.</span>
				<button type="button" class="ghost" onclick={dismiss}>OK</button>
			{:else if current.state === 'available'}
				<span class="text">
					<strong>Version {current.version}</strong> is available.
				</span>
				<button type="button" class="primary" onclick={download}>Download</button>
				<button type="button" class="ghost" onclick={dismiss}>Later</button>
			{:else if current.state === 'downloading'}
				<span class="text">
					Downloading version {current.version}… <span class="mono">{current.percent ?? 0}%</span>
				</span>
				<span class="bar" aria-hidden="true">
					<span class="fill" style="width: {current.percent ?? 0}%"></span>
				</span>
			{:else if current.state === 'downloaded'}
				<span class="text">
					<strong>Version {current.version}</strong> is ready. It will install when you next close
					the app, or now.
				</span>
				<button type="button" class="primary" onclick={install}>Restart and install</button>
				<button type="button" class="ghost" onclick={dismiss}>Later</button>
			{:else if current.state === 'error'}
				<span class="text">Could not check for updates: {current.error}</span>
				<button type="button" class="ghost" onclick={dismiss}>Dismiss</button>
			{:else if current.state === 'unsupported'}
				<span class="text">{current.reason}</span>
				<button type="button" class="ghost" onclick={dismiss}>OK</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.notice {
		flex: none;
		border-bottom: 1px solid var(--border-faint);
		background: var(--surface-sunken);
		backdrop-filter: blur(6px);
		font-size: 0.82rem;
	}

	.notice.error {
		color: var(--danger);
	}

	.inner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		max-width: 1180px;
		margin: 0 auto;
		padding: 0.45rem 1.25rem;
	}

	.text {
		flex: 1 1 16rem;
	}

	.mono {
		font-family: var(--mono);
	}

	.bar {
		flex: 1 1 10rem;
		height: 4px;
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

	button {
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.ghost {
		background: transparent;
		color: var(--fg-muted);
	}

	.ghost:hover {
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
