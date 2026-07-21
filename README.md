# livewire-vite-react

Vite-powered component scripts and React integration for Livewire 4.

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
    import { useWire } from "@petecoop/livewire-vite-react";

    export default function Counter() {
        const $wire = useWire();

        return <button onClick={() => $wire.count++}>{$wire.count}</button>;
    }
</script>
```

The script must default-export a React component. React scripts use a stable
root adapter and a separately refreshable component module, so compatible local
state survives React Fast Refresh without reloading the Livewire component.

### Wire hooks

- `useWire()` returns a writable `$wire` proxy and tracks the reactive paths
  read during the committed React render. Only changes to those paths notify
  that hook subscription.
- Property writes, `$set`, and Livewire action calls continue to pass through
  the same `$wire` proxy. A `useWire()` call used only inside an event handler
  records no render dependencies.

The hook updates for Alpine mutations, React proxy writes, and server responses
without creating `$watch` subscriptions.
