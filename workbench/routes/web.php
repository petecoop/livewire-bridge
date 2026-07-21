<?php

use Illuminate\Support\Facades\Route;

Route::livewire('/', 'pages::counter')->name('fixture');
Route::livewire('/mfc', 'pages::mfc')->name('mfc');
Route::view('/other', 'other')->name('other');
