/**
 * Resolve the OpenAI Responses endpoint URL for CLIProxyAPI from the model or auth baseUrl.
 */
export function resolveResponsesEndpoint(baseUrl: string): string {
	const normalized = baseUrl.trim().replace(/\/+$/, "");
	if (!normalized) {
		throw new Error("CLIProxyAPI baseUrl is empty");
	}
	if (normalized.endsWith("/responses")) {
		return normalized;
	}
	if (normalized.endsWith("/codex")) {
		return `${normalized}/responses`;
	}
	if (normalized.endsWith("/backend-api")) {
		return `${normalized}/codex/responses`;
	}
	if (normalized.endsWith("/v1")) {
		return `${normalized}/responses`;
	}
	return `${normalized}/v1/responses`;
}
