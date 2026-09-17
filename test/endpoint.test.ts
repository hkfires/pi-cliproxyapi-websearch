import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveResponsesEndpoint } from "../extensions/endpoint.ts";

describe("resolveResponsesEndpoint", () => {
	it("resolves base origin to /v1/responses", () => {
		assert.equal(
			resolveResponsesEndpoint("https://cpa.example.com"),
			"https://cpa.example.com/v1/responses",
		);
		assert.equal(
			resolveResponsesEndpoint("https://cpa.example.com/"),
			"https://cpa.example.com/v1/responses",
		);
	});

	it("resolves /v1 to /v1/responses", () => {
		assert.equal(
			resolveResponsesEndpoint("https://cpa.example.com/v1"),
			"https://cpa.example.com/v1/responses",
		);
		assert.equal(
			resolveResponsesEndpoint("https://cpa.example.com/v1/"),
			"https://cpa.example.com/v1/responses",
		);
	});

	it("resolves /backend-api to /backend-api/codex/responses", () => {
		assert.equal(
			resolveResponsesEndpoint("https://cpa.example.com/backend-api"),
			"https://cpa.example.com/backend-api/codex/responses",
		);
		assert.equal(
			resolveResponsesEndpoint("https://cpa.example.com/backend-api/"),
			"https://cpa.example.com/backend-api/codex/responses",
		);
	});

	it("resolves /codex to /codex/responses", () => {
		assert.equal(
			resolveResponsesEndpoint("https://cpa.example.com/backend-api/codex"),
			"https://cpa.example.com/backend-api/codex/responses",
		);
	});

	it("preserves ready /responses endpoints", () => {
		assert.equal(
			resolveResponsesEndpoint("https://cpa.example.com/v1/responses"),
			"https://cpa.example.com/v1/responses",
		);
		assert.equal(
			resolveResponsesEndpoint(
				"https://cpa.example.com/backend-api/codex/responses",
			),
			"https://cpa.example.com/backend-api/codex/responses",
		);
	});

	it("throws on empty baseUrl", () => {
		assert.throws(() => resolveResponsesEndpoint(""), /empty/);
		assert.throws(() => resolveResponsesEndpoint("   "), /empty/);
	});
});
