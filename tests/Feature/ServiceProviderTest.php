<?php

use Illuminate\Support\Facades\Route;

function fixtureSource(): string
{
    return rtrim(strtr(base64_encode('resources/views/pages/⚡counter.blade.php'), '+/', '-_'), '=');
}

it('registers the component module route', function () {
    $route = Route::getRoutes()->getByName('livewire-vite-react.module');

    expect($route)->not->toBeNull()
        ->and('/'.$route->uri())->toBe(app('livewire')->getUriPrefix().'/vite/{source}.js');
});

it('compiles marked scripts into the Livewire module bridge', function () {
    $this->get('/')
        ->assertOk()
        ->assertSee('scriptModule', escape: false)
        ->assertDontSee('data-react=', escape: false);
});

it('serves a production wrapper for a built fixture module', function () {
    $response = $this->get(app('livewire')->getUriPrefix().'/vite/'.fixtureSource().'.js');

    $response->assertOk()
        ->assertHeader('Content-Type', 'text/javascript; charset=UTF-8');

    expect($response->getContent())
        ->toContain('export { run } from "http://localhost/build/assets/')
        ->toEndWith(";\n")
        ->and($response->headers->get('Cache-Control'))->toContain('no-store');
});

it('refuses module sources outside configured view directories', function () {
    $outsideSource = rtrim(strtr(base64_encode('composer.json'), '+/', '-_'), '=');

    $this->get(app('livewire')->getUriPrefix().'/vite/'.$outsideSource.'.js')->assertNotFound();
});
