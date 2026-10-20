import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Consume built monorepo packages rather than importing React TSX sources.
// Run "yarn build:packages" from the repository root before starting Vite.
export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/native/setupTests.ts"],
  },
});
