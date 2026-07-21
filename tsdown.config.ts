import { defineConfig } from "tsdown";

export default defineConfig({
    entry: {
        index: "src/index.ts",
        "react-runtime": "src/react-runtime.ts",
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
