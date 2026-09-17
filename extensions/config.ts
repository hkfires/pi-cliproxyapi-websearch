import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface WebSearchConfig {
	searchModel?: string;
}

const CONFIG_FILE_NAME = "cliproxyapi-websearch.json";

export function getConfigPath(agentDir = getAgentDir()): string {
	return join(agentDir, CONFIG_FILE_NAME);
}

export function loadConfig(agentDir = getAgentDir()): WebSearchConfig {
	const path = getConfigPath(agentDir);
	try {
		if (!existsSync(path)) return {};
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return {
				searchModel:
					typeof parsed.searchModel === "string" && parsed.searchModel.trim()
						? parsed.searchModel.trim()
						: undefined,
			};
		}
		return {};
	} catch {
		return {};
	}
}

export function saveConfig(config: WebSearchConfig, agentDir = getAgentDir()): void {
	const path = getConfigPath(agentDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
