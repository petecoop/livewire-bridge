import {
    createContext,
    createElement,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useSyncExternalStore,
    type ReactElement,
    type ReactNode,
} from "react";

export type Wire = Record<string, any> & {
    __instance?: LivewireComponent | (() => LivewireComponent);
    $watch?: (property: string, callback: () => void) => () => void;
};

export type WireSelector<TSelected, TWire extends Wire = Wire> = (
    $wire: TWire,
) => TSelected;

type LivewireComponent = {
    reactive: Record<string, unknown>;
};

type WireStore = {
    $wire: Wire;
    destroy: () => void;
    getVersion: () => number;
    subscribe: (listener: () => void, selector?: WireSelector<unknown>) => () => void;
};

const WireContext = createContext<WireStore | null>(null);

function createWireStore($wire: Wire): WireStore {
    const listeners = new Set<() => void>();
    const watchCleanups = new Set<() => void>();
    const instance = $wire.__instance;
    const component = typeof instance === "function" ? instance() : instance;
    let version = 0;
    let notificationQueued = false;

    const notify = (): void => {
        version += 1;

        for (const listener of listeners) {
            listener();
        }
    };

    const scheduleNotify = (): void => {
        if (notificationQueued) {
            return;
        }

        notificationQueued = true;

        queueMicrotask(() => {
            notificationQueued = false;
            notify();
        });
    };

    const trackReactiveSelection = (
        selector?: WireSelector<unknown>,
    ): (() => void) => {
        if (!component?.reactive || typeof $wire.$watch !== "function") {
            return () => {};
        }

        const properties = new Set<string>();

        if (selector) {
            const trackingWire = new Proxy($wire, {
                get(target, property, receiver) {
                    if (
                        typeof property === "string"
                        && !property.startsWith("$")
                        && property !== "__instance"
                    ) {
                        properties.add(property);
                    }

                    return Reflect.get(target, property, receiver);
                },
            });

            selector(trackingWire);
        } else {
            for (const property of Object.keys(component.reactive)) {
                properties.add(property);
            }
        }

        const stopWatching = [...properties].map((property) => {
            return $wire.$watch!(property, scheduleNotify);
        });

        return () => {
            for (const stopWatch of stopWatching) {
                stopWatch();
            }
        };
    };

    return {
        $wire,
        destroy() {
            for (const stopWatching of watchCleanups) {
                stopWatching();
            }

            watchCleanups.clear();
            listeners.clear();
        },
        getVersion() {
            return version;
        },
        subscribe(listener, selector) {
            listeners.add(listener);
            const stopTracking = trackReactiveSelection(selector);
            watchCleanups.add(stopTracking);

            return () => {
                if (!watchCleanups.delete(stopTracking)) {
                    return;
                }

                stopTracking();
                listeners.delete(listener);
            };
        },
    };
}

export type WireProviderProps = {
    $wire: Wire;
    children: ReactNode;
};

export function WireProvider({ $wire, children }: WireProviderProps): ReactElement {
    const storeRef = useRef<WireStore | null>(null);

    if (storeRef.current === null || storeRef.current.$wire !== $wire) {
        storeRef.current?.destroy();
        storeRef.current = createWireStore($wire);
    }

    const store = storeRef.current;

    useEffect(() => () => store.destroy(), [store]);

    return createElement(WireContext.Provider, { value: store }, children);
}

export function useWire<TWire extends Wire = Wire>(): TWire;
export function useWire<TSelected, TWire extends Wire = Wire>(
    selector: WireSelector<TSelected, TWire>,
): TSelected;
export function useWire<TSelected, TWire extends Wire = Wire>(
    selector?: WireSelector<TSelected, TWire>,
): TWire | TSelected {
    const store = useContext(WireContext);

    if (store === null) {
        throw new Error("useWire must be used inside a Livewire React component");
    }

    const subscribe = useCallback(
        (listener: () => void) => store.subscribe(
            listener,
            selector as WireSelector<unknown> | undefined,
        ),
        [store, selector],
    );
    const getSnapshot = useCallback(
        () => selector
            ? selector(store.$wire as TWire)
            : store.getVersion(),
        [store, selector],
    );
    const selected = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    return selector ? selected as TSelected : store.$wire as TWire;
}

export function useWireProxy<TWire extends Wire = Wire>(): TWire {
    const store = useContext(WireContext);

    if (store === null) {
        throw new Error("useWireProxy must be used inside a Livewire React component");
    }

    return store.$wire as TWire;
}
