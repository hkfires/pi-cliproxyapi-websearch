import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "typebox/value";
import {
	buildSearchInstructions,
	executeWebSearch,
	SEARCH_INSTRUCTIONS,
	WebSearchOutputSchema,
} from "../extensions/search.ts";

const standardPricing = {
	getStandardCost: async () => ({ input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }),
};

function makeModel(id = "gpt-5.6-sol"): Model<Api> {
	return {
		id,
		provider: "cliproxyapi",
		api: "cliproxyapi-codex-responses",
		baseUrl: "https://cpa.example.com/backend-api",
		name: id,
		cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
	} as Model<Api>;
}

function mockContext(model = makeModel(), apiKey = "test-cpa-key"): ExtensionContext {
	return {
		model,
		modelRegistry: {
			getAll: () => [model],
			getAvailable: () => [model],
			find: () => model,
			getApiKeyAndHeaders: async () => ({
				ok: true,
				apiKey,
				baseUrl: model.baseUrl,
				headers: {},
			}),
		},
	} as unknown as ExtensionContext;
}

function createMockStream(lines: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const line of lines) {
				controller.enqueue(encoder.encode(line));
			}
			controller.close();
		},
	});
}

describe("executeWebSearch", () => {
	it("builds search instructions with formatted reference date", () => {
		const fixedDate = new Date("2026-09-20T08:30:00Z");
		const instructions = buildSearchInstructions(fixedDate);
		assert.ok(instructions.startsWith(SEARCH_INSTRUCTIONS));
		assert.ok(instructions.includes("Current reference date: 2026-09-20."));
		assert.ok(instructions.includes("ground relative time expressions"));
	});

	it("rejects empty or whitespace query", async () => {
		const ctx = mockContext();
		await assert.rejects(
			() => executeWebSearch({ ...standardPricing, query: "", ctx }),
			/requires a non-empty query/,
		);
		await assert.rejects(
			() => executeWebSearch({ ...standardPricing, query: "   ", ctx }),
			/requires a non-empty query/,
		);
	});

	it("executes search and parses streaming text and sources", async () => {
		const ctx = mockContext();
		let requestUrl = "";
		let requestHeaders: Record<string, string> = {};
		let requestBody: any;

		const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			requestUrl = String(input);
			requestHeaders = (init?.headers ?? {}) as Record<string, string>;
			requestBody = JSON.parse(String(init?.body ?? "{}"));

			const stream = createMockStream([
				"event: response.web_search_call.searching\ndata: {\"type\":\"response.web_search_call.searching\"}\n\n",
				"event: response.web_search_call.completed\ndata: {\"type\":\"response.web_search_call.completed\"}\n\n",
				"event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"web_search_call\",\"action\":{\"sources\":[{\"title\":\"Weather CN\",\"url\":\"https://weather.example.com\"}]}}}\n\n",
				"event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"Ningbo weather forecast: cloudy, \"}\n\n",
				"event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"temperatures 22-29C.\"}\n\n",
				"event: response.completed\ndata: {\"type\":\"response.completed\"}\n\n",
			]);

			return new Response(stream, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		};

		const fixedDate = new Date("2026-09-20T08:30:00Z");
		const updates: string[] = [];
		const result = await executeWebSearch({
			...standardPricing,
			query: "Ningbo weather",
			ctx,
			fetchFn: mockFetch as any,
			now: fixedDate,
			onUpdate: (u) => updates.push(u.content[0]?.text ?? ""),
		});

		assert.equal(
			requestUrl,
			"https://cpa.example.com/backend-api/codex/responses",
		);
		assert.equal(requestHeaders.authorization, "Bearer test-cpa-key");
		assert.equal(requestBody.model, "gpt-5.6-sol");
		assert.deepEqual(requestBody.tools, [{ type: "web_search" }]);
		assert.equal(requestBody.stream, true);
		assert.ok(requestBody.instructions.includes("Current reference date: 2026-09-20."));

		assert.ok(result.content[0]?.text.includes("Ningbo weather forecast: cloudy, temperatures 22-29C."));
		assert.ok(result.content[0]?.text.includes("## Sources"));
		assert.ok(result.content[0]?.text.includes("[Weather CN](https://weather.example.com)"));
		assert.deepEqual(result.structuredContent, {
			query: "Ningbo weather",
			text: result.content[0]?.text,
			sources: [{ title: "Weather CN", url: "https://weather.example.com" }],
		});
		assert.equal(Value.Check(WebSearchOutputSchema, result.structuredContent), true);
		assert.equal(result.details.sourcesCount, result.structuredContent.sources.length);
		assert.equal(result.details.model, "gpt-5.6-sol");
		assert.equal(typeof result.details.durationMs, "number");
		assert.ok((result.details.durationMs as number) >= 0);
	});

	it("returns a schema-valid empty sources array when no sources are reported", async () => {
		const result = await executeWebSearch({
			...standardPricing,
			query: "  test query  ",
			ctx: mockContext(),
			fetchFn: async () => new Response(createMockStream([
				'data: {"type":"response.output_text.done","text":"Summary without sources"}\n\n',
			])),
		});

		assert.deepEqual(result.structuredContent, {
			query: "test query",
			text: "Summary without sources",
			sources: [],
		});
		assert.deepEqual(result.content, [{ type: "text", text: "Summary without sources" }]);
		assert.equal(result.details.sourcesCount, 0);
		assert.equal("usage" in result, false);
		assert.equal(Value.Check(WebSearchOutputSchema, result.structuredContent), true);
	});

	it("deduplicates sources across events and preserves all sources beyond the text limit", async () => {
		const sources = Array.from({ length: 10 }, (_, i) => ({ url: `https://example.com/${i}` }));
		const events = [
			{ type: "response.output_text.delta", delta: "Search summary" },
			{
				type: "response.output_item.done",
				item: { type: "web_search_call", action: { sources } },
			},
			{
				type: "response.completed",
				response: {
					output: [{
						type: "message",
						content: [{
							type: "output_text",
							annotations: [
								{ url: " https://example.com/0 ", title: " First source " },
								{ url: "https://example.com/1", title: "   " },
							],
						}],
					}],
				},
			},
		];
		const result = await executeWebSearch({
			...standardPricing,
			query: "test",
			ctx: mockContext(),
			fetchFn: async () => new Response(createMockStream(
				events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
			)),
		});

		assert.deepEqual(result.structuredContent.sources, [
			{ url: "https://example.com/0", title: "First source" },
			...sources.slice(1),
		]);
		assert.equal(result.structuredContent.text, result.content[0]?.text);
		assert.equal(result.details.sourcesCount, 10);
		assert.ok(result.structuredContent.text.includes("https://example.com/7"));
		assert.ok(!result.structuredContent.text.includes("https://example.com/8"));
		assert.equal(Value.Check(WebSearchOutputSchema, result.structuredContent), true);
	});

	it("keeps existing inline links unchanged while exposing sources separately", async () => {
		const text = "See [Example](https://example.com) for details.";
		const events = [
			{ type: "response.output_text.done", text },
			{
				type: "response.output_item.done",
				item: { type: "web_search_call", action: { sources: [{ url: "https://example.com" }] } },
			},
		];
		const result = await executeWebSearch({
			...standardPricing,
			query: "test",
			ctx: mockContext(),
			fetchFn: async () => new Response(createMockStream(
				events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
			)),
		});

		assert.deepEqual(result.content, [{ type: "text", text }]);
		assert.deepEqual(result.structuredContent, {
			query: "test",
			text,
			sources: [{ url: "https://example.com" }],
		});
		assert.equal(Value.Check(WebSearchOutputSchema, result.structuredContent), true);
	});

	it("reports Responses usage with model pricing so session totals include the search", async () => {
		const events = [
			{ type: "response.output_text.delta", delta: "Search summary" },
			{
				type: "response.completed",
				response: {
					output: [],
					usage: {
						input_tokens: 1200,
						input_tokens_details: { cached_tokens: 200 },
						output_tokens: 300,
						output_tokens_details: { reasoning_tokens: 100 },
						total_tokens: 1500,
					},
				},
			},
		];
		const result = await executeWebSearch({
			...standardPricing,
			query: "test",
			ctx: mockContext(),
			fetchFn: async () => new Response(createMockStream(
				events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
			)),
		});

		assert.ok(result.usage);
		const { cost, ...tokens } = result.usage;
		assert.deepEqual(tokens, {
			input: 1000,
			output: 300,
			cacheRead: 200,
			cacheWrite: 0,
			reasoning: 100,
			totalTokens: 1500,
		});
		const close = (actual: number, expected: number) =>
			assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
		close(cost.input, 0.00125);
		close(cost.output, 0.003);
		close(cost.cacheRead, 0.000025);
		close(cost.cacheWrite, 0);
		close(cost.total, 0.004275);

		// Cache writes are excluded from input, and totalTokens falls back to input + output.
		const fallback = await executeWebSearch({
			...standardPricing,
			query: "test",
			ctx: mockContext(),
			fetchFn: async () => new Response(createMockStream([
				`data: ${JSON.stringify(events[0])}\n\n`,
				`data: ${JSON.stringify({
					type: "response.completed",
					response: {
						usage: {
							input_tokens: 500,
							input_tokens_details: { cached_tokens: 100, cache_write_tokens: 50 },
							output_tokens: 20,
						},
					},
				})}\n\n`,
			])),
		});
		assert.ok(fallback.usage);
		const { cost: _cost, ...fallbackTokens } = fallback.usage;
		assert.deepEqual(fallbackTokens, {
			input: 350,
			output: 20,
			cacheRead: 100,
			cacheWrite: 50,
			reasoning: 0,
			totalTokens: 520,
		});
	});

	it("uses standard prices without changing a Fast-priced model or trusting response tiers", async (t) => {
		const model = makeModel();
		model.cost = { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 };
		Object.freeze(model.cost);
		Object.freeze(model);
		const standardCost = {
			input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0,
			tiers: [{ inputTokensAbove: 2000, input: 2.5, output: 20, cacheRead: 0.25, cacheWrite: 0 }],
		};
		const { signal } = new AbortController();
		const getStandardCost = t.mock.fn(async (requestedModel: Model<Api>, requestedSignal?: AbortSignal) => {
			assert.equal(requestedModel, model);
			assert.equal(requestedSignal, signal);
			return standardCost;
		});
		for (const serviceTier of ["default", "priority"]) {
			for (const [input, cached, expected] of [[1200, 200, 0.004275], [3000, 500, 0.012375]] as const) {
				const result = await executeWebSearch({
					query: "test", ctx: mockContext(model), getStandardCost, signal,
					fetchFn: async (_url, init) => {
						const request = JSON.parse(String(init?.body));
						assert.equal("service_tier" in request, false);
						const events = [
							{ type: "response.output_text.delta", delta: "Search summary" },
							{ type: "response.completed", response: { service_tier: serviceTier, usage: {
								input_tokens: input, input_tokens_details: { cached_tokens: cached }, output_tokens: 300,
							} } },
						];
						return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
					},
				});
				assert.ok(result.usage);
				assert.ok(Math.abs(result.usage.cost.total - expected) < 1e-12);
			}
		}
		assert.equal(getStandardCost.mock.calls.length, 4);
		assert.deepEqual(model.cost, { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 });
	});

	it("searches without billing when standard pricing is absent or lookup fails", async (t) => {
		const model = makeModel();
		model.cost = { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 };
		const sources = [{ url: "https://example.com", title: "Example" }];
		const events = [
			{ type: "response.output_text.delta", delta: "Search summary" },
			{ type: "response.completed", response: {
				usage: { input_tokens: 1200, output_tokens: 300 },
				output: [{ type: "web_search_call", action: { sources } }],
			} },
		];
		const fetchFn = t.mock.fn(async () =>
			new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")),
		);
		for (const getStandardCost of [
			undefined,
			async () => undefined,
			() => { throw new Error("Synchronous pricing failure"); },
			async () => { throw new Error("Asynchronous pricing failure"); },
		]) {
			const result = await executeWebSearch({ query: "test", ctx: mockContext(model), fetchFn, getStandardCost });
			const text = "Search summary\n\n## Sources\n1. [Example](https://example.com)";
			assert.deepEqual(result.content, [{ type: "text", text }]);
			assert.deepEqual(result.structuredContent, { query: "test", text, sources });
			assert.equal("usage" in result, false);
			assert.equal("error" in result.details, false);
		}
		assert.equal(fetchFn.mock.calls.length, 4);
		assert.deepEqual(model.cost, { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 });
	});

	it("does not swallow cancellation during successful or failed pricing lookups", async (t) => {
		const fetchFn = t.mock.fn(async () => new Response(""));
		const error = new Error("Cancelled");
		for (const rejectLookup of [false, true]) {
			const controller = new AbortController();
			await assert.rejects(executeWebSearch({
				query: "test", ctx: mockContext(), fetchFn, signal: controller.signal,
				getStandardCost: async () => {
					controller.abort(error);
					if (rejectLookup) throw new Error("Pricing lookup aborted");
					return standardPricing.getStandardCost();
				},
			}), (actual) => actual === error);
		}
		await assert.rejects(executeWebSearch({
			query: "test", ctx: mockContext(), fetchFn, signal: AbortSignal.abort(error),
		}), (actual) => actual === error);
		assert.equal(fetchFn.mock.calls.length, 0);
	});

	it("keeps valid usage when optional fields are absent or counts are zero", async () => {
		for (const [input, output] of [[1200, 300], [0, 0]] as const) {
			const result = await executeWebSearch({
				...standardPricing,
				query: "test",
				ctx: mockContext(),
				fetchFn: async () => new Response(createMockStream([
					'data: {"type":"response.output_text.delta","delta":"Search summary"}\n\n',
					`data: ${JSON.stringify({
						type: "response.completed",
						response: { usage: { input_tokens: input, output_tokens: output } },
					})}\n\n`,
				])),
			});
			assert.ok(result.usage);
			assert.deepEqual(result.usage, {
				input,
				output,
				cacheRead: 0,
				cacheWrite: 0,
				reasoning: 0,
				totalTokens: input + output,
				cost: {
					input: input * 1.25 / 1_000_000,
					output: output * 10 / 1_000_000,
					cacheRead: 0,
					cacheWrite: 0,
					total: input * 1.25 / 1_000_000 + output * 10 / 1_000_000,
				},
			});
		}
	});

	it("silently drops invalid billing metadata without changing results or retrying", async (t) => {
		const validUsage = { input_tokens: 1200, output_tokens: 300 };
		const pricingFailureModel = makeModel();
		Object.defineProperty(pricingFailureModel, "cost", {
			get() { throw new Error("Pricing unavailable"); },
		});
		const cases: Array<{ name: string; usage: unknown; model?: Model<Api> }> = [
			{ name: "missing usage", usage: undefined },
			{ name: "null usage", usage: null },
			{ name: "non-object usage", usage: "invalid" },
			{ name: "array usage", usage: [] },
			{ name: "empty usage", usage: {} },
			{ name: "missing input", usage: { output_tokens: 300 } },
			{ name: "missing output", usage: { input_tokens: 1200 } },
			{ name: "string input", usage: { ...validUsage, input_tokens: "1200" } },
			{ name: "null input", usage: { ...validUsage, input_tokens: null } },
			{ name: "negative output", usage: { ...validUsage, output_tokens: -300 } },
			{ name: "fractional output", usage: { ...validUsage, output_tokens: 1.5 } },
			{ name: "unsafe count", usage: { ...validUsage, input_tokens: Number.MAX_SAFE_INTEGER + 1 } },
			{ name: "invalid total", usage: { ...validUsage, total_tokens: "1500" } },
			{ name: "null total", usage: { ...validUsage, total_tokens: null } },
			{ name: "invalid input details", usage: { ...validUsage, input_tokens_details: [] } },
			{ name: "null input details", usage: { ...validUsage, input_tokens_details: null } },
			{ name: "invalid output details", usage: { ...validUsage, output_tokens_details: "invalid" } },
			{ name: "invalid cache read", usage: { ...validUsage, input_tokens_details: { cached_tokens: "200" } } },
			{ name: "invalid cache write", usage: { ...validUsage, input_tokens_details: { cache_write_tokens: -1 } } },
			{ name: "invalid reasoning", usage: { ...validUsage, output_tokens_details: { reasoning_tokens: null } } },
			{ name: "pricing failure", usage: validUsage, model: pricingFailureModel },
		];

		for (const { name, usage, model } of cases) {
			await t.test(name, async (t) => {
				const notify = t.mock.fn();
				const warn = t.mock.method(console, "warn", () => {});
				const error = t.mock.method(console, "error", () => {});
				const ctx = { ...mockContext(model), ui: { notify } } as unknown as ExtensionContext;
				const sources = [{ url: "https://example.com", title: "Example" }];
				const events = [
					{ type: "response.output_text.delta", delta: "Search summary" },
					{
						type: "response.completed",
						response: {
							usage,
							output: [{ type: "web_search_call", action: { sources } }],
						},
					},
				];
				const fetchFn = t.mock.fn(async () => new Response(createMockStream(
					events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
				)));
				const updates: string[] = [];
				const result = await executeWebSearch({
					...standardPricing,
					query: "test",
					ctx,
					fetchFn,
					onUpdate: (update) => updates.push(update.content[0]?.text ?? ""),
				});

				const text = "Search summary\n\n## Sources\n1. [Example](https://example.com)";
				assert.deepEqual(result.content, [{ type: "text", text }]);
				assert.deepEqual(result.structuredContent, { query: "test", text, sources });
				assert.equal("usage" in result, false);
				assert.equal("error" in result.details, false);
				assert.deepEqual(updates, [
					"Starting web search (gpt-5.6-sol)...",
					"Summarizing results (14 chars)...",
				]);
				assert.equal(fetchFn.mock.calls.length, 1);
				assert.equal(notify.mock.calls.length, 0);
				assert.equal(warn.mock.calls.length, 0);
				assert.equal(error.mock.calls.length, 0);
			});
		}
	});

	it("still rejects an empty search result when billing metadata is invalid", async () => {
		await assert.rejects(() => executeWebSearch({
			...standardPricing,
			query: "test",
			ctx: mockContext(),
			fetchFn: async () => new Response(createMockStream([
				'data: {"type":"response.completed","response":{"usage":{"input_tokens":"invalid"}}}\n\n',
			])),
		}), Error);
	});

	it("throws formatted error on HTTP failure", async () => {
		const ctx = mockContext();
		const mockFetch = async () =>
			new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), {
				status: 429,
				headers: { "content-type": "application/json" },
			});

		await assert.rejects(
			() => executeWebSearch({ ...standardPricing, query: "test", ctx, fetchFn: mockFetch as any }),
			/Web search failed: Quota exceeded/,
		);
	});
});
