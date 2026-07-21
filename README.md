# livewire-vite-react

Vite-powered component scripts and React integration for Livewire 4.

## Installation

```bash
composer require petecoop/livewire-vite-react
npm install @petecoop/livewire-vite-react
```

Laravel discovers the service provider automatically. No PHP configuration is
needed when the application uses Livewire's component locations and namespaces.
Publish the configuration only to scan a different set of paths:

```bash
php artisan vendor:publish --tag=livewire-vite-react-config
```

## Vite configuration

```js
import laravel, { refreshPaths } from "laravel-vite-plugin";
import livewireViteReact, { livewirePaths } from "@petecoop/livewire-vite-react/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    laravel({
      input: ["resources/css/app.css", "resources/js/app.js"],
      refresh: refreshPaths.filter((refreshPath) => {
        const refreshRoot = refreshPath.replace(/\/\*\*$/, "");

        return !livewirePaths.some((livewirePath) => {
          return livewirePath === refreshRoot || livewirePath.startsWith(`${refreshRoot}/`);
        });
      }),
    }),
    react(),
    livewireViteReact(),
  ],
});
```

The exported `livewirePaths` array contains the same paths that the plugin scans
by default, matching an unmodified Livewire 4 application:

- `resources/views/components`
- `resources/views/livewire`
- `resources/views/layouts`
- `resources/views/pages`

Use the single `paths` option when the application has different component
locations:

```js
livewireViteReact({ paths: ["resources/views/components"] });
```

Publish `config/livewire-vite-react.php` and set the corresponding absolute PHP
paths when they differ from Livewire's configured component locations and
namespaces.

If Laravel's Vite plugin also watches these files through its `refresh` option,
filter its exported `refreshPaths` as shown above. The Livewire plugin then owns
changes in its configured paths: React-script-only edits use Fast Refresh, while
markup and general script edits still trigger a full reload.

The package uses Laravel's standard Vite build directory and manifest. Its
component-module endpoint follows Livewire 4's hash-based endpoint prefix, so
there is no route, entry-prefix, build-directory, or manifest option to keep in
sync.

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
