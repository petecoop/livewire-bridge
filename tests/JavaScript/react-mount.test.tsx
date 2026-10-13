import { act, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { effect, reactive, stop, type ReactiveEffectRunner } from "@vue/reactivity";
import { mountReact } from "../../src/react-mount";
import { useWire } from "../../src/react-runtime";

const disposers: (() => void)[] = [];
afterEach(() => {
    act(() => disposers.splice(0).forEach(dispose => dispose()));
    document.body.innerHTML = "";
    delete (globalThis as any).Alpine;
});

function fixture() {
    const el = document.createElement("main");
    const container = document.createElement("div");
    el.append(container);
    document.body.append(el);
    const callbacks = new Set<() => void>();
    const removals = new Map<Element, () => void>();
    const activeEffects = new Set<ReactiveEffectRunner>();
    const state = reactive({ count: 0 });
    const instance = {
        el,
        reactive: state,
        addCleanup(callback: () => void) {
            callbacks.add(callback);
            return () => { callbacks.delete(callback); };
        },
    };
    const wire = new Proxy({ $refs: { app: container }, __instance: () => instance }, {
        get(target, key) { return Reflect.has(target, key) ? Reflect.get(target, key) : Reflect.get(state, key); },
    });
    (globalThis as any).Alpine = {
        effect(callback: () => void) { const runner = effect(callback); activeEffects.add(runner); return runner; },
        release(runner: ReactiveEffectRunner) { stop(runner); activeEffects.delete(runner); },
        onElRemoved(target: Element, callback: () => void) { removals.set(target, callback); },
    };
    const destroy = () => { callbacks.forEach(callback => callback()); el.remove(); };
    disposers.push(destroy);
    return { wire, container, el, state, callbacks, removals, activeEffects, destroy };
}

describe("React mounting lifecycle", () => {
    it("unmounts effects and subscriptions when the Livewire component is destroyed", async () => {
        const f = fixture();
        const cleanup = vi.fn();
        function Counter() {
            const wire = useWire();
            useEffect(() => cleanup, []);
            return <span>{wire.count}</span>;
        }
        await act(async () => mountReact(f.wire, Counter, "app"));
        expect(f.activeEffects.size).toBe(1);
        act(f.destroy);
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(f.activeEffects.size).toBe(0);
        expect(f.callbacks.size).toBe(0);
    });

    it("disposes on container removal and can create a fresh root on the same element", async () => {
        const f = fixture();
        const cleanup = vi.fn();
        function Component() { useEffect(() => cleanup, []); return <span>mounted</span>; }
        await act(async () => mountReact(f.wire, Component, "app"));
        act(() => { f.container.remove(); f.removals.get(f.container)!(); });
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(f.callbacks.size).toBe(0);
        f.el.append(f.container);
        await act(async () => mountReact(f.wire, Component, "app"));
        expect(f.container.textContent).toBe("mounted");
        act(f.destroy);
        expect(cleanup).toHaveBeenCalledTimes(2);
    });

    it("reuses a mounted root without resetting local state", async () => {
        const f = fixture();
        let increment!: () => void;
        function Counter() {
            const [count, setCount] = useState(0);
            increment = () => setCount(count + 1);
            return <span>{count}</span>;
        }
        await act(async () => mountReact(f.wire, Counter, "app"));
        act(() => increment());
        await act(async () => mountReact(f.wire, Counter, "app"));
        expect(f.container.textContent).toBe("1");
        expect(f.callbacks.size).toBe(1);
    });

    it("ignores imports completing after the component or target was removed", async () => {
        const f = fixture();
        const Component = vi.fn(() => <span>late</span>);
        f.container.remove();
        await act(async () => mountReact(f.wire, Component, "app"));
        expect(Component).not.toHaveBeenCalled();
        expect(f.callbacks.size).toBe(0);
        f.destroy();
        delete (f.wire.$refs as any).app;
        expect(() => mountReact(f.wire, Component, "app")).not.toThrow();
    });
});
