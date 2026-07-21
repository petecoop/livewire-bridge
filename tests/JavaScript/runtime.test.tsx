import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { WireProvider, useWire, type Wire } from "../../src/runtime";

type State = {
    count: number;
    ignored: number;
    mode: "count" | "ignored";
    profile: { name: string };
};

type StateWire = Wire & State;
type Effect = (() => void) & { dependencies: Set<Set<Effect>> };

function createReactiveWire(initial: State) {
    const dependencies = new WeakMap<object, Map<PropertyKey, Set<Effect>>>();
    const proxies = new WeakMap<object, object>();
    const effects = new Set<Effect>();
    let activeEffect: Effect | null = null;

    const cleanupEffect = (effect: Effect): void => {
        for (const dependency of effect.dependencies) {
            dependency.delete(effect);
        }

        effect.dependencies.clear();
    };

    const track = (target: object, property: PropertyKey): void => {
        if (activeEffect === null) {
            return;
        }

        let targetDependencies = dependencies.get(target);

        if (targetDependencies === undefined) {
            targetDependencies = new Map();
            dependencies.set(target, targetDependencies);
        }

        let propertyEffects = targetDependencies.get(property);

        if (propertyEffects === undefined) {
            propertyEffects = new Set();
            targetDependencies.set(property, propertyEffects);
        }

        propertyEffects.add(activeEffect);
        activeEffect.dependencies.add(propertyEffects);
    };

    const trigger = (target: object, property: PropertyKey): void => {
        const propertyEffects = dependencies.get(target)?.get(property);

        if (propertyEffects === undefined) {
            return;
        }

        for (const effect of [...propertyEffects]) {
            effect();
        }
    };

    const reactive = <T extends object>(target: T): T => {
        const existing = proxies.get(target);

        if (existing !== undefined) {
            return existing as T;
        }

        const proxy = new Proxy(target, {
            get(proxyTarget, property, receiver) {
                track(proxyTarget, property);
                const value = Reflect.get(proxyTarget, property, receiver);

                return value !== null && typeof value === "object"
                    ? reactive(value)
                    : value;
            },
            set(proxyTarget, property, value, receiver) {
                const previous = Reflect.get(proxyTarget, property, receiver);
                const result = Reflect.set(proxyTarget, property, value, receiver);

                if (!Object.is(previous, value)) {
                    trigger(proxyTarget, property);
                }

                return result;
            },
        });

        proxies.set(target, proxy);

        return proxy;
    };

    const state = reactive(structuredClone(initial));
    const wire = new Proxy({} as StateWire, {
        get(_target, property) {
            if (property === "__instance") {
                return () => ({ reactive: state });
            }

            return Reflect.get(state, property);
        },
        set(_target, property, value) {
            return Reflect.set(state, property, value);
        },
    });

    const alpine = {
        effect(callback: () => void): Effect {
            const effect = (() => {
                cleanupEffect(effect);
                activeEffect = effect;

                try {
                    callback();
                } finally {
                    activeEffect = null;
                }
            }) as Effect;

            effect.dependencies = new Set();
            effects.add(effect);
            effect();

            return effect;
        },
        release(effect: Effect): void {
            cleanupEffect(effect);
            effects.delete(effect);
        },
    };

    return { activeEffects: effects, alpine, state, wire };
}

function provider(wire: StateWire, children: ReactNode): ReactNode {
    return <WireProvider $wire={wire}>{children}</WireProvider>;
}

const initialState: State = {
    count: 0,
    ignored: 0,
    mode: "count",
    profile: { name: "Taylor" },
};

afterEach(() => {
    cleanup();
    delete (globalThis as typeof globalThis & { Alpine?: unknown }).Alpine;
});

