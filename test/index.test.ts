import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import cliproxyapiWebSearch, { TOOL_NAME } from "../extensions/index.ts";

let registeredTool: ToolDefinition | undefined;
let registeredCommand: any;
let mockPi: any;
let eventHandlers = new Map<string, Function>();

beforeEach(() => {
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

		await registeredCommand.handler("", mockCtx);
		assert.equal(selectTitle, "Select Web Search Model");
		assert.ok(selectOptions.some((o) => o.includes("Current model")));
		assert.ok(selectOptions.some((o) => o.includes("gpt-5.6-sol")));
		assert.ok(notifiedMessage.includes("gpt-5.6-sol"));

		await registeredCommand.handler("current", mockCtx);
		assert.ok(notifiedMessage.includes("current session model"));
	});

	it("renders tool call cleanly", () => {
		assert.ok(registeredTool?.renderCall);
		const theme = {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		} as any;
		const comp = registeredTool.renderCall({ query: "test query" }, theme, {} as any);
		const lines = comp.render(80);
		assert.ok(lines.some((l: string) => l.includes('"test query"')));
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
});

