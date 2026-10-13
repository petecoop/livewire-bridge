import { createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WireProvider, type Wire } from "./react-runtime";

const roots = new WeakMap<Element, Root>();

type MountWire = Wire & {
    $refs: Record<string, Element | undefined>;
};

/** Mount once per container and release React when Livewire or Alpine removes it. */
export function mountReact($wire: MountWire, Component: ComponentType, ref: string): void {
    const container = $wire.$refs[ref];
    // An asynchronous import may finish after its Livewire component was removed.
    const instance = typeof $wire.__instance === "function" ? $wire.__instance() : $wire.__instance;
    if (instance?.el && !instance.el.isConnected) return;
    if (!container) throw new Error(`Livewire React target wire:ref="${ref}" was not found`);
    if (!container.isConnected) return;

    let root = roots.get(container);
    if (!root) {
        const alpine = (globalThis as typeof globalThis & {
            Alpine?: { onElRemoved?: (el: Element, callback: () => void) => void };
        }).Alpine;
        if (!instance?.addCleanup || !alpine?.onElRemoved) {
            throw new Error("Livewire's component cleanup runtime is unavailable");
        }
        root = createRoot(container);
        roots.set(container, root);
        const mountedRoot = root;
        let disposed = false;
        let removeCleanup: (() => void) | undefined;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
            roots.delete(container);
            mountedRoot.unmount();
            removeCleanup?.();
        };
        removeCleanup = instance.addCleanup(dispose);
        alpine.onElRemoved(container, dispose);
    }
    root.render(createElement(WireProvider, { $wire, children: createElement(Component) }));
}
