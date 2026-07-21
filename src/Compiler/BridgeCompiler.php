<?php

namespace LivewireBridge\Compiler;

use Livewire\Compiler\Compiler;

class BridgeCompiler extends Compiler
{
    public function compilePath(string $path): void
    {
        if (is_file($path) || BridgeMultiFileParser::resolveBridgeScriptPath($path) === null) {
            parent::compilePath($path);

            return;
        }

        $parser = BridgeMultiFileParser::parse($this, $path);
        $viewFileName = $this->cacheManager->getViewPath($path);
        $placeholderFileName = null;
        $scriptFileName = null;
        $styleFileName = null;
        $globalStyleFileName = null;

        if (($contents = $parser->generatePlaceholderContents()) !== null) {
            $placeholderFileName = $this->cacheManager->getPlaceholderPath($path);
            $this->cacheManager->writePlaceholderFile($path, $contents);
        }

        if (($contents = $parser->generateScriptContents()) !== null) {
            $scriptFileName = $this->cacheManager->getScriptPath($path);
            $this->cacheManager->writeScriptFile($path, $contents);
        }

        if (($contents = $parser->generateStyleContents()) !== null) {
            $styleFileName = $this->cacheManager->getStylePath($path);
            $this->cacheManager->writeStyleFile($path, $contents);
        }

        if (($contents = $parser->generateGlobalStyleContents()) !== null) {
            $globalStyleFileName = $this->cacheManager->getGlobalStylePath($path);
            $this->cacheManager->writeGlobalStyleFile($path, $contents);
        }

        $this->cacheManager->writeViewFile($path, $parser->generateViewContents());
        $this->cacheManager->writeClassFile($path, $parser->generateClassContents(
            $viewFileName,
            $placeholderFileName,
            $scriptFileName,
            $styleFileName,
            $globalStyleFileName,
        ));
    }
}
