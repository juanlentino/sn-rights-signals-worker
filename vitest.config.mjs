import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Real workerd runtime (not Node) — needed because robots.mjs, tdmrep.mjs,
// and html-injector.mjs exercise Workers-only globals (HTMLRewriter, the
// Cache-aware fetch()) that don't exist in plain Node.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
