export interface EvalMetrics {
	timeToFirstTokenMs: number;
	tokensPerSecond: number;
	totalLatencyMs: number;
	inputTokens: number;
	outputTokens: number;
	timestamp: string;
}

export interface EvalJudge {
	score: number;
	passed: boolean;
	reasoning: string;
}

export interface EvalItem {
	evalId: string;
	evalName: string;
	category: string;
	tags: string[];
	modelName: string;
	prompt: string;
	rawOutput: string;
	display_type: 'code' | 'html-iframe' | 'text' | string;
	metrics: EvalMetrics;
	judge: EvalJudge;
	artifactFilename?: string;
	artifactUrl?: string;
}

export interface RunMeta {
	modelName: string;
	timestamp: string;
	executionMode: string;
	totalTests: number;
	errorCount: number;
}

export interface RunSummary {
	averageTokensPerSecond: number;
	averageTimeToFirstTokenMs: number;
	passRatePercentage: number;
}

export interface BenchmarkRun {
	runId: string;
	meta: RunMeta;
	summary: RunSummary;
	results: EvalItem[];
	systemErrors?: any[];
}

export interface ModelGroup {
	modelName: string;
	latestRun: BenchmarkRun;
	runs: BenchmarkRun[];
	avgTokensPerSecond: number;
	avgTimeToFirstTokenMs: number;
	passRatePercentage: number;
	totalRunsCount: number;
}

export interface MatrixColumn {
	evalId: string;
	evalName: string;
	category: string;
	tags: string[];
}

export interface MatrixCell {
	evalId: string;
	tested: boolean;
	result?: EvalItem;
}

export interface MatrixRow {
	runId: string;
	modelName: string;
	timestamp: string;
	isLatest: boolean;
	summary: RunSummary;
	cells: Record<string, MatrixCell>;
}

export interface MatrixCategoryGroup {
	category: string;
	columns: MatrixColumn[];
}

export interface MatrixData {
	categories: MatrixCategoryGroup[];
	allColumns: MatrixColumn[];
	rows: MatrixRow[];
}

export interface ComparisonEvalPair {
	evalId: string;
	evalName: string;
	category: string;
	resultA?: EvalItem;
	resultB?: EvalItem;
	scoreDelta?: number;
	tpsDelta?: number;
	ttftDelta?: number;
}

export interface ComparisonData {
	runA: BenchmarkRun;
	runB: BenchmarkRun;
	tpsDelta: number;
	ttftDelta: number;
	passRateDelta: number;
	evalPairs: ComparisonEvalPair[];
}

// Ingest all bench.json files dynamically at build time
const rawBenchModules = import.meta.glob<{ default?: BenchmarkRun } & BenchmarkRun>(
	'/src/resources/evaluerBench/**/bench.json',
	{ eager: true }
);

/**
 * Loads all benchmark runs sorted by timestamp (newest first).
 */
export function getAllRuns(): BenchmarkRun[] {
	const runs: BenchmarkRun[] = [];

	for (const path in rawBenchModules) {
		const mod = rawBenchModules[path];
		const data = (mod && 'default' in mod && mod.default ? mod.default : mod) as BenchmarkRun;

		// Extract runId from directory path (e.g. "run-Qwen3.5-35B-A3B-GGUF-2026-07-29T08-52-56")
		const pathSegments = path.split('/');
		const runDirName = pathSegments[pathSegments.length - 2] || 'unknown-run';

		const resultsWithArtifacts = (data.results || []).map((result) => {
			const artifactFilename = `artifact-${result.evalId}.html`;
			const artifactUrl = `/evals/artifact/${runDirName}/${artifactFilename}`;
			const hasJudge = !!result.judge;
			return {
				...result,
				judge: hasJudge ? result.judge : {
					score: 0,
					passed: false,
					reasoning: "No automated judge evaluation recorded for this run."
				},
				hasJudge,
				artifactFilename,
				artifactUrl
			};
		});

		const judgedResults = resultsWithArtifacts.filter(r => (r as any).hasJudge);
		const passedCount = judgedResults.filter(r => r.judge?.passed).length;
		const calcPassRate = judgedResults.length > 0 
			? Math.round((passedCount / judgedResults.length) * 100) 
			: (data.summary?.passRatePercentage ?? 0);

		const summary = {
			averageTokensPerSecond: data.summary?.averageTokensPerSecond || 0,
			averageTimeToFirstTokenMs: data.summary?.averageTimeToFirstTokenMs || 0,
			passRatePercentage: (data.summary?.passRatePercentage !== null && data.summary?.passRatePercentage !== undefined)
				? data.summary.passRatePercentage
				: calcPassRate
		};

		runs.push({
			...data,
			summary,
			runId: runDirName,
			results: resultsWithArtifacts
		});
	}

	// Sort runs by timestamp descending (newest first)
	return runs.sort((a, b) => {
		const timeA = new Date(a.meta?.timestamp || 0).getTime();
		const timeB = new Date(b.meta?.timestamp || 0).getTime();
		return timeB - timeA;
	});
}

