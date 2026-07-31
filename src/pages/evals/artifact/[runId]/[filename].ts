import type { APIRoute } from 'astro';

export function getStaticPaths() {
	const artifactFiles = import.meta.glob<string>(
		'/src/resources/evaluerBench/*/*.html',
		{ query: '?raw', eager: true }
	);

	return Object.entries(artifactFiles).map(([path, content]) => {
		const parts = path.split('/');
		const filename = parts.pop() || '';
		const runId = parts.pop() || '';

		const htmlContent = typeof content === 'string' ? content : (content as any)?.default || '';

		return {
			params: { runId, filename },
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
