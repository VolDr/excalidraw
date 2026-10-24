import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Consume built monorepo packages rather than importing React TSX sources.
// Run "yarn build:packages" from the repository root before starting Vite.
export default defineConfig({
  plugins: [svelte()],
});
