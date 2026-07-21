import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import livewireViteReact from "../../src/vite";

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(fixtureDirectory, "../..");

export default defineConfig({
    publicDir: false,
    root: path.join(packageDirectory, "workbench"),
    plugins: [
        livewireViteReact({
            sourceDirectories: ["resources/views"],
        }),
    ],
    build: {
        emptyOutDir: true,
        minify: false,
        outDir: "public/build",
        rollupOptions: {
            input: [],
            output: { entryFileNames: "assets/[hash].js" },
        },
    },
});