describe("useWire", () => {
    it("reacts to tracked Alpine mutations and passes writes through the proxy", async () => {
        const harness = createReactiveWire(initialState);
        (globalThis as typeof globalThis & { Alpine: typeof harness.alpine }).Alpine = harness.alpine;
        let renders = 0;

        function Counter() {
            const $wire = useWire<StateWire>();
            renders++;

            return (
                <button data-testid="count" onClick={() => $wire.count++}>
                    {$wire.count}
                </button>
            );
        }

        const view = render(provider(harness.wire, <Counter />));

        fireEvent.click(view.getByTestId("count"));

        await waitFor(() => expect(view.getByTestId("count").textContent).toBe("1"));
        expect(harness.state.count).toBe(1);
        expect(renders).toBe(2);
    });

    it("does not re-render for unread properties", async () => {
        const harness = createReactiveWire(initialState);
        (globalThis as typeof globalThis & { Alpine: typeof harness.alpine }).Alpine = harness.alpine;
        let renders = 0;

        function Counter() {
            const $wire = useWire<StateWire>();
            renders++;

            return <output data-testid="count">{$wire.count}</output>;
        }

        const view = render(provider(harness.wire, <Counter />));

        await act(async () => {
            harness.wire.ignored++;
            await Promise.resolve();
        });

        expect(view.getByTestId("count").textContent).toBe("0");
        expect(renders).toBe(1);
    });

    it("tracks nested values and an entire nested replacement", async () => {
        const harness = createReactiveWire(initialState);
        (globalThis as typeof globalThis & { Alpine: typeof harness.alpine }).Alpine = harness.alpine;

        function Profile() {
            const $wire = useWire<StateWire>();

            return <output data-testid="name">{$wire.profile.name}</output>;
        }

        const view = render(provider(harness.wire, <Profile />));

        await act(async () => {
            harness.wire.profile.name = "Sam";
            await Promise.resolve();
        });
        await waitFor(() => expect(view.getByTestId("name").textContent).toBe("Sam"));

        await act(async () => {
            harness.wire.profile = { name: "Alex" };
            await Promise.resolve();
        });
        await waitFor(() => expect(view.getByTestId("name").textContent).toBe("Alex"));
    });

    it("replaces conditional dependencies after each committed render", async () => {
        const harness = createReactiveWire(initialState);
        (globalThis as typeof globalThis & { Alpine: typeof harness.alpine }).Alpine = harness.alpine;
        let renders = 0;

        function ConditionalValue() {
            const $wire = useWire<StateWire>();
            renders++;
            const value = $wire.mode === "count" ? $wire.count : $wire.ignored;

            return <output data-testid="value">{value}</output>;
        }

        const view = render(provider(harness.wire, <ConditionalValue />));

        await act(async () => {
            harness.wire.mode = "ignored";
            await Promise.resolve();
        });
        await waitFor(() => expect(renders).toBe(2));

        await act(async () => {
            harness.wire.count++;
            await Promise.resolve();
        });
        expect(renders).toBe(2);

        await act(async () => {
            harness.wire.ignored++;
            await Promise.resolve();
        });
        await waitFor(() => expect(view.getByTestId("value").textContent).toBe("1"));
        expect(renders).toBe(3);
    });

    it("does not subscribe to values read only in event handlers", async () => {
        const harness = createReactiveWire(initialState);
        (globalThis as typeof globalThis & { Alpine: typeof harness.alpine }).Alpine = harness.alpine;
        let renders = 0;

        function EventOnly() {
            const $wire = useWire<StateWire>();
            renders++;

            return <button data-testid="increment" onClick={() => $wire.count++}>Increment</button>;
        }

        const view = render(provider(harness.wire, <EventOnly />));
        fireEvent.click(view.getByTestId("increment"));
        await act(async () => Promise.resolve());

        expect(harness.state.count).toBe(1);
        expect(renders).toBe(1);
        expect(harness.activeEffects.size).toBe(0);
    });

    it("releases its Alpine effect when the component unmounts", () => {
        const harness = createReactiveWire(initialState);
        (globalThis as typeof globalThis & { Alpine: typeof harness.alpine }).Alpine = harness.alpine;

        function Counter() {
            const $wire = useWire<StateWire>();

            return <output>{$wire.count}</output>;
        }

        const view = render(provider(harness.wire, <Counter />));
        expect(harness.activeEffects.size).toBe(1);

        view.unmount();

        expect(harness.activeEffects.size).toBe(0);
    });
});
