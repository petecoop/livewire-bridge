<?php

use Illuminate\Support\Facades\Route;
use Tests\Fixtures\ClassCounter;
use Tests\Fixtures\NoScriptCounter;
use Tests\Fixtures\UnmarkedScriptCounter;

Route::livewire('/', 'pages::counter')->name('fixture');
Route::livewire('/mfc', 'pages::mfc')->name('mfc');
Route::livewire('/class', ClassCounter::class)->name('class');
Route::livewire('/class/no-script', NoScriptCounter::class)->name('class.no-script');
Route::livewire('/class/unmarked-script', UnmarkedScriptCounter::class)->name('class.unmarked-script');
Route::view('/other', 'other')->name('other');
