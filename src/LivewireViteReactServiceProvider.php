<?php

namespace LivewireViteReact;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use Livewire\Livewire;

class LivewireViteReactServiceProvider extends ServiceProvider
{
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

        Route::get($this->routePath().'/{source}.js', function (string $source) {
            $path = $this->decodeSource($source);

            abort_unless($path !== null && $this->isSourcePath($path), 404);

            $url = Vite::isRunningHot()
                ? Vite::asset($this->entryPrefix().$source)
                : $this->builtModuleUrl($source);
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

    private function builtModuleUrl(string $source): string
    {
        $buildDirectory = trim((string) config('livewire-vite-react.build_directory'), '/');
        $manifestPath = public_path($buildDirectory.'/'.config('livewire-vite-react.manifest'));

        abort_unless(file_exists($manifestPath), 503, 'The Livewire Vite manifest is missing. Run the Vite build first.');

        $manifest = json_decode(file_get_contents($manifestPath), true, flags: JSON_THROW_ON_ERROR);
        $entry = $manifest[$source] ?? null;

        abort_unless(is_array($entry) && isset($entry['file']), 404, 'The Livewire component script was not found in the Vite build.');

        $file = ltrim($entry['file'], '/');

        abort_unless(file_exists(public_path($buildDirectory.'/'.$file)), 503, 'The built Livewire component script is missing.');

        return asset($buildDirectory.'/'.$file);
    }

    private function routePath(): string
    {
        return '/'.trim((string) config('livewire-vite-react.route_prefix'), '/');
    }

    private function entryPrefix(): string
    {
        return trim((string) config('livewire-vite-react.entry_prefix'), '/').'/';
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

        foreach ((array) config('livewire-vite-react.source_directories', []) as $directory) {
            $sourcePath = realpath(base_path($directory));

            if ($sourcePath !== false && str_starts_with($absolutePath, $sourcePath.DIRECTORY_SEPARATOR)) {
                return true;
            }
        }

        return false;
    }
}
