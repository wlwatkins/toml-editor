import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// A static SPA: Electron serves `build/` over its own protocol and
			// talks to the filesystem over IPC, so there is no server to deploy.
			adapter: adapter({ fallback: 'index.html' })
		})
	]
});
