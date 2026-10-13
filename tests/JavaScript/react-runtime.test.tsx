import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { act, useLayoutEffect, StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { reactive, effect, stop, type ReactiveEffectRunner } from "@vue/reactivity";
import { WireProvider, useWire, type Wire } from "../../src/react-runtime";

type State = {
    count: number;
    ignored: number;
    mode: "count" | "ignored";
    profile: { name: string };
};

type StateWire = Wire & State;
function createReactiveWire(initial: State) {
    const state = reactive(structuredClone(initial));
    const effects = new Set<ReactiveEffectRunner>();
    const wire = new Proxy({} as StateWire, {
        get(_target, property) {
            if (property === "__instance") return () => ({ reactive: state });
            return Reflect.get(state, property);
        },
        set(_target, property, value) { return Reflect.set(state, property, value); },
    });
    const alpine = {
        effect(callback: () => void) {
            const runner = effect(callback);
            effects.add(runner);
            return runner;
        },
        release(runner: ReactiveEffectRunner) {
            stop(runner);
            effects.delete(runner);
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


describe("useWire regression cases", () => {
    it("observes mutations between rendering and subscribing", async () => {
        const harness = createReactiveWire(initialState);
        (globalThis as any).Alpine = harness.alpine;
        function Mutator() {
            useLayoutEffect(() => { harness.wire.count = 1; }, []);
            return null;
        }
        function Counter() {
            const wire = useWire<StateWire>();
            return <><output data-testid="value">{wire.count}</output><Mutator /></>;
        }
        const view = render(provider(harness.wire, <Counter />));
        await act(async () => { await Promise.resolve(); });
        expect(view.getByTestId("value").textContent).toBe("1");
    });

    it("catches a newly selected dependency changing during commit", async () => {
        const harness = createReactiveWire(initialState);
        (globalThis as any).Alpine = harness.alpine;
        function Mutator({ mode }: { mode: string }) {
            useLayoutEffect(() => { if (mode === "ignored") harness.wire.ignored = 7; }, [mode]);
            return null;
        }
        function Counter() {
            const wire = useWire<StateWire>();
            return <><output data-testid="value">{wire[wire.mode]}</output><Mutator mode={wire.mode} /></>;
        }
        const view = render(provider(harness.wire, <Counter />));
        await act(async () => { harness.wire.mode = "ignored"; });
        expect(view.getByTestId("value").textContent).toBe("7");
    });

    it("tracks own keys and membership through additions and deletions", async () => {
        const harness = createReactiveWire(initialState);
        (globalThis as any).Alpine = harness.alpine;
        let renders = 0;
        function Profile() {
            const wire = useWire<StateWire>();
            renders++;
            return <output data-testid="value">{Object.keys(wire.profile).join(",")}|{String("age" in wire.profile)}</output>;
        }
        const view = render(provider(harness.wire, <Profile />));
        await act(async () => { (harness.wire.profile as any).age = 30; });
        expect(view.getByTestId("value").textContent).toBe("name,age|true");
        const before = renders;
        await act(async () => { (harness.wire.profile as any).age = 31; });
        expect(renders).toBe(before);
        await act(async () => { delete (harness.wire.profile as any).age; });
        expect(view.getByTestId("value").textContent).toBe("name|false");
    });

    it("tracks array iteration, push, splice and replacement", async () => {
        const harness = createReactiveWire(initialState);
        (harness.state as any).items = [1, 2];
        (globalThis as any).Alpine = harness.alpine;
        function List() {
            const wire = useWire();
            return <output data-testid="value">{wire.items.map((n: number) => n * 2).join(",")}</output>;
        }
        const view = render(provider(harness.wire, <List />));
        await act(async () => { (harness.state as any).items.push(3); });
        expect(view.getByTestId("value").textContent).toBe("2,4,6");
        await act(async () => { (harness.state as any).items.splice(0, 1); });
        expect(view.getByTestId("value").textContent).toBe("4,6");
        await act(async () => { (harness.state as any).items = [4]; });
        expect(view.getByTestId("value").textContent).toBe("8");
    });

    it("cleans up StrictMode subscriptions and batches synchronous mutations", async () => {
        const harness = createReactiveWire(initialState);
        (globalThis as any).Alpine = harness.alpine;
        let renders = 0;
        function Counter() {
            const wire = useWire<StateWire>();
            renders++;
            return <output data-testid="value">{wire.count}</output>;
        }
        const view = render(<StrictMode>{provider(harness.wire, <Counter />)}</StrictMode>);
        expect(harness.activeEffects.size).toBe(1);
        const before = renders;
        await act(async () => { harness.wire.count++; harness.wire.count++; });
        expect(view.getByTestId("value").textContent).toBe("2");
        expect(renders - before).toBe(2); // StrictMode renders each update twice.
        view.unmount();
        expect(harness.activeEffects.size).toBe(0);
    });
});
