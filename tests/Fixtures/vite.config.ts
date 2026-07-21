import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import livewireBridge from "../../src/index";

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(fixtureDirectory, "../..");

export default defineConfig({
    publicDir: false,
    root: path.join(packageDirectory, "workbench"),
    plugins: [livewireBridge()],
    build: {
        emptyOutDir: true,
        manifest: "manifest.json",
        minify: false,
        outDir: "public/build",
        rollupOptions: {
            input: [],
            output: { entryFileNames: "assets/[hash].js" },
        },
    },
});
