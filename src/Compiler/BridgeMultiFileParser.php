<?php

namespace LivewireBridge\Compiler;

use Livewire\Compiler\Compiler;
use Livewire\Compiler\Parser\MultiFileParser;

class BridgeMultiFileParser extends MultiFileParser
{
    public string $bridgeScriptPath;

    public static function parse(Compiler $compiler, string $path): self
    {
        $scriptPath = static::resolveBridgeScriptPath($path);

        if ($scriptPath === null) {
            throw new \LogicException('No bridge-compatible script found for '.$path);
        }

        $parser = parent::parse($compiler, $path);

        $bridgeParser = new self(
            $parser->path,
            file_get_contents($scriptPath),
            $parser->stylePortion,
            $parser->globalStylePortion,
            $parser->classPortion,
            $parser->viewPortion,
            $parser->placeholderPortion,
        );
        $bridgeParser->bridgeScriptPath = $scriptPath;

        return $bridgeParser;
    }

    public static function resolveBridgeScriptPath(string $path): ?string
    {
        if (! is_dir($path)) {
            return null;
        }

        $name = preg_replace('/⚡[\x{FE0E}\x{FE0F}]?/u', '', basename($path));
        $matches = [];

        foreach (['react.jsx', 'react.tsx', 'jsx', 'tsx', 'ts', 'js'] as $suffix) {
            $candidate = $path.'/'.$name.'.'.$suffix;

            if (! file_exists($candidate)) {
                continue;
            }

            if ($suffix !== 'js' || static::hasModuleImport(file_get_contents($candidate))) {
                $matches[] = $candidate;
            }
        }

        if (count($matches) > 1) {
            throw new \Exception('Multiple bridge-compatible scripts found for '.$path.': '.implode(', ', $matches));
        }

        return $matches[0] ?? null;
    }

    public function generateScriptContents(): ?string
    {
        $relativePath = str_replace(
            '\\',
            '/',
            ltrim(str_replace(base_path(), '', $this->bridgeScriptPath), DIRECTORY_SEPARATOR),
        );
        $source = rtrim(strtr(base64_encode($relativePath), '+/', '-_'), '=');
        $moduleUrl = route('livewire-bridge.module', ['source' => $source], false);
        $specifier = json_encode($moduleUrl, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

        return "export { run } from {$specifier};\n";
    }

    private static function hasModuleImport(string $source): bool
    {
        return preg_match('/(?:^|\R)\s*import(?:\s|\()/m', $source) === 1;
    }
}
