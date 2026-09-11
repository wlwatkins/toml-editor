import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
	// Baked in at build time so the About box works in the browser build too,
	// where there is no Electron to ask.
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__APP_REPOSITORY__: JSON.stringify(pkg.repository.url)
	},
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
