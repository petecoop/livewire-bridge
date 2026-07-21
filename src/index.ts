import fs from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { createGenericEntryModule } from "./entries/generic";
import { createReactEntryModule } from "./entries/react";

const entrySuffix = ".livewire-entry.tsx";
const componentSuffix = ".livewire-component.tsx";
const entryPrefix = "/@livewire-bridge/";
const reactComponentPrefix = "/@livewire-bridge-component/";
const reactModule = "@petecoop/livewire-bridge/react";

export const livewirePaths = [
    "resources/views/components",
    "resources/views/livewire",
    "resources/views/layouts",
    "resources/views/pages",
];

export function exceptLivewire(refreshPaths: readonly string[]): string[] {
    return refreshPaths.filter((refreshPath) => {
        const refreshRoot = refreshPath.replace(/\/\*\*$/, "");

        return !livewirePaths.some((livewirePath) => {
            return livewirePath === refreshRoot || livewirePath.startsWith(`${refreshRoot}/`);
        });
    });
}

export type LivewireBridgeOptions = {
    paths?: string[];
};

type ResolvedOptions = {
    paths: string[];
};

type BaseScriptDefinition = {
    code: string;
    end: number;
    openTag: string;
    closeTag: string;
    start: number;
};

type ViteScriptDefinition = BaseScriptDefinition & {
    type: "vite";
    ref: null;
};

type ReactScriptDefinition = BaseScriptDefinition & {
    type: "react";
    ref: string;
};

type ScriptDefinition = ViteScriptDefinition | ReactScriptDefinition;
type RollupInput = string | string[] | Record<string, string> | undefined;

export default function livewireBridge(pluginOptions: LivewireBridgeOptions = {}): Plugin {
    const options = resolveOptions(pluginOptions);
    let projectRoot = "";
    let command: ResolvedConfig["command"] = "serve";
    let paths: string[] = [];
    const sourceCache = new Map<string, string>();

    return {
        name: "livewire-bridge",
        enforce: "pre",

        config(config) {
            return {
                resolve: {
                    dedupe: [...new Set([
                        ...(config.resolve?.dedupe ?? []),
                        "react",
                        "react-dom",
                    ])],
                },
            };
        },

        configResolved(config) {
            projectRoot = config.root;
            command = config.command;
            paths = options.paths.map((configuredPath) => {
                return path.resolve(projectRoot, configuredPath);
            });
        },

        configureServer(server) {
            for (const configuredPath of paths) {
                server.watcher.add(configuredPath);
            }
        },

        options(rollupOptions) {
            if (command !== "build") {
                return null;
            }

            const entries = discoverScripts(paths).map((file) => {
                const relativePath = normalizePath(path.relative(projectRoot, file));

                return `${entryPrefix}${encodeSource(relativePath)}`;
            });

            return {
                ...rollupOptions,
                input: appendInputs(rollupOptions.input as RollupInput, entries),
                preserveEntrySignatures: "exports-only",
            };
        },

        resolveId(id) {
            if (id.endsWith(entrySuffix) || id.endsWith(componentSuffix)) {
                return id;
            }

            if (id.startsWith(entryPrefix)) {
                const relativePath = decodeSource(id.slice(entryPrefix.length));

                return `${path.resolve(projectRoot, relativePath)}${entrySuffix}`;
            }

            if (id.startsWith(reactComponentPrefix)) {
                const relativePath = decodeSource(id.slice(reactComponentPrefix.length));

                return `${path.resolve(projectRoot, relativePath)}${componentSuffix}`;
            }

            return null;
        },

        load(id) {
            const isEntry = id.endsWith(entrySuffix);
            const isComponent = id.endsWith(componentSuffix);

            if (!isEntry && !isComponent) {
                return null;
            }

            const suffix = isEntry ? entrySuffix : componentSuffix;
            const absolutePath = id.slice(0, -suffix.length);
            const relativePath = normalizePath(path.relative(projectRoot, absolutePath));

            if (!isInsideConfiguredPath(absolutePath, paths)) {
                throw new Error(
                    `Refusing to load a Livewire script outside the configured paths: ${relativePath}`,
                );
            }

            this.addWatchFile(absolutePath);

            const blade = fs.readFileSync(absolutePath, "utf8");
            const definition = extractScriptDefinition(blade, relativePath);

            sourceCache.set(absolutePath, blade);

            if (definition === null) {
                throw new Error(
                    `No <script data-vite> or <script data-react="…"> block found in ${relativePath}`,
                );
            }

            if (definition.type === "react") {
                assertReactTarget(blade, definition, relativePath);
                assertReactComponentExport(definition, relativePath);
            }

            if (isComponent) {
                if (definition.type !== "react") {
                    throw new Error(
                        `A React component module was requested for the data-vite script in ${relativePath}`,
                    );
                }

                return {
                    code: definition.code.trim(),
                    map: null,
                };
            }

            if (definition.type === "vite") {
                return {
                    code: createGenericEntryModule(definition.code),
                    map: null,
                };
            }

            return {
                code: createReactEntryModule({
                    reactComponentPrefix,
                    reactModule,
                    ref: definition.ref,
                    source: encodeSource(relativePath),
                }),
                map: null,
            };
        },

        async handleHotUpdate(context) {
            const absolutePath = path.resolve(context.file);

            if (!isInsideConfiguredPath(absolutePath, paths)) {
                return;
            }

            const previousSource = sourceCache.get(absolutePath);
            const nextSource = await context.read();
            const previousDefinition =
                previousSource === undefined ? null : extractScriptDefinition(previousSource);
            const nextDefinition = extractScriptDefinition(nextSource);
            const scriptOnlyChange =
                previousSource !== undefined &&
                previousDefinition !== null &&
                nextDefinition !== null &&
                previousDefinition.type === nextDefinition.type &&
                previousDefinition.ref === nextDefinition.ref &&
                withoutScriptContents(previousSource, previousDefinition) ===
                    withoutScriptContents(nextSource, nextDefinition);

            sourceCache.set(absolutePath, nextSource);

            if (!scriptOnlyChange || nextDefinition.type !== "react") {
                context.server.ws.send({ type: "full-reload", path: "*" });
                return [];
            }

            const module = context.server.moduleGraph.getModuleById(
                `${absolutePath}${componentSuffix}`,
            );

            return module ? [module] : [];
        },
    };
}

