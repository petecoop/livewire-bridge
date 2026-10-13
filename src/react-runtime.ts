import {
    createContext,
    createElement,
    useContext,
    useLayoutEffect,
    useMemo,
    useRef,
    useSyncExternalStore,
    type ReactElement,
    type ReactNode,
} from "react";

export type Wire = Record<string, any> & {
    __instance?: LivewireComponent | (() => LivewireComponent);
};

type LivewireComponent = {
    reactive: Record<string, unknown>;
    el?: Element;
    addCleanup?: (callback: () => void) => (() => void);
};

type AlpineEffectRunner = object | (() => void);

type AlpineRuntime = {
    effect: (callback: () => void) => AlpineEffectRunner;
    release: (runner: AlpineEffectRunner) => void;
};

type WireStore = {
    $wire: Wire;
    alpine: AlpineRuntime;
    reactive: Record<string, unknown>;
};

type WireSubscription = {
    $wire: Wire;
    beginRender: () => void;
    commitRender: () => void;
    getSnapshot: () => number;
    subscribe: (listener: () => void) => () => void;
};

type ReactivePath = readonly string[];
type Dependency = {
    path: ReactivePath;
    kind: "get" | "keys" | "has";
    property?: PropertyKey;
    value: unknown;
};

function readDependency(state: Record<string, unknown>, dependency: Dependency): unknown {
    const value = readReactivePath(state, dependency.path);
    if (dependency.kind === "get") return value;
    if (value === null || typeof value !== "object") return undefined;
    return dependency.kind === "keys"
        ? Reflect.ownKeys(value)
        : Reflect.has(value, dependency.property!);
}

function equalValue(dependency: Dependency, value: unknown): boolean {
    if (dependency.kind !== "keys" || !Array.isArray(value) || !Array.isArray(dependency.value)) {
        return Object.is(dependency.value, value);
    }
    return value.length === dependency.value.length
        && value.every((key, index) => key === (dependency.value as PropertyKey[])[index]);
}

const WireContext = createContext<WireStore | null>(null);

function createWireStore($wire: Wire): WireStore {
    const instance = $wire.__instance;
    const component = typeof instance === "function" ? instance() : instance;
    const alpine = (globalThis as typeof globalThis & {
        Alpine?: Partial<AlpineRuntime>;
    }).Alpine;

    if (!component?.reactive) {
        throw new Error("The Livewire component reactive state is unavailable");
    }

    if (typeof alpine?.effect !== "function" || typeof alpine.release !== "function") {
        throw new Error("Livewire's Alpine effect runtime is unavailable");
    }

    return {
        $wire,
        alpine: alpine as AlpineRuntime,
        reactive: component.reactive,
    };
}

