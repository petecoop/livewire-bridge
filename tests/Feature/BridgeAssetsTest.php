<?php

use Illuminate\Foundation\Vite as ViteInstance;
use Illuminate\Support\Facades\Vite;
use Livewire\Component;
use Livewire\Livewire;
use LivewireBridge\BridgeAssets;

use function Livewire\store;

function bridgeManifest(string $version = 'one'): void
{
    $directory = 'bridge-test-'.bin2hex(random_bytes(4));
    mkdir(public_path($directory), 0777, true);
    test()->beforeApplicationDestroyed(fn () => (new \Illuminate\Filesystem\Filesystem)->deleteDirectory(public_path($directory)));
    $entry = 'resources/views/pages/⚡counter.blade.php.livewire-entry.tsx';
    file_put_contents(public_path($directory.'/custom.json'), json_encode([
        $entry => ['src' => $entry, 'file' => "assets/{$version}.js", 'isEntry' => true, 'imports' => ['_shared'], 'css' => ['assets/component.css']],
        '_shared' => ['file' => 'assets/shared.js', 'imports' => ['_nested'], 'css' => ['assets/shared.css']],
        '_nested' => ['file' => 'assets/nested.js', 'css' => ['assets/nested.css']],
    ], JSON_THROW_ON_ERROR));
    Vite::swap((new ViteInstance)->useBuildDirectory($directory)->useManifestFilename('custom.json'));
}

it('registers entry preloads and all CSS dependencies using the configured Vite instance', function () {
    bridgeManifest();
    $component = new class extends Component {};
    BridgeAssets::register($component, 'resources/views/pages/⚡counter.blade.php');
    $assets = store($component)->get('assets');
    $html = implode('', $assets);

    expect($html)->toContain('assets/one.js')
        ->toContain('assets/shared.js')
        ->toContain('assets/nested.js')
        ->toContain('assets/component.css')
        ->toContain('assets/shared.css')
        ->toContain('assets/nested.css')
        ->toContain('rel="modulepreload"')
        ->toContain('rel="stylesheet"')
        ->not->toContain('/bridge/');

    BridgeAssets::register($component, 'resources/views/pages/⚡counter.blade.php');
    expect(store($component)->get('assets'))->toBe($assets);

    Vite::useCspNonce('different-request');
    $other = new class extends Component {};
    BridgeAssets::register($other, 'resources/views/pages/⚡counter.blade.php');
    expect(array_keys(store($other)->get('assets')))->toBe(array_keys($assets));
});

it('resolves new deployment URLs without recompiling a Livewire view', function () {
    bridgeManifest('one');
    $first = Livewire::test('pages::counter');
    $scripts = implode('', $first->effects['scripts']);
    expect($scripts)->toContain('assets/one.js')->not->toContain('/bridge/');
    expect($first->effects)->not->toHaveKey('scriptModule');

    bridgeManifest('two');
    $second = Livewire::test('pages::counter');
    expect(implode('', $second->effects['scripts']))->toContain('assets/two.js')->not->toContain('assets/one.js');
});

it('resolves hot-server modules at render time', function () {
    $hotFile = public_path('bridge-test.hot');
    file_put_contents($hotFile, 'http://localhost:5173');
    Vite::swap((new ViteInstance)->useHotFile($hotFile));
    try {
        expect(BridgeAssets::url('resources/views/pages/⚡counter.blade.php'))
            ->toStartWith('http://localhost:5173/@livewire-bridge/');
    } finally {
        unlink($hotFile);
    }
});
