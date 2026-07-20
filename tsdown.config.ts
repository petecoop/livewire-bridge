import { defineConfig } from "tsdown";

export default defineConfig({
    entry: {
        runtime: "src/runtime.ts",
        vite: "src/vite.ts",
    },
    format: "esm",
    fixedExtension: false,
    target: "es2022",
    dts: true,
    sourcemap: true,
    clean: true,
    deps: {
        neverBundle: ["react", "react-dom", "vite"],
    },
});
