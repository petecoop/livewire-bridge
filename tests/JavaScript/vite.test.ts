// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build, type Plugin } from "vite";
import livewireBridge, { exceptLivewire, livewirePaths } from "../../src/index";

const temporaryDirectories: string[] = [];

function fixtureRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "livewire-bridge-"));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, "resources/views"), { recursive: true });

    return root;
}

function multiFileFixture(
    root: string,
    name: string,
    extension: string,
    script: string,
    view = "<div></div>",
): string {
    const directory = path.join(root, "resources/views/pages", `⚡${name}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${name}.php`), "<?php new class {};\n");
    fs.writeFileSync(path.join(directory, `${name}.blade.php`), view);
    fs.writeFileSync(path.join(directory, `${name}.${extension}`), script);

    return `resources/views/pages/⚡${name}/${name}.${extension}`;
}

function hook(plugin: Plugin, name: keyof Plugin): (...arguments_: any[]) => any {
    const candidate = plugin[name];

    if (typeof candidate === "function") {
        return candidate;
    }

    if (candidate !== null && typeof candidate === "object" && "handler" in candidate) {
        return candidate.handler;
    }

    throw new Error(`Vite hook ${String(name)} is unavailable`);
}

function encode(source: string): string {
    return Buffer.from(source, "utf8").toString("base64url");
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe("livewireBridge", () => {
    it("exports Livewire's default component paths", () => {
        expect(livewirePaths).toEqual([
            "resources/views/components",
            "resources/views/livewire",
            "resources/views/layouts",
            "resources/views/pages",
        ]);
    });

    it("excludes refresh paths that contain Livewire components", () => {
        const refreshPaths = [
            "app/Livewire/**",
            "app/View/Components/**",
            "resources/views/**",
            "routes/**",
        ];

        expect(exceptLivewire(refreshPaths)).toEqual([
            "app/Livewire/**",
            "app/View/Components/**",
            "routes/**",
        ]);
        expect(refreshPaths).toHaveLength(4);
    });

    it("deduplicates React when the package is linked into an application", () => {
        const plugin = livewireBridge();
        const config = hook(plugin, "config")({
            resolve: { dedupe: ["existing-package", "react"] },
        });

        expect(config.resolve.dedupe).toEqual([
            "existing-package",
            "react",
            "react-dom",
        ]);
    });

    it("discovers marked Blade scripts and emits build entries and a manifest", async () => {
        const root = fixtureRoot();
        const source = "resources/views/livewire/counter.blade.php";
        fs.mkdirSync(path.dirname(path.join(root, source)), {
            recursive: true,
        });
        fs.writeFileSync(
            path.join(root, source),
            `
            <div wire:ref="app"></div>
            <script lang="tsx" bridge:react="app">
                export default function Counter() {
                    return <button>Count</button>;
                }
            </script>
        `,
        );

        await build({
            root,
            logLevel: "silent",
            plugins: [livewireBridge()],
            resolve: {
                alias: [
                    {
                        find: "@petecoop/livewire-bridge/react",
                        replacement: path.resolve("src/react-runtime.ts"),
                    },
                    {
                        find: "react-dom/client",
                        replacement: path.resolve("node_modules/react-dom/client.js"),
                    },
                    {
                        find: "react/jsx-runtime",
                        replacement: path.resolve("node_modules/react/jsx-runtime.js"),
                    },
                    {
                        find: "react/jsx-dev-runtime",
                        replacement: path.resolve("node_modules/react/jsx-dev-runtime.js"),
                    },
                    {
                        find: "react",
                        replacement: path.resolve("node_modules/react/index.js"),
                    },
                ],
            },
            build: {
                emptyOutDir: true,
                manifest: "manifest.json",
                minify: false,
                outDir: "dist",
                rollupOptions: { input: [] },
            },
        });

        const manifest = JSON.parse(
            fs.readFileSync(path.join(root, "dist/manifest.json"), "utf8"),
        ) as Record<string, { file: string; src: string }>;
        const entry = manifest[`${source}.livewire-entry.tsx`];

        expect(entry.src).toBe(`${source}.livewire-entry.tsx`);
        expect(entry.file).toMatch(/^assets\/.+\.js$/);
        expect(fs.existsSync(path.join(root, "dist", entry.file))).toBe(true);
    });

    it("resolves and extracts the React component and generated entry modules", async () => {
        const root = fixtureRoot();
        const source = "resources/views/counter.blade.php";
        const absoluteSource = path.join(root, source);
        fs.writeFileSync(
            absoluteSource,
            `
            <div wire:ref="counter"></div>
            <script lang="tsx" bridge:react="counter">
                export default function Counter() { return <p>Current</p>; }
            </script>
        `,
        );
        const plugin = livewireBridge({ paths: ["resources/views"] });
        hook(plugin, "configResolved")({ root, command: "serve" });

        const encoded = encode(source);
        const entryId = hook(plugin, "resolveId")(`/@livewire-bridge/${encoded}`);
        const componentId = hook(plugin, "resolveId")(`/@livewire-bridge-component/${encoded}`);
        const context = { addWatchFile: vi.fn() };
        const entry = await hook(plugin, "load").call(context, entryId);
        const component = await hook(plugin, "load").call(context, componentId);

        expect(entry.code).toContain("createRoot");
        expect(entry.code).toContain('const ref = "counter"');
        expect(component.code).toContain("export default function Counter");
        expect(component.code).not.toContain("wire:ref");
        expect(context.addWatchFile).toHaveBeenCalledWith(absoluteSource);
    });

    it("resolves an explicitly named React MFC with its exported wire ref", async () => {
        const root = fixtureRoot();
        const source = multiFileFixture(
            root,
            "counter",
            "react.tsx",
            `
                import { useState } from "react";
                export const wireRef = "widget";
                export default function Counter() {
                    const [count] = useState(0);
                    return <p>{count}</p>;
                }
            `,
            '<div wire:ref="widget"></div>',
        );
        const absoluteSource = path.join(root, source);
        const plugin = livewireBridge();
        hook(plugin, "configResolved")({ root, command: "serve" });

        const entryId = hook(plugin, "resolveId")(`/@livewire-bridge/${encode(source)}`);
        const componentId = hook(
            plugin,
            "resolveId",
        )(`/@livewire-bridge-component/${encode(source)}`);
        const context = { addWatchFile: vi.fn() };
        const entry = await hook(plugin, "load").call(context, entryId);
        const component = await hook(plugin, "load").call(context, componentId);

        expect(entry.code).toContain('const ref = "widget"');
        expect(component.code).toContain("export default function Counter");
        expect(context.addWatchFile).toHaveBeenCalledWith(absoluteSource);
        expect(context.addWatchFile).toHaveBeenCalledWith(
            path.join(root, "resources/views/pages/⚡counter/counter.blade.php"),
        );
    });

    it("treats a bare TSX MFC companion as a general bridge script", async () => {
        const root = fixtureRoot();
        const source = multiFileFixture(
            root,
            "manual",
            "tsx",
            'const element = <span>Ready</span>; $js("element", () => element);',
        );
        const plugin = livewireBridge();
        hook(plugin, "configResolved")({ root, command: "serve" });
        const entryId = hook(plugin, "resolveId")(`/@livewire-bridge/${encode(source)}`);
        const entry = await hook(plugin, "load").call({ addWatchFile: vi.fn() }, entryId);

        expect(entry.code).toContain("export function run($wire, $js)");
        expect(entry.code).not.toContain("createRoot");
    });

    it("requires React MFCs to export their mount ref", async () => {
        const root = fixtureRoot();
        const source = multiFileFixture(
            root,
            "missing-ref",
            "react.jsx",
            "export default function Component() { return null; }",
        );
        const plugin = livewireBridge();
        hook(plugin, "configResolved")({ root, command: "serve" });
        const entryId = hook(plugin, "resolveId")(`/@livewire-bridge/${encode(source)}`);

        expect(() => hook(plugin, "load").call({ addWatchFile: vi.fn() }, entryId)).toThrow(
            "must export a non-empty string as wireRef",
        );
    });

    it("builds typed and imported MFC scripts while leaving plain JavaScript to Livewire", async () => {
        const root = fixtureRoot();
        const typedSource = multiFileFixture(
            root,
            "typed",
            "ts",
            "const count: number = $wire.count; $js('count', () => count);",
        );
        const importedSource = multiFileFixture(
            root,
            "imported",
            "js",
            'import "./helper.js";\n$js("ready", () => true);',
        );
        const plainSource = multiFileFixture(root, "plain", "js", '$js("ready", () => true);');
        fs.writeFileSync(
            path.join(root, "resources/views/pages/⚡imported/helper.js"),
            "export {};\n",
        );

        await build({
            root,
            logLevel: "silent",
            plugins: [livewireBridge()],
            build: {
                emptyOutDir: true,
                manifest: "manifest.json",
                minify: false,
                outDir: "dist",
                rollupOptions: { input: [] },
            },
        });

        const manifest = JSON.parse(
            fs.readFileSync(path.join(root, "dist/manifest.json"), "utf8"),
        ) as Record<string, unknown>;

        expect(manifest).toHaveProperty(`${typedSource}.livewire-entry.tsx`);
        expect(manifest).toHaveProperty(`${importedSource}.livewire-entry.tsx`);
        expect(manifest).not.toHaveProperty(`${plainSource}.livewire-entry.tsx`);
    });

    it("keeps static imports outside general script run functions", async () => {
        const root = fixtureRoot();
        const source = "resources/views/general.blade.php";
        fs.writeFileSync(
            path.join(root, source),
            `
            <script lang="ts" bridge>
                import { format } from "./format";
                $js("formatted", () => format($wire.count));
            </script>
        `,
        );
        const plugin = livewireBridge({ paths: ["resources/views"] });
        hook(plugin, "configResolved")({ root, command: "serve" });
        const id = hook(plugin, "resolveId")(`/@livewire-bridge/${encode(source)}`);
        const loaded = await hook(plugin, "load").call({ addWatchFile: vi.fn() }, id);

        expect(loaded.code).toMatch(/^import \{ format \} from "\.\/format";/);
        expect(loaded.code).toContain("export function run($wire, $js)");
        expect(loaded.code.match(/import \{ format \}/g)).toHaveLength(1);
    });

    it("rejects invalid React fixtures with focused diagnostics", async () => {
        const root = fixtureRoot();
        const source = "resources/views/invalid.blade.php";
        fs.writeFileSync(
            path.join(root, source),
            `
            <div wire:ref="other"></div>
            <script bridge:react="app">const Component = () => null;</script>
        `,
        );
        const plugin = livewireBridge({ paths: ["resources/views"] });
        hook(plugin, "configResolved")({ root, command: "serve" });
        const id = hook(plugin, "resolveId")(`/@livewire-bridge/${encode(source)}`);

        expect(() => hook(plugin, "load").call({ addWatchFile: vi.fn() }, id)).toThrow(
            'requires wire:ref="app"',
        );
    });

    it("returns only the component module for React-script-only hot updates", async () => {
        const root = fixtureRoot();
        const source = "resources/views/counter.blade.php";
        const absoluteSource = path.join(root, source);
        const before = `
            <div wire:ref="app">Stable markup</div>
            <script bridge:react="app">export default function Counter() { return <p>Before</p>; }</script>
        `;
        const after = before.replace("Before", "After");
        fs.writeFileSync(absoluteSource, before);
        const plugin = livewireBridge({ paths: ["resources/views"] });
        hook(plugin, "configResolved")({ root, command: "serve" });
        const entryId = hook(plugin, "resolveId")(`/@livewire-bridge/${encode(source)}`);
        await hook(plugin, "load").call({ addWatchFile: vi.fn() }, entryId);
        const module = { id: `${absoluteSource}.livewire-component.tsx` };
        const send = vi.fn();

        const result = await hook(
            plugin,
            "handleHotUpdate",
        )({
            file: absoluteSource,
            read: async () => after,
            server: {
                moduleGraph: { getModuleById: vi.fn(() => module) },
                ws: { send },
            },
        });

        expect(result).toEqual([module]);
        expect(send).not.toHaveBeenCalled();
    });

    it("forces a full reload when Blade markup changes", async () => {
        const root = fixtureRoot();
        const source = "resources/views/counter.blade.php";
        const absoluteSource = path.join(root, source);
        const before = `
            <div wire:ref="app">Before</div>
            <script bridge:react="app">export default function Counter() { return null; }</script>
        `;
        const after = before.replace(">Before</div>", ">After</div>");
        fs.writeFileSync(absoluteSource, before);
        const plugin = livewireBridge({ paths: ["resources/views"] });
        hook(plugin, "configResolved")({ root, command: "serve" });
        const entryId = hook(plugin, "resolveId")(`/@livewire-bridge/${encode(source)}`);
        await hook(plugin, "load").call({ addWatchFile: vi.fn() }, entryId);
        const send = vi.fn();

        const result = await hook(
            plugin,
            "handleHotUpdate",
        )({
            file: absoluteSource,
            read: async () => after,
            server: {
                moduleGraph: { getModuleById: vi.fn() },
                ws: { send },
            },
        });

        expect(result).toEqual([]);
        expect(send).toHaveBeenCalledWith({ type: "full-reload", path: "*" });
    });
});
