# livewire-vite-react

Vite-powered component scripts and React integration for Livewire 4.

This repository produces two coordinated packages:

- `petecoop/livewire-vite-react` on Composer provides the Laravel
  service provider, component-module bridge, and configuration.
- `@petecoop/livewire-vite-react` on npm provides the Vite plugin and React runtime.

Both packages should use the same release version. Keeping the JavaScript in an
npm package lets Vite resolve it normally and avoids copying generated assets
out of `vendor` during installation.

## Installation

```bash
composer require petecoop/livewire-vite-react
npm install @petecoop/livewire-vite-react
```

Laravel discovers the service provider automatically. Publish its configuration
when the application uses non-default paths:

```bash
php artisan vendor:publish --tag=livewire-vite-react-config
```

## Vite configuration

```js
import laravel, { refreshPaths } from "laravel-vite-plugin";
import livewireViteReact from "@petecoop/livewire-vite-react/vite";
import { defineConfig } from "vite";

const livewireScripts = {
    sourceDirectories: ["resources/views"],
    sourceExtensions: [".blade.php"],
    entryPrefix: "/@livewire-vite/",
    reactComponentPrefix: "/@livewire-vite-react-component/",
    reactModule: "@petecoop/livewire-vite-react",
    manifestFile: "livewire-manifest.json",
};

export default defineConfig({
    plugins: [
        laravel({
            input: ["resources/css/app.css", "resources/js/app.js"],
            refresh: refreshPaths.filter((refreshPath) => {
                return !livewireScripts.sourceDirectories.some((directory) => {
                    return refreshPath === `${directory}/**`;
                });
            }),
        }),
        livewireViteReact(livewireScripts),
    ],
});
```

The Laravel and Vite configuration must agree on `sourceDirectories`,
`entryPrefix`, the build directory, and the manifest filename.

The example removes the component source directories from Laravel's normal
full-page refresh watcher. The Livewire plugin then owns changes in those views:
React-script-only edits use Fast Refresh, while markup and general script edits
still trigger a full reload.

## General Vite scripts

`data-vite` retains Livewire's imperative script semantics without loading
React:

```blade
<script lang="ts" data-vite>
    import { format } from "some-package";

    $js("formattedCount", () => format($wire.count));
</script>
```

Static imports are moved to module scope and the remaining body runs with the
component's `$wire` and `$js` values.

## React scripts

`data-react` names the required Livewire ref that hosts the React root:

```blade
<div wire:ref="app" wire:ignore></div>

<script lang="tsx" data-react="app">
    import { useWire, useWireProxy } from "@petecoop/livewire-vite-react";

    export default function Counter() {
        const count = useWire(($wire) => $wire.count);
        const $wire = useWireProxy();

        return <button onClick={() => $wire.count++}>{count}</button>;
    }
</script>
```

The script must default-export a React component. React scripts use a stable
root adapter and a separately refreshable component module, so compatible local
state survives React Fast Refresh without reloading the Livewire component.

### Wire hooks

- `useWire()` returns the full `$wire` proxy and subscribes to every existing
  public property.
- `useWire(selector)` watches only the top-level properties read by the
  selector. Livewire's deep watch behavior covers nested changes, and React
  compares selected snapshots with `Object.is`.
- `useWireProxy()` returns the instance-scoped proxy without subscribing. Use
  it for property writes, `$set`, and Livewire action calls alongside a narrow
  selector.

Selector consumers update for Alpine mutations, React proxy writes, and server
responses because subscriptions use Livewire's Alpine-reactive `$watch` API.

## Development

```bash
npm install
npm run build
```

In this testbed, the root application's `dev` and `build` commands build the
linked package before Vite starts. While developing the package itself, run
`npm run dev` in this directory in a second terminal to rebuild its public
entries as their source files change.

tsdown emits ESM bundles and declarations for two public entry points:

- `@petecoop/livewire-vite-react` from `src/runtime.ts`
- `@petecoop/livewire-vite-react/vite` from `src/vite.ts`

The Vite plugin keeps its generated generic and React entry modules in
`src/entries/`, separate from the React runtime.

## Current limitations

- Only the first marked script in a view is supported.
- General `data-vite` import extraction supports one-line static imports.
- React roots are not yet unmounted with Livewire's destroy lifecycle.
- Production CSS imported by a component entry is not yet attached from the
  custom manifest.