/**
 * Retrieves a single run by runId.
 */
export function getRunById(runId: string): BenchmarkRun | undefined {
	const runs = getAllRuns();
	return runs.find((r) => r.runId === runId);
}

/**
 * Groups runs by model name, identifying the latest run per model and aggregate stats.
 */
export function getModelGroups(): ModelGroup[] {
	const runs = getAllRuns();
	const groupMap = new Map<string, BenchmarkRun[]>();

	for (const run of runs) {
		const model = run.meta?.modelName || 'Unknown Model';
		if (!groupMap.has(model)) {
			groupMap.set(model, []);
		}
		groupMap.get(model)!.push(run);
	}

	const groups: ModelGroup[] = [];

	for (const [modelName, modelRuns] of groupMap.entries()) {
		// Sorted newest first
		const sortedRuns = modelRuns.sort((a, b) => {
			const timeA = new Date(a.meta?.timestamp || 0).getTime();
			const timeB = new Date(b.meta?.timestamp || 0).getTime();
			return timeB - timeA;
		});

		const latestRun = sortedRuns[0];

		const avgTps =
			sortedRuns.reduce((acc, r) => acc + (r.summary?.averageTokensPerSecond || 0), 0) /
			sortedRuns.length;
		const avgTtft =
			sortedRuns.reduce((acc, r) => acc + (r.summary?.averageTimeToFirstTokenMs || 0), 0) /
			sortedRuns.length;
		const avgPass =
			sortedRuns.reduce((acc, r) => acc + (r.summary?.passRatePercentage || 0), 0) /
			sortedRuns.length;

		groups.push({
			modelName,
			latestRun,
			runs: sortedRuns,
			avgTokensPerSecond: Math.round(avgTps * 100) / 100,
			avgTimeToFirstTokenMs: Math.round(avgTtft * 100) / 100,
			passRatePercentage: Math.round(avgPass * 100) / 100,
			totalRunsCount: sortedRuns.length
		});
	}

	return groups;
}

/**
 * Builds matrix grid data with:
 * - Columns = Union of all unique evals grouped by category.
 * - Rows = Model runs (newest first).
 */