function resolveOptions(options: LivewireBridgeOptions): ResolvedOptions {
    if (
        options.paths !== undefined &&
        (!Array.isArray(options.paths) || options.paths.length === 0)
    ) {
        throw new Error("livewireBridge paths must be a non-empty array");
    }

    return {
        paths: options.paths ?? livewirePaths,
    };
}

function discoverScripts(paths: string[]): string[] {
    const files: string[] = [];

    for (const configuredPath of paths) {
        if (fs.existsSync(configuredPath)) {
            visitDirectory(configuredPath, files);
        }
    }

    return [...new Set(files)].filter((file) => {
        return (
            file.endsWith(".blade.php") &&
            /<script\b[^>]*(?:\bdata-vite\b|\bdata-react\b)/.test(fs.readFileSync(file, "utf8"))
        );
    });
}

function visitDirectory(directory: string, files: string[]): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            visitDirectory(target, files);
        } else if (entry.isFile()) {
            files.push(target);
        }
    }
}

function isInsideConfiguredPath(file: string, paths: string[]): boolean {
    return paths.some((configuredPath) => {
        return file === configuredPath || file.startsWith(`${configuredPath}${path.sep}`);
    });
}

function appendInputs(input: RollupInput, entries: string[]): RollupInput {
    if (Array.isArray(input)) {
        return [...input, ...entries];
    }

    if (typeof input === "string") {
        return [input, ...entries];
    }

    const namedEntries = Object.fromEntries(
        entries.map((entry) => [entry.slice(entryPrefix.length), entry]),
    );

    return {
        ...(input ?? {}),
        ...namedEntries,
    };
}

function encodeSource(source: string): string {
    return Buffer.from(source, "utf8").toString("base64url");
}

function decodeSource(source: string): string {
    return Buffer.from(source, "base64url").toString("utf8");
}

function normalizePath(source: string): string {
    return source.split(path.sep).join("/");
}

function extractScriptDefinition(
    blade: string,
    relativePath = "the Blade view",
): ScriptDefinition | null {
    const expression = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
    let match: RegExpExecArray | null;

    while ((match = expression.exec(blade)) !== null) {
        const attributes = match[1];
        const hasVite = /(?:^|\s)data-vite(?:\s|=|$)/.test(attributes);
        const hasReact = /(?:^|\s)data-react(?:\s|=|$)/.test(attributes);

        if (!hasVite && !hasReact) {
            continue;
        }

        if (hasVite && hasReact) {
            throw new Error(`A script cannot use both data-vite and data-react in ${relativePath}`);
        }

        const openTagLength = match[0].indexOf(">");
        const closeTagStart = match[0].lastIndexOf("</script>");
        const definition: BaseScriptDefinition = {
            code: match[2],
            end: match.index + match[0].length,
            openTag: match[0].slice(0, openTagLength + 1),
            closeTag: match[0].slice(closeTagStart),
            start: match.index,
        };

        if (hasVite) {
            return { ...definition, type: "vite", ref: null };
        }

        const refMatch = attributes.match(/(?:^|\s)data-react\s*=\s*(["'])(.*?)\1/);
        const ref = refMatch?.[2]?.trim();

        if (!ref) {
            throw new Error(
                `<script data-react> requires a non-empty quoted ref name in ${relativePath}`,
            );
        }

        return { ...definition, type: "react", ref };
    }

    return null;
}

function withoutScriptContents(blade: string, definition: ScriptDefinition): string {
    return `${blade.slice(0, definition.start)}${definition.openTag}${definition.closeTag}${blade.slice(definition.end)}`;
}

function assertReactTarget(
    blade: string,
    definition: ReactScriptDefinition,
    relativePath: string,
): void {
    const markup = withoutScriptContents(blade, definition);
    const ref = escapeRegExp(definition.ref);
    const target = new RegExp(`\\bwire:ref\\s*=\\s*(["'])${ref}\\1`);

    if (!target.test(markup)) {
        throw new Error(
            `<script data-react="${definition.ref}"> requires wire:ref="${definition.ref}" in ${relativePath}`,
        );
    }
}

function assertReactComponentExport(definition: ReactScriptDefinition, relativePath: string): void {
    const hasDefaultExport =
        /\bexport\s+default\b/.test(definition.code) ||
        /\bexport\s*{[^}]*\bas\s+default\b[^}]*}/s.test(definition.code);

    if (!hasDefaultExport) {
        throw new Error(
            `<script data-react="${definition.ref}"> must export a default React component in ${relativePath}`,
        );
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
