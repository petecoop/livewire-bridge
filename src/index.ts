import fs from "node:fs";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { transformGenericEntry } from "./entries/generic";
import { createReactEntryModule } from "./entries/react";

const entrySuffix = ".livewire-entry.tsx";
const componentSuffix = ".livewire-component.tsx";
const entryPrefix = "/@livewire-bridge/";
const reactComponentPrefix = "/@livewire-bridge-component/";

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
    external: boolean;
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

            const source = fs.readFileSync(absolutePath, "utf8");
            const definition = extractFileDefinition(absolutePath, source, relativePath);

            sourceCache.set(absolutePath, source);

            if (definition === null) {
                throw new Error(`No bridge script found in ${relativePath}`);
            }

            if (definition.type === "react") {
                const markup = definition.external
                    ? fs.readFileSync(multiFileViewPath(absolutePath)!, "utf8")
                    : source;

                if (definition.external) {
                    this.addWatchFile(multiFileViewPath(absolutePath)!);
                }

                assertReactTarget(markup, definition, relativePath);
                assertReactComponentExport(definition, relativePath);
            }

            if (isComponent) {
                if (definition.type !== "react") {
                    throw new Error(
                        `A React component module was requested for the bridge script in ${relativePath}`,
                    );
                }

                return {
                    code: definition.code.trim(),
                    map: null,
                };
            }

            if (definition.type === "vite") {
                return transformGenericEntry(definition.code, id);
            }

            return {
                code: createReactEntryModule({
                    reactComponentPrefix,
                    reactModule: "@petecoop/livewire-bridge/mount",
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
                previousSource === undefined
                    ? null
                    : extractFileDefinition(absolutePath, previousSource);
            const nextDefinition = extractFileDefinition(absolutePath, nextSource);
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
        return extractFileDefinition(file, fs.readFileSync(file, "utf8")) !== null;
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
        const hasVite = /(?:^|\s)bridge(?:\s|=|$)/.test(attributes);
        const hasReact = /(?:^|\s)bridge:react(?:\s|=|$)/.test(attributes);

        if (!hasVite && !hasReact) {
            continue;
        }

        if (hasVite && hasReact) {
            throw new Error(`A script cannot use both bridge and bridge:react in ${relativePath}`);
        }

        const openTagLength = match[0].indexOf(">");
        const closeTagStart = match[0].lastIndexOf("</script>");
        const definition: BaseScriptDefinition = {
            code: match[2],
            end: match.index + match[0].length,
            external: false,
            openTag: match[0].slice(0, openTagLength + 1),
            closeTag: match[0].slice(closeTagStart),
            start: match.index,
        };

        if (hasVite) {
            return { ...definition, type: "vite", ref: null };
        }

        const refMatch = attributes.match(/(?:^|\s)bridge:react\s*=\s*(["'])(.*?)\1/);
        const ref = refMatch?.[2]?.trim();

        if (!ref) {
            throw new Error(
                `<script bridge:react> requires a non-empty quoted ref name in ${relativePath}`,
            );
        }

        return { ...definition, type: "react", ref };
    }

    return null;
}

function extractFileDefinition(
    file: string,
    source: string,
    relativePath = "the Livewire source",
): ScriptDefinition | null {
    if (file.endsWith(".blade.php")) {
        return extractScriptDefinition(source, relativePath);
    }

    const multiFileScript = resolveMultiFileScript(file);

    if (multiFileScript === null) {
        return null;
    }

    const extension = path.extname(file);

    if (extension === ".js" && !hasModuleImport(source)) {
        return null;
    }

    const definition: BaseScriptDefinition = {
        code: source,
        end: source.length,
        external: true,
        openTag: "",
        closeTag: "",
        start: 0,
    };

    if (multiFileScript.react) {
        return {
            ...definition,
            type: "react",
            ref: extractReactWireRef(source, relativePath),
        };
    }

    return { ...definition, type: "vite", ref: null };
}

type MultiFileScript = {
    react: boolean;
    viewPath: string;
};

function resolveMultiFileScript(file: string): MultiFileScript | null {
    const extension = path.extname(file);

    if (![".js", ".jsx", ".ts", ".tsx"].includes(extension)) {
        return null;
    }

    const directory = path.dirname(file);
    const componentName = path.basename(directory).replace(/^⚡[\uFE0E\uFE0F]?/u, "");
    const sourceName = path.basename(file, extension);
    const react =
        (extension === ".jsx" || extension === ".tsx") &&
        sourceName === `${componentName}.react`;

    if (sourceName !== componentName && !react) {
        return null;
    }

    const classPath = path.join(directory, `${componentName}.php`);
    const viewPath = path.join(directory, `${componentName}.blade.php`);

    return fs.existsSync(classPath) && fs.existsSync(viewPath) ? { react, viewPath } : null;
}

function multiFileViewPath(file: string): string | null {
    return resolveMultiFileScript(file)?.viewPath ?? null;
}

function extractReactWireRef(source: string, relativePath: string): string {
    const match = source.match(
        /\bexport\s+const\s+wireRef\s*(?::[^=]+)?=\s*(["'`])([^"'`]+)\1/,
    );
    const ref = match?.[2]?.trim();

    if (!ref) {
        throw new Error(
            `React MFC ${relativePath} must export a non-empty string as wireRef`,
        );
    }

    return ref;
}

function hasModuleImport(source: string): boolean {
    return /(?:^|\n)\s*import(?:\s|\()/.test(source);
}

function withoutScriptContents(blade: string, definition: ScriptDefinition): string {
    if (definition.external) {
        return "";
    }

    return `${blade.slice(0, definition.start)}${definition.openTag}${definition.closeTag}${blade.slice(definition.end)}`;
}

function assertReactTarget(
    blade: string,
    definition: ReactScriptDefinition,
    relativePath: string,
): void {
    const markup = definition.external ? blade : withoutScriptContents(blade, definition);
    const ref = escapeRegExp(definition.ref);
    const target = new RegExp(`\\bwire:ref\\s*=\\s*(["'])${ref}\\1`);

    if (!target.test(markup)) {
        const source = definition.external
            ? `React MFC ${relativePath}`
            : `<script bridge:react="${definition.ref}">`;

        throw new Error(
            `${source} requires wire:ref="${definition.ref}" in ${relativePath}`,
        );
    }
}

function assertReactComponentExport(definition: ReactScriptDefinition, relativePath: string): void {
    const hasDefaultExport =
        /\bexport\s+default\b/.test(definition.code) ||
        /\bexport\s*{[^}]*\bas\s+default\b[^}]*}/s.test(definition.code);

    if (!hasDefaultExport) {
        const source = definition.external
            ? `React MFC ${relativePath}`
            : `<script bridge:react="${definition.ref}">`;

        throw new Error(`${source} must export a default React component`);
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
