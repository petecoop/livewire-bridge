<?php

namespace LivewireViteReact;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use Livewire\Livewire;

class LivewireViteReactServiceProvider extends ServiceProvider
{
    private const ENTRY_PREFIX = '/@livewire-vite/';

    private const ENTRY_SUFFIX = '.livewire-entry.tsx';

    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/livewire-vite-react.php', 'livewire-vite-react');
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../config/livewire-vite-react.php' => config_path('livewire-vite-react.php'),
        ], 'livewire-vite-react-config');

        Livewire::prepareViewsForCompilationUsing(
            fn (string $contents, string $path): string => $this->replaceViteScripts($contents, $path),
        );

        Route::get(app('livewire')->getUriPrefix().'/vite/{source}.js', function (string $source) {
            $path = $this->decodeSource($source);

            abort_unless($path !== null && $this->isSourcePath($path), 404);

            $url = Vite::isRunningHot()
                ? Vite::asset(self::ENTRY_PREFIX.$source)
                : Vite::asset($path.self::ENTRY_SUFFIX);
            $specifier = json_encode($url, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

            return response("export { run } from {$specifier};\n")
                ->header('Content-Type', 'text/javascript; charset=UTF-8')
                ->header('Cache-Control', 'no-store');
        })->where('source', '[A-Za-z0-9_-]+')->name('livewire-vite-react.module');
    }

    private function replaceViteScripts(string $contents, string $path): string
    {
        if (! str_contains($contents, 'data-vite') && ! str_contains($contents, 'data-react')) {
            return $contents;
        }

        $relativePath = str_replace('\\', '/', ltrim(str_replace(base_path(), '', $path), DIRECTORY_SEPARATOR));
        $source = $this->encodeSource($relativePath);
        $moduleUrl = route('livewire-vite-react.module', ['source' => $source], false);
        $specifier = json_encode($moduleUrl, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

        return preg_replace(
            '/<script\b(?=[^>]*(?:\bdata-vite\b|\bdata-react\b))[^>]*>.*?<\/script>/s',
            <<<HTML
            <script>
                import { run as runViteModule } from {$specifier};
                runViteModule.call(this, \$wire, \$js);
            </script>
            HTML,
            $contents,
            1,
        ) ?? $contents;
    }

    private function encodeSource(string $path): string
    {
        return rtrim(strtr(base64_encode($path), '+/', '-_'), '=');
    }

    private function decodeSource(string $source): ?string
    {
        $decoded = base64_decode(strtr($source, '-_', '+/'), true);

        return $decoded === false ? null : $decoded;
    }

    private function isSourcePath(string $path): bool
    {
        $absolutePath = realpath(base_path($path));

        if ($absolutePath === false) {
            return false;
        }

        foreach ($this->sourcePaths() as $directory) {
            $sourcePath = realpath($this->absolutePath($directory));

            if ($sourcePath !== false && str_starts_with($absolutePath, $sourcePath.DIRECTORY_SEPARATOR)) {
                return true;
            }
        }

        return false;
    }

    /** @return array<int, string> */
    private function sourcePaths(): array
    {
        $paths = config('livewire-vite-react.paths');

        if (is_array($paths)) {
            return array_values(array_unique($paths));
        }

        return array_values(array_unique([
            ...(array) config('livewire.component_locations', []),
            ...array_values((array) config('livewire.component_namespaces', [])),
        ]));
    }

    private function absolutePath(string $path): string
    {
        $isAbsolute = str_starts_with($path, DIRECTORY_SEPARATOR)
            || preg_match('/^[A-Za-z]:[\\\\\/]/', $path) === 1;

        return $isAbsolute ? $path : base_path($path);
    }
}
