# livewire-bridge

`import` inside Livewire scripts. Provides a react wrapper and `useWire()` hook for Livewire state.

## Installation

```bash
composer require petecoop/livewire-bridge
npm install @petecoop/livewire-bridge
```

React support is optional. Install its runtime and Vite plugin when using
`bridge:react`:

```bash
npm install react react-dom
npm install --save-dev @vitejs/plugin-react
```

## Vite configuration

```js
import laravel, { refreshPaths } from "laravel-vite-plugin";
import livewireBridge, { exceptLivewire } from "@petecoop/livewire-bridge";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    laravel({
      input: ["resources/css/app.css", "resources/js/app.js"],
      refresh: exceptLivewire(refreshPaths),
    }),
    react(),
    livewireBridge(),
  ],
});
```

`exceptLivewire()` removes Livewire's component directories from Laravel's
refresh paths so the Livewire plugin can manage their updates. The exported
`livewirePaths` array contains the paths that it excludes and that the plugin
scans by default, matching an unmodified Livewire 4 application:

- `resources/views/components`
- `resources/views/livewire`
- `resources/views/layouts`
- `resources/views/pages`

Use the single `paths` option when the application has different component
locations:

```js
livewireBridge({ paths: ["resources/views/components"] });
```

Publish `config/livewire-bridge.php` and set the corresponding absolute PHP
paths when they differ from Livewire's configured component locations and
namespaces.

## Importing in script blocks

Use `bridge` to mark a `<script>` block for Vite processing. `$wire` and `$js` are available in the script:

```blade
<script lang="ts" bridge>
    import { format } from "some-package";

    $js("formattedCount", () => format($wire.count));
</script>
```

## React

Use `bridge:react` to mark a `<script>` block for Vite processing and React component export. Use a `wire:ref` target to mount the component. The `useWire()` hook provides a reactive `$wire` proxy for reading and writing Livewire state:

```blade
<div wire:ref="app" wire:ignore></div>

<script lang="tsx" bridge:react="app">
    import { useWire } from "@petecoop/livewire-bridge/react";

    export default function Counter() {
        const $wire = useWire();

        return <button onClick={() => $wire.count++}>{$wire.count}</button>;
    }
</script>
```

The script must default-export a React component. React scripts use a stable
root adapter and a separately refreshable component module, so compatible local
state survives React Fast Refresh without reloading the Livewire component.

### useWire() hook

`useWire()` returns a writable `$wire` proxy and tracks the reactive paths read during the committed React render.

Property writes, `$set`, and Livewire action calls continue to pass through
the same `$wire` proxy. A `useWire()` call used only inside an event handler
records no render dependencies.

The hook updates for Alpine mutations, React proxy writes, and server responses
without creating `$watch` subscriptions.
