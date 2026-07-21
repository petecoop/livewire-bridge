<?php

use Illuminate\Support\Facades\Route;

Route::livewire('/', 'pages::counter')->name('fixture');
Route::view('/other', 'other')->name('other');
