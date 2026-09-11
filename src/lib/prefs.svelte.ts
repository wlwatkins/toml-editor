/** How much of each comment to show. */
export type CommentMode = 'full' | 'brief' | 'off';

const KEY = 'toml-editor:comments';
const MODES: CommentMode[] = ['full', 'brief', 'off'];

class Prefs {
	comments = $state<CommentMode>('full');

	load() {
		try {
			const stored = localStorage.getItem(KEY) as CommentMode | null;
			if (stored && MODES.includes(stored)) this.comments = stored;
		} catch {
			// Storage can be unavailable (private window, blocked site data); the
			// default is fine in that case.
		}
	}

	setComments(mode: CommentMode) {
		this.comments = mode;
		try {
			localStorage.setItem(KEY, mode);
		} catch {
			// ignored, see load()
		}
	}
}

export const prefs = new Prefs();
