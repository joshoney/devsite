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
	runTimestamp?: string;
	executionMode?: string;
	traceUrl?: string;
}

export interface ModelEvalHistory {
	evalId: string;
	evalName: string;
	category: string;
	tags: string[];
	attempts: EvalItem[];
	latestAttempt: EvalItem;
}

export interface ModelGroup {
	modelName: string;
	evaluations: Record<string, ModelEvalHistory>;
	
	// Aggregated metrics across latest attempts
	avgTokensPerSecond: number;
	avgTimeToFirstTokenMs: number;
	passRatePercentage: number;
	totalEvals: number;
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
	modelName: string;
	summary: {
		averageTokensPerSecond: number;
		averageTimeToFirstTokenMs: number;
		passRatePercentage: number;
	};
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
	modelA: ModelGroup;
	modelB: ModelGroup;
	tpsDelta: number;
	ttftDelta: number;
	passRateDelta: number;
	evalPairs: ComparisonEvalPair[];
}

const rawModules = import.meta.glob<EvalItem>(
	'/src/resources/evaluerBench/*/*/*.json',
	{ eager: true }
);

let cachedModelGroups: ModelGroup[] | null = null;

export function getModelGroups(): ModelGroup[] {
	if (cachedModelGroups) return cachedModelGroups;
	
	const modelMap = new Map<string, Record<string, EvalItem[]>>();
	
	for (const path in rawModules) {
		const mod = rawModules[path];
		const item = (mod && 'default' in (mod as any) ? (mod as any).default : mod) as EvalItem;
		
		const parts = path.split('/');
		const filename = parts.pop() || '';
		const evalId = parts.pop() || 'unknown';
		const modelName = parts.pop() || 'unknown';
		
		item.modelName = modelName; // ensure
		
		if (!modelMap.has(modelName)) {
			modelMap.set(modelName, {});
		}
		if (!modelMap.get(modelName)![evalId]) {
			modelMap.get(modelName)![evalId] = [];
		}
		
		// Map artifact URL
		if (item.display_type === 'html-iframe') {
			if (item.artifactFilename) {
				// Current evaluerBench layout: each run records its own artifact next to its JSON
				item.artifactUrl = `/evals/artifact/${modelName}/${evalId}/${item.artifactFilename}`;
			} else {
				// Older runs: one shared artifact per model and eval at the model level
				const artifactFilename = `artifact-${evalId}.html`;
				item.artifactFilename = artifactFilename;
				item.artifactUrl = `/evals/artifact/${modelName}/${artifactFilename}`;
			}
		}
		
		if (!item.judge) {
			item.judge = { score: 0, passed: false, reasoning: "No automated judge evaluation recorded." };
		}
		
		modelMap.get(modelName)![evalId].push(item);
	}
	
	const groups: ModelGroup[] = [];
	
	for (const [modelName, evals] of modelMap.entries()) {
		const evaluations: Record<string, ModelEvalHistory> = {};
		
		let totalTps = 0;
		let totalTtft = 0;
		let passedCount = 0;
		let evalCount = 0;
		
		for (const [evalId, attempts] of Object.entries(evals)) {
			attempts.sort((a, b) => {
				const tA = new Date(a.runTimestamp || a.metrics?.timestamp || 0).getTime();
				const tB = new Date(b.runTimestamp || b.metrics?.timestamp || 0).getTime();
				return tB - tA; // newest first
			});
			
			const latest = attempts[0];
			evaluations[evalId] = {
				evalId,
				evalName: latest.evalName,
				category: latest.category || 'general',
				tags: latest.tags || [],
				attempts,
				latestAttempt: latest
			};
			
			totalTps += latest.metrics?.tokensPerSecond || 0;
			totalTtft += latest.metrics?.timeToFirstTokenMs || 0;
			if (latest.judge?.passed) passedCount++;
			evalCount++;
		}
		
		groups.push({
			modelName,
			evaluations,
			avgTokensPerSecond: evalCount ? Math.round((totalTps / evalCount) * 100) / 100 : 0,
			avgTimeToFirstTokenMs: evalCount ? Math.round((totalTtft / evalCount) * 100) / 100 : 0,
			passRatePercentage: evalCount ? Math.round((passedCount / evalCount) * 100) : 0,
			totalEvals: evalCount
		});
	}
	
	// Sort by pass rate then TPS
	groups.sort((a, b) => {
		if (b.passRatePercentage !== a.passRatePercentage) {
			return b.passRatePercentage - a.passRatePercentage;
		}
		return b.avgTokensPerSecond - a.avgTokensPerSecond;
	});
	
	cachedModelGroups = groups;
	return groups;
}

export function getModelByName(modelName: string): ModelGroup | undefined {
	const groups = getModelGroups();
	return groups.find(g => g.modelName === modelName);
}

export function getMatrixData(): MatrixData {
	const models = getModelGroups();
	const evalMap = new Map<string, MatrixColumn>();

	for (const model of models) {
		for (const evalData of Object.values(model.evaluations)) {
			if (!evalMap.has(evalData.evalId)) {
				evalMap.set(evalData.evalId, {
					evalId: evalData.evalId,
					evalName: evalData.evalName,
					category: evalData.category,
					tags: evalData.tags
				});
			}
		}
	}

	const allColumns = Array.from(evalMap.values());

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

	categories.sort((a, b) => {
		const order: Record<string, number> = { 'coding-complex': 1, 'visual-demo': 2 };
		const aOrder = order[a.category] || 0;
		const bOrder = order[b.category] || 0;
		if (aOrder !== bOrder) return aOrder - bOrder;
		return a.category.localeCompare(b.category);
	});

	const rows: MatrixRow[] = models.map((model) => {
		const cells: Record<string, MatrixCell> = {};

		for (const col of allColumns) {
			const evalHistory = model.evaluations[col.evalId];
			if (evalHistory) {
				cells[col.evalId] = {
					evalId: col.evalId,
					tested: true,
					result: evalHistory.latestAttempt
				};
			} else {
				cells[col.evalId] = {
					evalId: col.evalId,
					tested: false
				};
			}
		}

		return {
			modelName: model.modelName,
			summary: {
				averageTokensPerSecond: model.avgTokensPerSecond,
				averageTimeToFirstTokenMs: model.avgTimeToFirstTokenMs,
				passRatePercentage: model.passRatePercentage
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

export function getModelComparison(modelA: string, modelB: string): ComparisonData | undefined {
	const mA = getModelByName(modelA);
	const mB = getModelByName(modelB);

	if (!mA || !mB) return undefined;

	const tpsDelta = mA.avgTokensPerSecond - mB.avgTokensPerSecond;
	const ttftDelta = mA.avgTimeToFirstTokenMs - mB.avgTimeToFirstTokenMs;
	const passRateDelta = mA.passRatePercentage - mB.passRatePercentage;

	const evalIds = new Set<string>();
	Object.keys(mA.evaluations).forEach(id => evalIds.add(id));
	Object.keys(mB.evaluations).forEach(id => evalIds.add(id));

	const evalPairs: ComparisonEvalPair[] = [];

	for (const evalId of evalIds) {
		const resA = mA.evaluations[evalId]?.latestAttempt;
		const resB = mB.evaluations[evalId]?.latestAttempt;

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
		modelA: mA,
		modelB: mB,
		tpsDelta: Math.round(tpsDelta * 100) / 100,
		ttftDelta: Math.round(ttftDelta * 100) / 100,
		passRateDelta: Math.round(passRateDelta * 100) / 100,
		evalPairs
	};
}
