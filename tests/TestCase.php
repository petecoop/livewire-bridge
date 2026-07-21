<?php

namespace Tests;

use Illuminate\Filesystem\Filesystem;
use Livewire\LivewireServiceProvider;
use LivewireViteReact\LivewireViteReactServiceProvider;
use Orchestra\Testbench\Concerns\WithWorkbench;
use Orchestra\Testbench\TestCase as Orchestra;

abstract class TestCase extends Orchestra
{
    use WithWorkbench;

    protected function getPackageProviders($app): array
    {
        return [
            LivewireServiceProvider::class,
            LivewireViteReactServiceProvider::class,
        ];
    }

    protected function setUp(): void
    {
        parent::setUp();

        $filesystem = new Filesystem;
        $fixtureViews = dirname(__DIR__).'/workbench/resources/views';
        $fixtureBuild = dirname(__DIR__).'/workbench/public/build';

        $filesystem->ensureDirectoryExists(resource_path('views'));
        $filesystem->copyDirectory($fixtureViews, resource_path('views'));

        if ($filesystem->isDirectory($fixtureBuild)) {
            $filesystem->ensureDirectoryExists(public_path('build'));
            $filesystem->copyDirectory($fixtureBuild, public_path('build'));
        }
    }
}
