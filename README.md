# livewire-bridge

Use JavaScript imports and React components in Livewire, with `useWire()` for reading and writing Livewire state.

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

### Vite configuration

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

## Import

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

The script must default-export a React component. React Fast Refresh preserves
compatible local state while editing the component.

### useWire() hook

`useWire()` returns a writable `$wire` proxy. React updates when Livewire state
read during rendering changes, including nested properties and arrays. Changes
to unread properties do not trigger a render.

Use property assignments, `$set`, and Livewire action calls as you would with
`$wire`. Updates from Alpine and server responses are reflected in React too.

## Multi-file components

The bridge automatically handles a script next to a Livewire multi-file
component when its filename matches the component and one of these conditions
is true:

- `.js` files use the bridge when they contain an `import`; plain JavaScript
  stays on Livewire's native script path.
- `.jsx`, `.ts`, and `.tsx` files run as general bridge scripts with `$wire`
  and `$js` in scope.
- `.react.jsx` and `.react.tsx` files use the React adapter. They must export a
  `wireRef` string naming the mount target and default-export the component.

```text
resources/views/pages/⚡counter/
├── counter.php
├── counter.blade.php
└── counter.react.tsx
```

```blade
<div wire:ref="counter" wire:ignore></div>
```

```tsx
import { useWire } from "@petecoop/livewire-bridge/react";

export const wireRef = "counter";

export default function Counter() {
  const $wire = useWire<{ count: number }>();

  return <button onClick={() => $wire.count++}>{$wire.count}</button>;
}
```


## Assets

Import CSS alongside your JavaScript:

```js
import "./counter.css";
```

Run your usual Vite development server or production build. The bridge includes
component scripts in the build and loads their JavaScript and CSS automatically.
