import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { loadConfig, saveConfig } from "./config.ts";
import {
	getCliProxyModels,
	isSearchModel,
	selectSearchModel,
	sortSearchModels,
	TARGET_PROVIDER_ID,
} from "./model-selector.ts";
import { executeWebSearch } from "./search.ts";

export const TOOL_NAME = "web_search";

export const WebSearchParameters = Type.Object({
	query: Type.String({
		description: "The web search query keywords or question to look up online",
	}),
});

export interface WebSearchDetails {
	model?: string;
	provider?: string;
	query?: string;
	sourcesCount?: number;
	error?: string;
}

export default function cliproxyapiWebSearch(pi: ExtensionAPI): void {
	let activeContext: ExtensionContext | null = null;

	pi.on("session_start", (_event, ctx) => {
		activeContext = ctx;
	});
	pi.on("model_select", (_event, ctx) => {
		activeContext = ctx;
	});
	pi.on("turn_start", (_event, ctx) => {
		activeContext = ctx;
	});

	function getCandidateModelChoices(): Array<{
		value: string;
		label: string;
		description: string;
	}> {
		if (activeContext) {
			return sortSearchModels(getCliProxyModels(activeContext)).map((m) => ({
				value: m.id,
				label: m.id,
				description: m.name ? `${m.name}` : "CLIProxyAPI search model",
			}));
		}

		try {
			const candidatePath = path.join(
				os.homedir(),
				".pi",
				"agent",
				"cliproxyapi-models.json",
			);
			if (fs.existsSync(candidatePath)) {
				const raw = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
				if (Array.isArray(raw?.models)) {
					const models = raw.models
						.filter(
							(m: any) =>
								typeof m?.id === "string" && isSearchModel(m.id),
						)
						.sort((a: any, b: any) => a.id.localeCompare(b.id));
					return models.map((m: any) => ({
						value: m.id,
						label: m.id,
						description: m.name ? `${m.name}` : "CLIProxyAPI search model",
					}));
				}
			}
		} catch {
			// Ignore filesystem fallback errors
		}
		return [];
	}

	pi.registerTool({
		name: TOOL_NAME,
		label: "web_search",
		description:
			"Search the web for real-time, current, or online information (such as weather, news, recent events, documentation, or public web data) and return the results.",
		promptSnippet: "Search current and real-time information",
		promptGuidelines: [
			"Use the `web_search` tool for any questions that require real-time, current, or online information (e.g., weather, news, recent events, latest releases).",
			"Do NOT attempt to run shell commands (such as bash, PowerShell, curl, wget, python, or scripts) to search the web or check weather/news when `web_search` is available.",
			"Use the returned web search results to formulate your response accurately.",
		],
		parameters: WebSearchParameters,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			activeContext = ctx;
			const config = loadConfig();
			return executeWebSearch({
				query: (params as { query: string }).query,
				ctx,
				searchModelId: config.searchModel,
				signal,
				onUpdate,
			});
		},
		renderCall(args, theme) {
			const rawQuery = (args as { query?: unknown })?.query;
			const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
			const display = query.length > 70 ? `${query.slice(0, 67)}...` : query;
			return new Text(
				`${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg("accent", `"${display}"`)}`,
				0,
				0,
			);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			const details = (result.details ?? {}) as WebSearchDetails;

			if (isPartial) {
				const progress = result.content
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("\n");
				return new Text(theme.fg("muted", progress || "Searching web..."), 0, 0);
			}

			const isError = Boolean(details.error);
			if (isError) {
				const errorText = result.content
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("\n");
				return new Text(theme.fg("error", `✗ ${errorText || "Web search failed"}`), 0, 0);
			}

			if (!expanded) {
				const model = typeof details.model === "string" ? details.model : "";
				const count =
					typeof details.sourcesCount === "number"
						? details.sourcesCount
						: 0;
				const sourceSuffix = count > 0 ? ` (${count} source${count === 1 ? "" : "s"})` : "";
				const modelSuffix = model ? ` via ${model}` : "";
				return new Text(
					theme.fg("muted", `✓ Completed${modelSuffix}${sourceSuffix}`),
					0,
					0,
				);
			}

			const outputText = result.content
				.filter((c) => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			return new Text(theme.fg("toolOutput", outputText), 0, 0);
		},
	});

	pi.registerCommand("websearch-model", {
		description:
			"Select or set the CLIProxyAPI model used for web_search (/websearch-model [model-id|reset])",
		getArgumentCompletions(argumentPrefix) {
			const prefix = argumentPrefix.toLowerCase();
			const staticChoices = [
				{
					value: "current",
					label: "current",
					description: "Use current active session model",
				},
				{
					value: "auto",
					label: "auto",
					description: "Use current active session model",
				},
				{
					value: "reset",
					label: "reset",
					description: "Reset to current session model",
				},
			];
			const allChoices = [...staticChoices, ...getCandidateModelChoices()];
			return allChoices.filter(
				(c) =>
					c.value.toLowerCase().startsWith(prefix) ||
					(c.label ?? "").toLowerCase().startsWith(prefix),
			);
		},
		async handler(args, ctx) {
			activeContext = ctx;
			const trimmed = args.trim();
			const config = loadConfig();

			if (
				trimmed === "reset" ||
				trimmed === "auto" ||
				trimmed === "clear" ||
				trimmed === "current"
			) {
				saveConfig({ ...config, searchModel: undefined });
				const current = selectSearchModel(ctx);
				ctx.ui.notify(
					`Web search set to use current session model: ${current.provider}/${current.id}`,
					"info",
				);
				return;
			}

			// If a specific model argument is passed directly, validate against search rules
			if (trimmed) {
				const allModels = ctx.modelRegistry?.getAll() ?? [];
				const match = allModels.find(
					(m) =>
						m.provider === TARGET_PROVIDER_ID &&
						m.id.toLowerCase() === trimmed.toLowerCase(),
				);
				const modelId = match ? match.id : trimmed;
				if (!isSearchModel(modelId)) {
					ctx.ui.notify(
						`Model "${modelId}" does not match predefined CLIProxyAPI search rules`,
						"warning",
					);
					return;
				}
				saveConfig({ ...config, searchModel: modelId });
				ctx.ui.notify(`Web search model set to: ${TARGET_PROVIDER_ID}/${modelId}`, "info");
				return;
			}

			// Interactive selection via ctx.ui.select when no arguments provided and UI is available
			if (ctx.hasUI) {
				const models = sortSearchModels(getCliProxyModels(ctx));
				if (models.length === 0) {
					ctx.ui.notify(
						"No matching predefined search models available in CLIProxyAPI registry",
						"warning",
					);
					return;
				}

				const currentConfigured = config.searchModel?.toLowerCase();
				const currentModelTag = !currentConfigured ? " (current)" : "";
				const currentModelOption = `Current model (use active session model)${currentModelTag}`;
				const options: string[] = [currentModelOption];

				for (const model of models) {
					const isCurrent = model.id.toLowerCase() === currentConfigured;
					const tagStr = isCurrent ? " (current)" : "";
					options.push(`${model.id}${tagStr}`);
				}

				const choice = await ctx.ui.select("Select Web Search Model", options);
				if (!choice) {
					ctx.ui.notify("Model selection cancelled", "info");
					return;
				}

				if (choice.startsWith("Current model")) {
					saveConfig({ ...config, searchModel: undefined });
					const current = selectSearchModel(ctx);
					ctx.ui.notify(
						`Web search set to use current session model: ${current.provider}/${current.id}`,
						"info",
					);
					return;
				}

				const selectedId = choice.split(" ")[0]!;
				saveConfig({ ...config, searchModel: selectedId });
				ctx.ui.notify(`Web search model set to: ${TARGET_PROVIDER_ID}/${selectedId}`, "info");
				return;
			}

			// Non-interactive fallback: display current configuration
			const current = selectSearchModel(ctx, config.searchModel);
			const configuredNote = config.searchModel
				? `(configured: ${config.searchModel})`
				: "(current session model)";
			ctx.ui.notify(
				`Current web search model: ${current.provider}/${current.id} ${configuredNote}`,
				"info",
			);
		},
	});
}
