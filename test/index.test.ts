import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { getConfigPath } from "../extensions/config.ts";
import cliproxyapiWebSearch, {
	formatDuration,
	TOOL_NAME,
	type WebSearchRenderState,
} from "../extensions/index.ts";

let registeredTool: ToolDefinition | undefined;
let registeredCommand: any;
let mockPi: any;
let eventHandlers = new Map<string, Function>();
let testAgentDir: string;
let previousAgentDir: string | undefined;

beforeEach(() => {
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	testAgentDir = mkdtempSync(join(tmpdir(), "pi-websearch-test-"));
	process.env.PI_CODING_AGENT_DIR = testAgentDir;
	registeredTool = undefined;
	registeredCommand = undefined;
	eventHandlers = new Map();
	mockPi = {
		on: mock.fn((event: string, handler: Function) => {
			eventHandlers.set(event, handler);
		}),
		registerTool: mock.fn((tool: ToolDefinition) => {
			registeredTool = tool;
		}),
		registerCommand: mock.fn((name: string, options: any) => {
			registeredCommand = { name, ...options };
		}),
	};
	cliproxyapiWebSearch(mockPi as unknown as ExtensionAPI);
});

afterEach(() => {
	if (previousAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
	rmSync(testAgentDir, { recursive: true, force: true });
});

describe("extension registration", () => {
	it("registers web_search tool with complete schema and guidelines", () => {
		assert.equal(mockPi.registerTool.mock.calls.length, 1);
		assert.ok(registeredTool);
		assert.equal(registeredTool.name, TOOL_NAME);
		assert.equal(registeredTool.label, "web_search");
		assert.ok(registeredTool.description.includes("Search the web"));
		assert.ok(registeredTool.promptGuidelines?.length);
		assert.ok(
			registeredTool.promptGuidelines.some((g: string) =>
				g.includes("Do NOT attempt to run shell commands"),
			),
		);
		assert.equal((registeredTool.parameters as any).type, "object");
		assert.ok("query" in ((registeredTool.parameters as any).properties ?? {}));
	});

	it("registers websearch-model command with autocompletions and interactive selection", async () => {
		assert.equal(mockPi.registerCommand.mock.calls.length, 1);
		assert.ok(registeredCommand);
		assert.equal(registeredCommand.name, "websearch-model");
		assert.equal(typeof registeredCommand.handler, "function");
		assert.equal(typeof registeredCommand.getArgumentCompletions, "function");

		// Test interactive selection via select dialog
		let selectTitle = "";
		let selectOptions: string[] = [];
		let notifiedMessage = "";

		const mockCtx = {
			hasUI: true,
			model: { id: "gemini-3.8-flash-high", provider: "cliproxyapi" },
			modelRegistry: {
				getAll: () => [
					{ id: "gpt-5.6-sol", provider: "cliproxyapi" },
					{ id: "gemini-3.8-flash-high", provider: "cliproxyapi" },
				],
				getAvailable: () => [
					{ id: "gpt-5.6-sol", provider: "cliproxyapi" },
					{ id: "gemini-3.8-flash-high", provider: "cliproxyapi" },
				],
			},
			ui: {
				select: async (title: string, options: string[]) => {
					selectTitle = title;
					selectOptions = options;
					return options.find((o) => o.startsWith("gpt-5.6-sol"));
				},
				notify: (msg: string) => {
					notifiedMessage = msg;
				},
			},
		} as any;

		// Provide session context
		eventHandlers.get("session_start")?.({ type: "session_start" }, mockCtx);

		// Test completions
		const completionsCur = registeredCommand.getArgumentCompletions("cur");
		assert.ok(completionsCur.some((c: any) => c.value === "current"));

		const completionsGpt = registeredCommand.getArgumentCompletions("gpt");
		assert.ok(completionsGpt.some((c: any) => c.value === "gpt-5.6-sol"));

		assert.equal(getConfigPath(), join(testAgentDir, "cliproxyapi-websearch.json"));
		await registeredCommand.handler("", mockCtx);
		assert.deepEqual(
			JSON.parse(readFileSync(join(testAgentDir, "cliproxyapi-websearch.json"), "utf8")),
			{ searchModel: "gpt-5.6-sol" },
		);
		assert.equal(selectTitle, "Select Web Search Model");
		assert.ok(selectOptions.some((o) => o.includes("Current model")));
		assert.ok(selectOptions.some((o) => o.includes("gpt-5.6-sol")));
		assert.ok(notifiedMessage.includes("gpt-5.6-sol"));

		await registeredCommand.handler("current", mockCtx);
		assert.ok(notifiedMessage.includes("current session model"));
		assert.deepEqual(
			JSON.parse(readFileSync(join(testAgentDir, "cliproxyapi-websearch.json"), "utf8")),
			{},
		);
	});

	it("renders tool call cleanly without artificial outer quotes", () => {
		assert.ok(registeredTool?.renderCall);
		const theme = {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		} as any;
		const comp = registeredTool.renderCall({ query: "test query" }, theme, {} as any);
		const lines = comp.render(80);
		assert.ok(lines.some((l: string) => l.includes("web_search test query")));
		assert.ok(!lines.some((l: string) => l.includes('"test query"')));

		// Preserves query's own inner quotes cleanly without doubling
		const quoteComp = registeredTool.renderCall(
			{ query: '"definePluginEntry" "registerProvider"' },
			theme,
			{} as any,
		);
		const quoteLines = quoteComp.render(80);
		assert.ok(
			quoteLines.some((l: string) =>
				l.includes('web_search "definePluginEntry" "registerProvider"'),
			),
		);
		assert.ok(!quoteLines.some((l: string) => l.includes('""definePluginEntry"')));
	});

	it("renders tool result compactly when collapsed and verbose when expanded", () => {
		assert.ok(registeredTool?.renderResult);
		const theme = {
			fg: (_color: string, text: string) => text,
		} as any;

		// Collapsed
		const collapsedComp = registeredTool.renderResult(
			{
				content: [{ type: "text", text: "Long detailed weather content" }],
				details: { model: "gpt-5.6-sol", sourcesCount: 2 },
			} as any,
			{ expanded: false, isPartial: false },
			theme,
			{} as any,
		);
		const collapsedLines = collapsedComp.render(80);
		assert.ok(collapsedLines.some((l: string) => l.includes("Completed via gpt-5.6-sol (2 sources)")));

		// Expanded
		const expandedComp = registeredTool.renderResult(
			{
				content: [{ type: "text", text: "Long detailed weather content" }],
				details: { model: "gpt-5.6-sol", sourcesCount: 2 },
			} as any,
			{ expanded: true, isPartial: false },
			theme,
			{} as any,
		);
		const expandedLines = expandedComp.render(80);
		assert.ok(expandedLines.some((l: string) => l.includes("Long detailed weather content")));

		// Streaming partial
		const partialComp = registeredTool.renderResult(
			{
				content: [{ type: "text", text: "Searching web for: test..." }],
				details: {},
			} as any,
			{ expanded: false, isPartial: true },
			theme,
			{} as any,
		);
		const partialLines = partialComp.render(80);
		assert.ok(partialLines.some((l: string) => l.includes("Searching web for: test...")));
	});

	it("formats duration correctly", () => {
		assert.equal(formatDuration(0), "0.0s");
		assert.equal(formatDuration(1100), "1.1s");
		assert.equal(formatDuration(2540), "2.5s");
		assert.equal(formatDuration(-100), "0.0s");
	});

	it("renders execution time (Took / Elapsed) matching shell tool conventions", () => {
		assert.ok(registeredTool?.renderResult);
		const theme = {
			fg: (_color: string, text: string) => text,
		} as any;

		// Collapsed with duration
		const collapsedWithTime = registeredTool.renderResult(
			{
				content: [{ type: "text", text: "Summary text" }],
				details: { model: "gpt-5.6-sol", sourcesCount: 3, durationMs: 1100 },
			} as any,
			{ expanded: false, isPartial: false },
			theme,
			{} as any,
		);
		const collapsedLines = collapsedWithTime.render(80);
		assert.ok(collapsedLines.some((l: string) => l.includes("Completed via gpt-5.6-sol (3 sources)")));
		assert.ok(collapsedLines.some((l: string) => l.includes("Took 1.1s")));
		assert.equal(collapsedLines.length, 3);
		assert.equal(collapsedLines[1]?.trim(), "");

		// Expanded with duration
		const expandedWithTime = registeredTool.renderResult(
			{
				content: [{ type: "text", text: "Summary text" }],
				details: { model: "gpt-5.6-sol", sourcesCount: 3, durationMs: 2300 },
			} as any,
			{ expanded: true, isPartial: false },
			theme,
			{} as any,
		);
		const expandedLines = expandedWithTime.render(80);
		assert.ok(expandedLines.some((l: string) => l.includes("Summary text")));
		assert.ok(expandedLines.some((l: string) => l.includes("Took 2.3s")));

		// Error with duration
		const errorWithTime = registeredTool.renderResult(
			{
				content: [{ type: "text", text: "Rate limit reached" }],
				details: { error: "Rate limit reached", durationMs: 800 },
			} as any,
			{ expanded: false, isPartial: false },
			theme,
			{} as any,
		);
		const errorLines = errorWithTime.render(80);
		assert.ok(errorLines.some((l: string) => l.includes("✗ Rate limit reached")));
		assert.ok(errorLines.some((l: string) => l.includes("Took 0.8s")));

		// Partial with live state timer
		const state: WebSearchRenderState = { startedAt: Date.now() - 1500 };
		const partialWithState = registeredTool.renderResult(
			{
				content: [{ type: "text", text: "Starting..." }],
				details: {},
			} as any,
			{ expanded: false, isPartial: true },
			theme,
			{ state, invalidate: () => {} } as any,
		);
		const partialLines = partialWithState.render(80);
		assert.ok(partialLines.some((l: string) => l.includes("Starting...")));
		assert.ok(partialLines.some((l: string) => l.includes("Elapsed ")));
		assert.ok(state.interval !== undefined);

		// Completion cleans up interval and sets endedAt
		registeredTool.renderResult(
			{
				content: [{ type: "text", text: "Done" }],
				details: {},
			} as any,
			{ expanded: false, isPartial: false },
			theme,
			{ state } as any,
		);
		assert.equal(state.interval, undefined);
		assert.ok(typeof state.endedAt === "number");
	});
});

