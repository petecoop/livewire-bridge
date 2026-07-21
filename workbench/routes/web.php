<?php

use Illuminate\Support\Facades\Route;
use Tests\Fixtures\ClassCounter;

Route::livewire('/', 'pages::counter')->name('fixture');
Route::livewire('/mfc', 'pages::mfc')->name('mfc');
Route::livewire('/class', ClassCounter::class)->name('class');
Route::view('/other', 'other')->name('other');
