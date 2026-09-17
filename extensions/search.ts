import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveResponsesEndpoint } from "./endpoint.ts";
import { selectSearchModel } from "./model-selector.ts";
import { consumeSseStream, type SseEvent } from "./sse.ts";

export interface SearchProgressUpdate {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

export interface WebSearchResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

export interface WebSearchSource {
	title?: string;
	url: string;
}

export const SEARCH_INSTRUCTIONS =
	"You are a web search assistant. Search the web to find accurate, up-to-date information for the user's query. Provide a comprehensive summary with all relevant details, numbers, dates, and sources.";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractErrorMessage(payload: unknown, defaultMsg: string): string {
	if (!isRecord(payload)) return defaultMsg;
	const error = isRecord(payload.error) ? payload.error : undefined;
	if (error && typeof error.message === "string" && error.message.trim()) {
		return error.message.trim();
	}
	if (typeof payload.message === "string" && payload.message.trim()) {
		return payload.message.trim();
	}
	return defaultMsg;
}

function extractSourcesFromItem(
	item: Record<string, unknown>,
	sourcesMap: Map<string, string>,
): void {
	if (item.type === "web_search_call") {
		const action = isRecord(item.action) ? item.action : undefined;
		if (action && Array.isArray(action.sources)) {
			for (const s of action.sources) {
				if (isRecord(s) && typeof s.url === "string" && s.url.trim()) {
					const url = s.url.trim();
					const title = typeof s.title === "string" ? s.title.trim() : "";
					if (!sourcesMap.has(url) || (!sourcesMap.get(url) && title)) {
						sourcesMap.set(url, title);
					}
				}
			}
		}
	} else if (item.type === "message" && Array.isArray(item.content)) {
		for (const part of item.content) {
			if (isRecord(part) && Array.isArray(part.annotations)) {
				for (const ann of part.annotations) {
					if (isRecord(ann) && typeof ann.url === "string" && ann.url.trim()) {
						const url = ann.url.trim();
						const title = typeof ann.title === "string" ? ann.title.trim() : "";
						if (!sourcesMap.has(url) || (!sourcesMap.get(url) && title)) {
							sourcesMap.set(url, title);
						}
					}
				}
			}
		}
	}
}

export async function executeWebSearch(options: {
	query: string;
	ctx: ExtensionContext;
	searchModelId?: string;
	signal?: AbortSignal;
	onUpdate?: (update: SearchProgressUpdate) => void;
	fetchFn?: typeof fetch;
}): Promise<WebSearchResult> {
	const { query, ctx, searchModelId, signal, onUpdate, fetchFn = fetch } = options;
	const trimmedQuery = query.trim();
	if (!trimmedQuery) {
		throw new Error("web_search requires a non-empty query");
	}

	const startTime = Date.now();

	const targetModel = selectSearchModel(ctx, searchModelId);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(targetModel);
	if (!auth.ok) {
		throw new Error(auth.error || `Failed to resolve auth for ${targetModel.id}`);
	}

	const baseUrl = auth.baseUrl || targetModel.baseUrl;
	if (!baseUrl) {
		throw new Error(`No baseUrl available for model ${targetModel.provider}/${targetModel.id}`);
	}

	const endpoint = resolveResponsesEndpoint(baseUrl);
	const headers: Record<string, string> = {
		"content-type": "application/json",
		accept: "text/event-stream",
		...(auth.headers ?? {}),
	};
	if (auth.apiKey && !Object.keys(headers).some((k) => k.toLowerCase() === "authorization")) {
		headers.authorization = `Bearer ${auth.apiKey}`;
	}

	onUpdate?.({
		content: [{ type: "text", text: `Connecting to web search (${targetModel.id})...` }],
		details: { model: targetModel.id, phase: "connecting" },
	});

	const requestBody = {
		model: targetModel.id,
		input: [
			{
				role: "user",
				content: [{ type: "input_text", text: trimmedQuery }],
			},
		],
		instructions: SEARCH_INSTRUCTIONS,
		tools: [{ type: "web_search" }],
		stream: true,
		store: false,
	};

	const response = await fetchFn(endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify(requestBody),
		signal,
	});

