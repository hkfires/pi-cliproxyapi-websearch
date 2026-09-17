import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

it("loads manifest entry points with Pi's actual TypeScript loader", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-websearch-"));
	try {
		await cp("extensions", join(root, "extensions"), { recursive: true });
		await cp("package.json", join(root, "package.json"));
		const loaded = await discoverAndLoadExtensions(
			[root],
			root,
			join(root, "agent"),
		);
		assert.deepEqual(loaded.errors, []);
		assert.equal(loaded.extensions.length, 1);
		const extension = loaded.extensions[0];
		assert.ok(extension);

		assert.equal(extension.tools.has("web_search"), true);
		const tool = extension.tools.get("web_search");
		assert.equal(tool?.definition.name, "web_search");
		assert.equal(tool?.definition.label, "web_search");
		assert.ok(tool?.definition.description.includes("Search the web"));

		assert.equal(extension.commands.has("websearch-model"), true);
		const command = extension.commands.get("websearch-model");
		assert.equal(command?.name, "websearch-model");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
