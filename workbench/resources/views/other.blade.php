<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Navigation fixture</title>
    @livewireStyles
</head>
<body>
    <p data-testid="other-page">Navigation target</p>
    <a href="/" wire:navigate data-testid="navigate-back">Back to fixture</a>

    @livewireScripts
</body>
</html>
