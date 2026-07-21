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
    let renderPaths = new Map<string, ReactivePath>();
    let committedPaths = new Map<string, ReactivePath>();
    let collecting = false;
    let effectRunner: AlpineEffectRunner | null = null;
    let effectGeneration = 0;
    const queuedGenerations = new Set<number>();
    let version = 0;

    const notify = (): void => {
        version += 1;

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
        const paths = [...committedPaths.values()];
        let initialized = false;

        effectRunner = store.alpine.effect(() => {
            for (const path of paths) {
                readReactivePath(store.reactive, path);
            }

            if (!initialized) {
                initialized = true;
                return;
            }

            scheduleNotify(generation);
        });
    };

    const recordPath = (path: ReactivePath): void => {
        if (!collecting || !isReactivePath(store.reactive, path)) {
            return;
        }

        renderPaths.set(JSON.stringify(path), path);
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
            deleteProperty(proxyTarget, property) {
                return Reflect.deleteProperty(proxyTarget, property);
            },
            get(proxyTarget, property, receiver) {
                const value = Reflect.get(proxyTarget, property, receiver);

                if (typeof property !== "string" || shouldIgnoreProperty(property)) {
                    return value;
                }

                const nextPath = [...path, property];

                if (typeof value !== "function") {
                    recordPath(nextPath);
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

            if (samePaths(renderPaths, committedPaths)) {
                return;
            }

            committedPaths = renderPaths;
            startEffect();
        },
        getSnapshot() {
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
    left: Map<string, ReactivePath>,
    right: Map<string, ReactivePath>,
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
