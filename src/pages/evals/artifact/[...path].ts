import type { APIRoute } from 'astro';

const RESULTS_ROOT = '/src/resources/evaluerBench/';

export function getStaticPaths() {
	// Two layouts are served:
	//   <model>/<evalId>/artifact-<timestamp>.html  (evaluerBench's current per-run layout)
	//   <model>/artifact-<evalId>.html              (older runs, one artifact per model and eval)
	const artifactFiles = import.meta.glob<string>(
		['/src/resources/evaluerBench/*/*/*.html', '/src/resources/evaluerBench/*/*.html'],
		{ query: '?raw', eager: true }
	);

	return Object.entries(artifactFiles).map(([filePath, content]) => {
		const htmlContent = typeof content === 'string' ? content : (content as any)?.default || '';

		return {
			params: { path: filePath.slice(RESULTS_ROOT.length) },
			props: { html: htmlContent }
		};
	});
}

export const GET: APIRoute = ({ props }) => {
	return new Response(props.html, {
		status: 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8'
		}
	});
};
