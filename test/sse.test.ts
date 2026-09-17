import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSseParser, type SseEvent } from "../extensions/sse.ts";

describe("createSseParser", () => {
	it("parses single complete SSE event", () => {
		const events: SseEvent[] = [];
		const parser = createSseParser((e) => events.push(e));

		parser.push('event: response.output_text.delta\ndata: {"delta":"hello"}\n\n');
		parser.end();

		assert.equal(events.length, 1);
		assert.equal(events[0]?.event, "response.output_text.delta");
		assert.deepEqual(events[0]?.data, { delta: "hello" });
	});

	it("parses chunks split across boundaries", () => {
		const events: SseEvent[] = [];
		const parser = createSseParser((e) => events.push(e));

		parser.push("event: msg\n");
		parser.push('data: {"part":1');
		parser.push('}\n\n');
		parser.end();

		assert.equal(events.length, 1);
		assert.deepEqual(events[0]?.data, { part: 1 });
	});

	it("handles CRLF line endings and [DONE]", () => {
		const events: SseEvent[] = [];
		const parser = createSseParser((e) => events.push(e));

		parser.push("event: done\r\ndata: [DONE]\r\n\r\n");
		parser.end();

		assert.equal(events.length, 1);
		assert.equal(events[0]?.data, "[DONE]");
	});

	it("ignores comments", () => {
		const events: SseEvent[] = [];
		const parser = createSseParser((e) => events.push(e));

		parser.push(": ping\n\nevent: test\ndata: {}\n\n");
		parser.end();

		assert.equal(events.length, 1);
		assert.equal(events[0]?.event, "test");
	});
});
