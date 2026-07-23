import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Real workerd runtime (not Node) — needed because robots.mjs, tdmrep.mjs,
// and html-injector.mjs exercise Workers-only globals (HTMLRewriter, the
// Cache-aware fetch()) that don't exist in plain Node.
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: { wrangler: { configPath: "./wrangler.jsonc" } },
    },
  },
});
