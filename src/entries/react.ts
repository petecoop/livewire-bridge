export type ReactEntryModuleOptions = {
    reactComponentPrefix: string;
    reactModule: string;
    ref: string;
    source: string;
};

export function createReactEntryModule({
    reactComponentPrefix,
    reactModule,
    ref,
    source,
}: ReactEntryModuleOptions): string {
    return `
import { createRoot } from "react-dom/client";
import { WireProvider } from ${JSON.stringify(reactModule)};
import Component from "${reactComponentPrefix}${source}";

const roots = new WeakMap();
const ref = ${JSON.stringify(ref)};

export function run($wire, $js) {
    const container = $wire.$refs[ref];

    if (!container) {
        throw new Error('Livewire React target wire:ref="' + ref + '" was not found');
    }

    let root = roots.get(container);

    if (!root) {
        root = createRoot(container);
        roots.set(container, root);
    }

    root.render(
        <WireProvider $wire={$wire}>
            <Component />
        </WireProvider>,
    );
}
`.trim();
}
