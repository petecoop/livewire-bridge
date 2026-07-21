<?php

it('keeps Livewire, Alpine, and React state synchronized without tracking unread fields', function () {
    $page = visit('/')
        ->assertSeeIn('@livewire-counter', 'Livewire: 0')
        ->assertSeeIn('@alpine-counter', 'Alpine: 0')
        ->assertSeeIn('@react-counter', 'React: 0')
        ->assertSeeIn('@react-render-count', 'Renders: 1');

    $page->click('@ignored-counter')
        ->assertSeeIn('@ignored-counter', 'Ignored: 1')
        ->assertSeeIn('@react-render-count', 'Renders: 1');

    $page->click('@alpine-counter')
        ->assertSeeIn('@livewire-counter', 'Livewire: 0')
        ->assertSeeIn('@alpine-counter', 'Alpine: 1')
        ->assertSeeIn('@react-counter', 'React: 1')
        ->assertSeeIn('@react-render-count', 'Renders: 2');

    $page->click('@react-counter')
        ->assertSeeIn('@alpine-counter', 'Alpine: 2')
        ->assertSeeIn('@react-counter', 'React: 2')
        ->assertSeeIn('@react-render-count', 'Renders: 3');

    $page->click('@livewire-counter')
        ->assertSeeIn('@livewire-counter', 'Livewire: 3')
        ->assertSeeIn('@alpine-counter', 'Alpine: 3')
        ->assertSeeIn('@react-counter', 'React: 3')
        ->assertSeeIn('@react-render-count', 'Renders: 4')
        ->assertNoJavaScriptErrors();
})->group('browser');

it('reacts to nested state and remounts after wire navigation', function () {
    $page = visit('/')
        ->assertSeeIn('@react-profile', 'Profile: Taylor');

    $page->click('@nested-mutation')
        ->assertSeeIn('@react-profile', 'Profile: Sam')
        ->click('@navigate-away')
        ->assertPathIs('/other')
        ->assertSeeIn('@other-page', 'Navigation target')
        ->click('@navigate-back')
        ->assertPathIs('/')
        ->assertSeeIn('@react-counter', 'React: 0')
        ->assertNoJavaScriptErrors();
})->group('browser');

it('mounts an explicitly named React multi-file component', function () {
    $page = visit('/mfc')
        ->assertSeeIn('@mfc-livewire-counter', 'Livewire: 0')
        ->assertSeeIn('@mfc-react-counter', 'React: 0');

    $page->click('@mfc-react-counter')
        ->assertSeeIn('@mfc-react-counter', 'React: 1')
        ->click('@mfc-livewire-counter')
        ->assertSeeIn('@mfc-livewire-counter', 'Livewire: 2')
        ->assertSeeIn('@mfc-react-counter', 'React: 2')
        ->assertNoJavaScriptErrors();
})->group('browser');

it('mounts React from a class component script block', function () {
    $page = visit('/class')
        ->assertSeeIn('@class-livewire-counter', 'Livewire: 0')
        ->assertSeeIn('@class-react-counter', 'React: 0');

    $page->click('@class-react-counter')
        ->assertSeeIn('@class-react-counter', 'React: 1')
        ->click('@class-livewire-counter')
        ->assertSeeIn('@class-livewire-counter', 'Livewire: 2')
        ->assertSeeIn('@class-react-counter', 'React: 2')
        ->assertNoJavaScriptErrors();
})->group('browser');

it('leaves class components without scripts on the native Livewire path', function () {
    $page = visit('/class/no-script')
        ->assertSeeIn('@no-script-livewire-counter', 'Livewire: 0');

    $page->click('@no-script-livewire-counter')
        ->assertSeeIn('@no-script-livewire-counter', 'Livewire: 1')
        ->assertNoJavaScriptErrors();
})->group('browser');

it('leaves unmarked class component scripts on the native Livewire path', function () {
    $page = visit('/class/unmarked-script')
        ->assertSeeIn('@unmarked-script-livewire-counter', 'Livewire: 0')
        ->assertSeeIn('@unmarked-script-wire-counter', 'Alpine: 0');

    $page->click('@unmarked-script-wire-counter')
        ->assertSeeIn('@unmarked-script-wire-counter', 'Alpine: 1')
        ->click('@unmarked-script-livewire-counter')
        ->assertSeeIn('@unmarked-script-livewire-counter', 'Livewire: 2')
        ->assertSeeIn('@unmarked-script-wire-counter', 'Alpine: 2')
        ->assertNoJavaScriptErrors();
})->group('browser');