function createTrackedSubscription<TWire extends Wire>(
    store: WireStore,
): WireSubscription {
    const listeners = new Set<() => void>();
    const proxyCache = new WeakMap<object, Map<string, object>>();
    let renderPaths = new Map<string, Dependency>();
    let committedPaths = new Map<string, Dependency>();
    let collecting = false;
    let effectRunner: AlpineEffectRunner | null = null;
    let effectGeneration = 0;
    const queuedGenerations = new Set<number>();
    let version = 0;

    // Read synchronously as well as through Alpine's scheduled effect. React must
    // be able to detect a store change between rendering and subscribing.
    const refreshSnapshot = (): boolean => {
        let changed = false;
        for (const dependency of committedPaths.values()) {
            const value = readDependency(store.reactive, dependency);
            if (!equalValue(dependency, value)) {
                dependency.value = value;
                changed = true;
            }
        }
        if (changed) version += 1;
        return changed;
    };

    const notify = (): void => {
        for (const listener of listeners) {
            listener();
        }
    };

    const scheduleNotify = (generation: number): void => {
        if (queuedGenerations.has(generation)) {
            return;
        }

        queuedGenerations.add(generation);

        queueMicrotask(() => {
            queuedGenerations.delete(generation);

            if (generation === effectGeneration) {
                notify();
            }
        });
    };

    const releaseEffect = (): void => {
        effectGeneration += 1;

        if (effectRunner !== null) {
            store.alpine.release(effectRunner);
            effectRunner = null;
        }
    };

    const startEffect = (): void => {
        releaseEffect();

        if (listeners.size === 0 || committedPaths.size === 0) {
            return;
        }

        const generation = effectGeneration;
        effectRunner = store.alpine.effect(() => {
            if (refreshSnapshot()) scheduleNotify(generation);
        });
    };

    const recordPath = (
        path: ReactivePath,
        value: unknown,
        kind: Dependency["kind"] = "get",
        property?: PropertyKey,
    ): void => {
        if (!collecting || !isReactivePath(store.reactive, path)) return;
        const key = JSON.stringify([kind, path, typeof property, String(property)]);
        renderPaths.set(key, { path, kind, property, value });
    };

    const wrap = (target: object, path: ReactivePath): object => {
        const pathKey = JSON.stringify(path);
        let targetProxies = proxyCache.get(target);

        if (targetProxies === undefined) {
            targetProxies = new Map();
            proxyCache.set(target, targetProxies);
        }

        const existing = targetProxies.get(pathKey);

        if (existing !== undefined) {
            return existing;
        }

        const proxy = new Proxy(target, {
            ownKeys(proxyTarget) {
                const keys = Reflect.ownKeys(proxyTarget);
                recordPath(path, keys, "keys");
                return keys;
            },
            has(proxyTarget, property) {
                const value = Reflect.has(proxyTarget, property);
                recordPath(path, value, "has", property);
                return value;
            },
            deleteProperty(proxyTarget, property) {
                return Reflect.deleteProperty(proxyTarget, property);
            },
            get(proxyTarget, property, receiver) {
                // Vue's instrumented array methods can read the raw array and
                // bypass this tracking proxy. Native methods use this proxy as
                // their receiver, tracking length, indices and nested values.
                if (Array.isArray(proxyTarget) && !Object.hasOwn(proxyTarget, property)) {
                    const method = Reflect.get(Array.prototype, property);
                    if (typeof method === "function") return method;
                }
                const value = Reflect.get(proxyTarget, property, receiver);

                if (typeof property !== "string" || shouldIgnoreProperty(property)) {
                    return value;
                }

                const nextPath = [...path, property];

                if (typeof value !== "function") {
                    recordPath(nextPath, value);
                }

                return isTrackableObject(value) ? wrap(value, nextPath) : value;
            },
            set(proxyTarget, property, value) {
                return Reflect.set(proxyTarget, property, value);
            },
        });

        targetProxies.set(pathKey, proxy);

        return proxy;
    };

    const $wire = wrap(store.$wire, []) as TWire;

    return {
        $wire,
        beginRender() {
            renderPaths = new Map();
            collecting = true;
        },
        commitRender() {
            collecting = false;

            const pathsChanged = !samePaths(renderPaths, committedPaths);
            committedPaths = renderPaths;
            // Preserve the values actually rendered until this comparison, even
            // when the dependency paths did not change.
            const changed = refreshSnapshot();
            if (pathsChanged) startEffect();
            if (changed) scheduleNotify(effectGeneration);
        },
        getSnapshot() {
            refreshSnapshot();
            return version;
        },
        subscribe(listener) {
            listeners.add(listener);

            if (listeners.size === 1) {
                startEffect();
            }

            return () => {
                listeners.delete(listener);

                if (listeners.size === 0) {
                    releaseEffect();
                }
            };
        },
    };
}

function readReactivePath(
    reactive: Record<string, unknown>,
    path: ReactivePath,
): unknown {
    let value: unknown = reactive;

    for (const property of path) {
        if (value === null || typeof value !== "object") {
            return undefined;
        }

        value = Reflect.get(value, property);
    }

    return value;
}

function isReactivePath(
    reactive: Record<string, unknown>,
    path: ReactivePath,
): boolean {
    const rootProperty = path[0];

    return rootProperty !== undefined
        && !shouldIgnoreProperty(rootProperty)
        && Object.prototype.hasOwnProperty.call(reactive, rootProperty);
}

function shouldIgnoreProperty(property: string): boolean {
    return property === "__instance" || property === "then" || property.startsWith("$");
}

function isTrackableObject(value: unknown): value is object {
    if (value === null || typeof value !== "object") {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return Array.isArray(value)
        || prototype === Object.prototype
        || prototype === null;
}

function samePaths(
    left: Map<string, Dependency>,
    right: Map<string, Dependency>,
): boolean {
    if (left.size !== right.size) {
        return false;
    }

    for (const path of left.keys()) {
        if (!right.has(path)) {
            return false;
        }
    }

    return true;
}

export type WireProviderProps = {
    $wire: Wire;
    children: ReactNode;
};

export function WireProvider({ $wire, children }: WireProviderProps): ReactElement {
    const storeRef = useRef<WireStore | null>(null);

    if (storeRef.current === null || storeRef.current.$wire !== $wire) {
        storeRef.current = createWireStore($wire);
    }

    return createElement(WireContext.Provider, {
        value: storeRef.current,
    }, children);
}

export function useWire<TWire extends Wire = Wire>(): TWire {
    const store = useContext(WireContext);

    if (store === null) {
        throw new Error("useWire must be used inside a Livewire React component");
    }

    const subscription = useMemo(() => {
        return createTrackedSubscription<TWire>(store);
    }, [store]);

    subscription.beginRender();

    useSyncExternalStore(
        subscription.subscribe,
        subscription.getSnapshot,
        subscription.getSnapshot,
    );

    useLayoutEffect(() => {
        subscription.commitRender();
    });

    return subscription.$wire as TWire;
}
