import { defineConfig } from "vitest/config";

// Minimum env to satisfy the Zod config schema during tests. Values are
// fake — tests must not make real network calls or write to a real vault.
export default defineConfig({
  test: {
    env: {
      ANTHROPIC_API_KEY: "sk-ant-test-not-real",
      INTAKE_TOKEN: "test-intake-token-at-least-sixteen-chars",
      VAULT_REMOTE: "https://example.invalid/test-vault.git",
      WHATSAPP_TO_NUMBER: "",
      WHATSAPP_APP_SECRET: "",
      DB_PATH: ":memory:",
    },
  },
});