	if (!response.ok) {
		let errorText = `HTTP ${response.status}`;
		try {
			const body = await response.text();
			const parsed = JSON.parse(body);
			errorText = extractErrorMessage(parsed, errorText);
		} catch {
			// keep fallback
		}
		throw new Error(`Web search failed: ${errorText}`);
	}

	if (!response.body) {
		throw new Error("Web search streaming response has no body");
	}

	let outputText = "";
	const messageParts: string[] = [];
	const sourcesMap = new Map<string, string>();
	let lastPhase = "";
	let lastDeltaUpdateTime = 0;
	const DELTA_THROTTLE_MS = 100;

	await consumeSseStream(
		response.body,
		({ event, data }: SseEvent) => {
			const eventType =
				isRecord(data) && typeof data.type === "string" ? data.type : event;

			if (eventType === "response.failed" || eventType === "error") {
				throw new Error(extractErrorMessage(data, "Web search response failed"));
			}

			if (eventType === "response.web_search_call.searching") {
				if (lastPhase !== "searching") {
					lastPhase = "searching";
					onUpdate?.({
						content: [{ type: "text", text: `Searching the web for: "${trimmedQuery}"...` }],
						details: { phase: "searching", model: targetModel.id },
					});
				}
			} else if (eventType === "response.web_search_call.completed") {
				if (lastPhase !== "analyzing") {
					lastPhase = "analyzing";
					onUpdate?.({
						content: [{ type: "text", text: "Analyzing search results..." }],
						details: { phase: "analyzing", model: targetModel.id },
					});
				}
			} else if (eventType === "response.output_text.delta") {
				if (isRecord(data) && typeof data.delta === "string") {
					outputText += data.delta;
					const now = Date.now();
					if (now - lastDeltaUpdateTime >= DELTA_THROTTLE_MS) {
						lastDeltaUpdateTime = now;
						onUpdate?.({
							content: [
								{
									type: "text",
									text: `Summarizing results (${outputText.length} chars)...`,
								},
							],
							details: {
								phase: "generating",
								chars: outputText.length,
								model: targetModel.id,
							},
						});
					}
				}
			} else if (eventType === "response.output_text.done") {
				if (isRecord(data) && typeof data.text === "string" && !outputText) {
					outputText = data.text;
				}
				onUpdate?.({
					content: [
						{
							type: "text",
							text: `Summarizing results (${outputText.length} chars)...`,
						},
					],
					details: {
						phase: "generating",
						chars: outputText.length,
						model: targetModel.id,
					},
				});
			} else if (
				eventType === "response.output_item.done" ||
				eventType === "response.content_part.done"
			) {
				const item =
					isRecord(data) && isRecord(data.item)
						? data.item
						: isRecord(data) && isRecord(data.part)
							? data.part
							: isRecord(data)
								? data
								: undefined;
				if (item) {
					extractSourcesFromItem(item, sourcesMap);
					if (item.type === "message" && Array.isArray(item.content)) {
						for (const part of item.content) {
							if (
								isRecord(part) &&
								(part.type === "output_text" || part.type === "text") &&
								typeof part.text === "string"
							) {
								messageParts.push(part.text);
							}
						}
					}
				}
			} else if (eventType === "response.completed") {
				const res = isRecord(data) && isRecord(data.response) ? data.response : data;
				if (isRecord(res) && Array.isArray(res.output)) {
					for (const item of res.output) {
						if (isRecord(item)) {
							extractSourcesFromItem(item, sourcesMap);
						}
					}
				}
			}
		},
		signal,
	);

	let finalText = outputText.trim() || messageParts.join("").trim();
	if (!finalText) {
		throw new Error("Web search completed without any search result text");
	}

	if (sourcesMap.size > 0 && !finalText.includes("http://") && !finalText.includes("https://")) {
		const sourceLines = Array.from(sourcesMap.entries())
			.slice(0, 8)
			.map(([url, title], index) => `${index + 1}. [${title || url}](${url})`);
		finalText += `\n\n## Sources\n${sourceLines.join("\n")}`;
	}

	return {
		content: [{ type: "text", text: finalText }],
		details: {
			model: targetModel.id,
			provider: targetModel.provider,
			query: trimmedQuery,
			sourcesCount: sourcesMap.size,
			durationMs: Date.now() - startTime,
		},
	};
}
