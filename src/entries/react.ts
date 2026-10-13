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
import { mountReact } from ${JSON.stringify(reactModule)};
import Component from "${reactComponentPrefix}${source}";

const ref = ${JSON.stringify(ref)};

export function run($wire, $js) {
    mountReact($wire, Component, ref);
}
`.trim();
}
