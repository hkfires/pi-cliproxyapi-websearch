import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeWebSearch } from "../extensions/search.ts";

function makeModel(id = "gpt-5.6-sol"): Model<Api> {
	return {
		id,
		provider: "cliproxyapi",
		api: "cliproxyapi-codex-responses",
		baseUrl: "https://cpa.example.com/backend-api",
		name: id,
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
	it("rejects empty or whitespace query", async () => {
		const ctx = mockContext();
		await assert.rejects(
			() => executeWebSearch({ query: "", ctx }),
			/requires a non-empty query/,
		);
		await assert.rejects(
			() => executeWebSearch({ query: "   ", ctx }),
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

		const updates: string[] = [];
		const result = await executeWebSearch({
			query: "Ningbo weather",
			ctx,
			fetchFn: mockFetch as any,
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

		assert.ok(result.content[0]?.text.includes("Ningbo weather forecast: cloudy, temperatures 22-29C."));
		assert.ok(result.content[0]?.text.includes("## Sources"));
		assert.ok(result.content[0]?.text.includes("[Weather CN](https://weather.example.com)"));
		assert.equal(result.details.model, "gpt-5.6-sol");
		assert.equal(typeof result.details.durationMs, "number");
		assert.ok((result.details.durationMs as number) >= 0);
	});

	it("throws formatted error on HTTP failure", async () => {
		const ctx = mockContext();
		const mockFetch = async () =>
			new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), {
				status: 429,
				headers: { "content-type": "application/json" },
			});

		await assert.rejects(
			() => executeWebSearch({ query: "test", ctx, fetchFn: mockFetch as any }),
			/Web search failed: Quota exceeded/,
		);
	});
});
