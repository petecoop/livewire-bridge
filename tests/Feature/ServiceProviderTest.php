<?php

use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\Route;
use LivewireBridge\Compiler\BridgeCompiler;

function fixtureSource(): string
{
    return rtrim(strtr(base64_encode('resources/views/pages/⚡counter.blade.php'), '+/', '-_'), '=');
}

function makeMultiFileFixture(string $name, string $extension, string $script): string
{
    $filesystem = new Filesystem;
    $directory = resource_path('views/pages/⚡'.$name);

    if ($filesystem->isDirectory($directory)) {
        $filesystem->deleteDirectory($directory);
    }

    $filesystem->ensureDirectoryExists($directory);
    $filesystem->put($directory.'/'.$name.'.php', <<<'PHP'
    <?php

    use Livewire\Component;

    new class extends Component {};
    PHP);
    $filesystem->put($directory.'/'.$name.'.blade.php', '<div wire:ref="app"></div>');
    $filesystem->put($directory.'/'.$name.'.'.$extension, $script);

    return $directory;
}

it('registers the component module route', function () {
    $route = Route::getRoutes()->getByName('livewire-bridge.module');

    expect($route)->not->toBeNull()
        ->and('/'.$route->uri())->toBe(app('livewire')->getUriPrefix().'/bridge/{source}.js');
});

it('decorates Livewire compilation for bridge-compatible MFC scripts', function () {
    $compiler = app('livewire.compiler');

    expect($compiler)->toBeInstanceOf(BridgeCompiler::class);

    foreach ([
        ['typed', 'ts', 'const count: number = $wire.count;'],
        ['react', 'react.tsx', 'export const wireRef = "widget"; export default function App() { return <p>Ready</p>; }'],
        ['imported', 'js', 'import "./dependency.js";'],
    ] as [$name, $extension, $script]) {
        $path = makeMultiFileFixture($name, $extension, $script);
        $class = $compiler->compile($path);
        $compiledScript = file_get_contents($compiler->cacheManager->getScriptPath($path));

        expect($compiledScript)
            ->toStartWith('export { run } from "/livewire-')
            ->toContain('/bridge/')
            ->and(method_exists(new $class, 'scriptModuleSrc'))->toBeTrue();
    }
});

it('leaves plain MFC JavaScript on Livewire\'s native compiler path', function () {
    $path = makeMultiFileFixture('native', 'js', '$js("ready", () => true);');
    $compiler = app('livewire.compiler');

    $compiler->compile($path);

    expect(file_get_contents($compiler->cacheManager->getScriptPath($path)))
        ->toContain('export function run($wire, $js)')
        ->not->toContain('/livewire/bridge/');
});

it('compiles marked scripts into the Livewire module bridge', function () {
    $this->get('/')
        ->assertOk()
        ->assertSee('scriptModule', escape: false)
        ->assertDontSee('bridge:react=', escape: false);
});

it('serves a production wrapper for a built fixture module', function () {
    $response = $this->get(app('livewire')->getUriPrefix().'/bridge/'.fixtureSource().'.js');

    $response->assertOk()
        ->assertHeader('Content-Type', 'text/javascript; charset=UTF-8');

    expect($response->getContent())
        ->toContain('export { run } from "http://localhost/build/assets/')
        ->toEndWith(";\n")
        ->and($response->headers->get('Cache-Control'))->toContain('no-store');
});

it('refuses module sources outside configured view directories', function () {
    $outsideSource = rtrim(strtr(base64_encode('composer.json'), '+/', '-_'), '=');

    $this->get(app('livewire')->getUriPrefix().'/bridge/'.$outsideSource.'.js')->assertNotFound();
});
