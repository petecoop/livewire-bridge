<?php

namespace LivewireBridge;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use Illuminate\View\Compilers\BladeCompiler;
use Livewire\Compiler\Compiler;
use Livewire\Livewire;
use LivewireBridge\Compiler\BridgeCompiler;

class LivewireBridgeServiceProvider extends ServiceProvider
{
    private const ENTRY_PREFIX = '/@livewire-bridge/';

    private const ENTRY_SUFFIX = '.livewire-entry.tsx';

    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/livewire-bridge.php', 'livewire-bridge');

        $this->app->extend('livewire.compiler', function (Compiler $compiler): BridgeCompiler {
            return new BridgeCompiler($compiler->cacheManager);
        });
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../config/livewire-bridge.php' => config_path('livewire-bridge.php'),
        ], 'livewire-bridge-config');

        Livewire::prepareViewsForCompilationUsing(
            fn (string $contents, string $path): string => $this->replaceBridgeScripts($contents, $path),
        );

        /** @var BladeCompiler $blade */
        $blade = app('blade.compiler');
        $blade->prepareStringsForCompilationUsing(function (string $contents) use ($blade): string {
            $path = $blade->getPath();

            return is_string($path) && is_file($path)
                ? $this->replaceBridgeScripts($contents, $path)
                : $contents;
        });

        Route::get(app('livewire')->getUriPrefix().'/bridge/{source}.js', function (string $source) {
            $path = $this->decodeSource($source);

            abort_unless($path !== null && $this->isSourcePath($path), 404);

            $url = Vite::isRunningHot()
                ? Vite::asset(self::ENTRY_PREFIX.$source)
                : Vite::asset($path.self::ENTRY_SUFFIX);
            $specifier = json_encode($url, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

            return response("export { run } from {$specifier};\n")
                ->header('Content-Type', 'text/javascript; charset=UTF-8')
                ->header('Cache-Control', 'no-store');
        })->where('source', '[A-Za-z0-9_-]+')->name('livewire-bridge.module');
    }

    private function replaceBridgeScripts(string $contents, string $path): string
    {
        if (! str_contains($contents, 'bridge')) {
            return $contents;
        }

        $relativePath = str_replace('\\', '/', ltrim(str_replace(base_path(), '', $path), DIRECTORY_SEPARATOR));
        $source = $this->encodeSource($relativePath);
        $moduleUrl = route('livewire-bridge.module', ['source' => $source], false);
        $specifier = json_encode($moduleUrl, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

        $contents = preg_replace_callback(
            '/@script\b.*?@endscript/s',
            fn (array $matches): string => $this->replaceBridgeScriptTag($matches[0], $specifier, dynamic: true),
            $contents,
        ) ?? $contents;

        return $this->replaceBridgeScriptTag($contents, $specifier);
    }

    private function replaceBridgeScriptTag(string $contents, string $specifier, bool $dynamic = false): string
    {
        $replacement = $dynamic
            ? <<<HTML
            <script>
                import({$specifier}).then(({ run: runBridgeModule }) => {
                    runBridgeModule.call(this, \$wire, \$js);
                });
            </script>
            HTML
            : <<<HTML
            <script>
                import { run as runBridgeModule } from {$specifier};
                runBridgeModule.call(this, \$wire, \$js);
            </script>
            HTML;

        return preg_replace(
            '/<script\b(?=[^>]*(?:\sbridge(?:\s|=|>)|\sbridge:react\s*=))[^>]*>.*?<\/script>/s',
            $replacement,
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
        $paths = config('livewire-bridge.paths');

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