export function getMatrixData(): MatrixData {
	const runs = getAllRuns();
	const evalMap = new Map<string, MatrixColumn>();

	// 1. Gather union of all unique evals
	for (const run of runs) {
		for (const res of run.results || []) {
			if (!evalMap.has(res.evalId)) {
				evalMap.set(res.evalId, {
					evalId: res.evalId,
					evalName: res.evalName,
					category: res.category || 'general',
					tags: res.tags || []
				});
			}
		}
	}

	const allColumns = Array.from(evalMap.values());

	// Group columns by category
	const categoryMap = new Map<string, MatrixColumn[]>();
	for (const col of allColumns) {
		if (!categoryMap.has(col.category)) {
			categoryMap.set(col.category, []);
		}
		categoryMap.get(col.category)!.push(col);
	}

	const categories: MatrixCategoryGroup[] = Array.from(categoryMap.entries()).map(
		([category, columns]) => ({
			category,
			columns
		})
	);

	// Sort categories to put visual-demo and coding-complex at the end
	categories.sort((a, b) => {
		const order: Record<string, number> = { 'coding-complex': 1, 'visual-demo': 2 };
		const aOrder = order[a.category] || 0;
		const bOrder = order[b.category] || 0;
		if (aOrder !== bOrder) return aOrder - bOrder;
		return a.category.localeCompare(b.category);
	});

	// 2. Build rows
	const latestRunPerModel = new Set<string>();
	const modelGroups = getModelGroups();
	for (const group of modelGroups) {
		if (group.latestRun) {
			latestRunPerModel.add(group.latestRun.runId);
		}
	}

	const rows: MatrixRow[] = runs.map((run) => {
		const cells: Record<string, MatrixCell> = {};

		for (const col of allColumns) {
			const matchedResult = run.results?.find((r) => r.evalId === col.evalId);
			if (matchedResult) {
				cells[col.evalId] = {
					evalId: col.evalId,
					tested: true,
					result: matchedResult
				};
			} else {
				cells[col.evalId] = {
					evalId: col.evalId,
					tested: false
				};
			}
		}

		return {
			runId: run.runId,
			modelName: run.meta?.modelName || 'Unknown Model',
			timestamp: run.meta?.timestamp || '',
			isLatest: latestRunPerModel.has(run.runId),
			summary: run.summary || {
				averageTokensPerSecond: 0,
				averageTimeToFirstTokenMs: 0,
				passRatePercentage: 0
			},
			cells
		};
	});

	return {
		categories,
		allColumns,
		rows
	};
}

/**
 * Computes side-by-side comparison stats and paired eval items for two specified runs.
 */
export function getRunComparison(runIdA: string, runIdB: string): ComparisonData | undefined {
	const runA = getRunById(runIdA);
	const runB = getRunById(runIdB);

	if (!runA || !runB) return undefined;

	const tpsDelta =
		(runA.summary?.averageTokensPerSecond || 0) - (runB.summary?.averageTokensPerSecond || 0);
	const ttftDelta =
		(runA.summary?.averageTimeToFirstTokenMs || 0) -
		(runB.summary?.averageTimeToFirstTokenMs || 0);
	const passRateDelta =
		(runA.summary?.passRatePercentage || 0) - (runB.summary?.passRatePercentage || 0);

	// Gather all unique evalIds tested across either runA or runB
	const evalIds = new Set<string>();
	runA.results.forEach((r) => evalIds.add(r.evalId));
	runB.results.forEach((r) => evalIds.add(r.evalId));

	const evalPairs: ComparisonEvalPair[] = [];

	for (const evalId of evalIds) {
		const resA = runA.results.find((r) => r.evalId === evalId);
		const resB = runB.results.find((r) => r.evalId === evalId);

		const name = resA?.evalName || resB?.evalName || evalId;
		const cat = resA?.category || resB?.category || 'general';

		const scoreA = resA?.judge?.score;
		const scoreB = resB?.judge?.score;
		const scoreDelta = scoreA !== undefined && scoreB !== undefined ? scoreA - scoreB : undefined;

		const tpsA = resA?.metrics?.tokensPerSecond;
		const tpsB = resB?.metrics?.tokensPerSecond;
		const tpsDelta = tpsA !== undefined && tpsB !== undefined ? tpsA - tpsB : undefined;

		const ttftA = resA?.metrics?.timeToFirstTokenMs;
		const ttftB = resB?.metrics?.timeToFirstTokenMs;
		const ttftDelta = ttftA !== undefined && ttftB !== undefined ? ttftA - ttftB : undefined;

		evalPairs.push({
			evalId,
			evalName: name,
			category: cat,
			resultA: resA,
			resultB: resB,
			scoreDelta,
			tpsDelta,
			ttftDelta
		});
	}

	return {
		runA,
		runB,
		tpsDelta: Math.round(tpsDelta * 100) / 100,
		ttftDelta: Math.round(ttftDelta * 100) / 100,
		passRateDelta: Math.round(passRateDelta * 100) / 100,
		evalPairs
	};
}
