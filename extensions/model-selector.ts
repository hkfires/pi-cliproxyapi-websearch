import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const TARGET_PROVIDER_ID = "cliproxyapi";

export const BUILTIN_SEARCH_MODEL_RULES: ReadonlyArray<string | RegExp> = [
	"gemini-3.8-flash-high",
	/^gpt-5\.6-.*$/i,
	/^gpt-6-.*$/i,
	/^grok-.*$/i,
	/^gpt-5\.5$/i,
];

export function isSearchModel(modelId?: string): boolean {
	if (!modelId) return false;
	const normalized = modelId.trim().toLowerCase();
	return BUILTIN_SEARCH_MODEL_RULES.some((rule) =>
		typeof rule === "string" ? rule === normalized : rule.test(normalized),
	);
}

export function selectSearchModel(
	ctx: ExtensionContext,
	configuredModelId?: string,
): Model<Api> {
	const registry = ctx.modelRegistry;
	const allModels = typeof registry?.getAll === "function" ? registry.getAll() : [];
	const availableModels =
		typeof registry?.getAvailable === "function"
			? registry.getAvailable()
			: allModels;

	// 1. Explicitly configured model under cliproxyapi
	if (configuredModelId) {
		const targetId = configuredModelId.trim().toLowerCase();
		const configured =
			(typeof registry?.find === "function"
				? registry.find(TARGET_PROVIDER_ID, configuredModelId)
				: undefined) ??
			allModels.find(
				(m) =>
					m.provider === TARGET_PROVIDER_ID &&
					m.id.toLowerCase() === targetId,
			);
		if (configured) return configured;
	}

	// 2. Default: use current session model if it belongs to cliproxyapi
	if (ctx.model?.provider === TARGET_PROVIDER_ID) {
		return ctx.model;
	}

	// 3. Fallback when current model is from another provider: pick available search model
	const anySearch = availableModels.find(
		(m) => m.provider === TARGET_PROVIDER_ID && isSearchModel(m.id),
	);
	if (anySearch) return anySearch;

	// 4. Any available model under cliproxyapi
	const anyCpa = availableModels.find((m) => m.provider === TARGET_PROVIDER_ID);
	if (anyCpa) return anyCpa;

	// 5. Any model in catalog under cliproxyapi
	const anyInAll = allModels.find((m) => m.provider === TARGET_PROVIDER_ID);
	if (anyInAll) return anyInAll;

	throw new Error(
		"No CLIProxyAPI model found in Pi model registry. Please verify that @router-for-me/pi-cliproxyapi-provider is installed and active.",
	);
}

export function getCliProxyModels(ctx: ExtensionContext): Model<Api>[] {
	const registry = ctx.modelRegistry;
	const allModels = typeof registry?.getAll === "function" ? registry.getAll() : [];
	const availableModels =
		typeof registry?.getAvailable === "function"
			? registry.getAvailable()
			: allModels;
	const candidatePool = availableModels.some(
		(m) => m.provider === TARGET_PROVIDER_ID && isSearchModel(m.id),
	)
		? availableModels
		: allModels;

	const seen = new Set<string>();
	const filtered: Model<Api>[] = [];
	for (const m of candidatePool) {
		if (m.provider === TARGET_PROVIDER_ID && isSearchModel(m.id)) {
			const lower = m.id.toLowerCase();
			if (!seen.has(lower)) {
				seen.add(lower);
				filtered.push(m);
			}
		}
	}
	return filtered;
}

export function sortSearchModels(models: Model<Api>[]): Model<Api>[] {
	return [...models].sort((a, b) => a.id.localeCompare(b.id));
}

