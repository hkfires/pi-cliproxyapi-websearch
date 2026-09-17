import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	getCliProxyModels,
	isSearchModel,
	selectSearchModel,
	sortSearchModels,
	TARGET_PROVIDER_ID,
} from "../extensions/model-selector.ts";

function makeModel(id: string, provider = TARGET_PROVIDER_ID): Model<Api> {
	return {
		id,
		provider,
		api: "cliproxyapi-codex-responses",
		baseUrl: "https://cpa.example.com/backend-api",
		name: id,
	} as Model<Api>;
}

function mockContext(options: {
	currentModel?: Model<Api>;
	availableModels?: Model<Api>[];
	allModels?: Model<Api>[];
}): ExtensionContext {
	const all = options.allModels ?? options.availableModels ?? [];
	const available = options.availableModels ?? all;
	return {
		model: options.currentModel,
		modelRegistry: {
			getAll: () => all,
			getAvailable: () => available,
			find: (provider: string, id: string) =>
				all.find((m) => m.provider === provider && m.id === id),
		},
	} as unknown as ExtensionContext;
}

describe("isSearchModel", () => {
	it("recognizes supported search models", () => {
		assert.equal(isSearchModel("gpt-5.6-sol"), true);
		assert.equal(isSearchModel("gpt-5.6-turbo"), true);
		assert.equal(isSearchModel("gpt-6-astra"), true);
		assert.equal(isSearchModel("gemini-3.8-flash-high"), true);
		assert.equal(isSearchModel("grok-4.5"), true);
		assert.equal(isSearchModel("grok-3-mini"), true);
		assert.equal(isSearchModel("grok-composer-2.5-fast"), true);
		assert.equal(isSearchModel("gpt-5.5"), true);
	});

	it("rejects non-search models", () => {
		assert.equal(isSearchModel("claude-3-7-sonnet"), false);
		assert.equal(isSearchModel("gpt-4o"), false);
		assert.equal(isSearchModel(""), false);
		assert.equal(isSearchModel(undefined), false);
	});
});

describe("selectSearchModel", () => {
	it("honors explicitly configured model", () => {
		const sol = makeModel("gpt-5.6-sol");
		const astra = makeModel("gpt-6-astra");
		const ctx = mockContext({
			currentModel: sol,
			availableModels: [sol, astra],
		});
		const selected = selectSearchModel(ctx, "gpt-6-astra");
		assert.equal(selected.id, "gpt-6-astra");
	});

	it("uses current model whenever it belongs to cliproxyapi by default", () => {
		const terra = makeModel("gpt-5.6-terra");
		const sol = makeModel("gpt-5.6-sol");
		const ctx = mockContext({
			currentModel: terra,
			availableModels: [terra, sol],
		});
		// Current session model wins by default over preferred order
		const selected = selectSearchModel(ctx);
		assert.equal(selected.id, "gpt-5.6-terra");
	});

	it("falls back to available search model if current model is from another provider", () => {
		const sonnet = makeModel("claude-3-7-sonnet", "anthropic");
		const terra = makeModel("gpt-5.6-terra");
		const ctx = mockContext({
			currentModel: sonnet,
			availableModels: [terra],
		});
		const selected = selectSearchModel(ctx);
		assert.equal(selected.id, "gpt-5.6-terra");
	});

	it("uses gemini-3.8-flash-high when available", () => {
		const gemini = makeModel("gemini-3.8-flash-high");
		const ctx = mockContext({
			currentModel: makeModel("some-other-model", "other"),
			availableModels: [gemini],
		});
		const selected = selectSearchModel(ctx);
		assert.equal(selected.id, "gemini-3.8-flash-high");
	});

	it("throws when no cliproxyapi model is registered", () => {
		const ctx = mockContext({
			currentModel: makeModel("gpt-4o", "openai"),
			availableModels: [makeModel("claude-3", "anthropic")],
		});
		assert.throws(() => selectSearchModel(ctx), /No CLIProxyAPI model found/);
	});
});

describe("getCliProxyModels (predefined search models filter)", () => {
	it("filters out non-search and non-cliproxyapi models strictly", () => {
		const searchSol = makeModel("gpt-5.6-sol");
		const searchGemini = makeModel("gemini-3.8-flash-high");
		const nonSearchGlm = makeModel("glm-4.5-air");
		const nonSearchGemini = makeModel("gemini-3-flash");
		const otherProviderGpt = makeModel("gpt-6-astra", "openai");

		const ctx = mockContext({
			availableModels: [
				searchSol,
				nonSearchGlm,
				searchGemini,
				nonSearchGemini,
				otherProviderGpt,
			],
		});

		const filtered = getCliProxyModels(ctx);
		assert.equal(filtered.length, 2);
		assert.deepEqual(
			filtered.map((m) => m.id),
			["gpt-5.6-sol", "gemini-3.8-flash-high"],
		);
	});

	it("sorts search models alphabetically", () => {
		const astra = makeModel("gpt-6-astra");
		const sol = makeModel("gpt-5.6-sol");
		const grok = makeModel("grok-4.5");

		const sorted = sortSearchModels([grok, astra, sol]);
		assert.deepEqual(
			sorted.map((m) => m.id),
			["gpt-5.6-sol", "gpt-6-astra", "grok-4.5"],
		);
	});
});

