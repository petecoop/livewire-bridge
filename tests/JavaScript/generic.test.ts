import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import { transformGenericEntry } from "../../src/entries/generic";

describe("generic module imports", () => {
    it("hoists multiline, type-only, side-effect and same-line imports", () => {
        const result = transformGenericEntry(`
// import { fake } from 'not-a-module';
import {
    format,
    type Options,
} from './format';
import type { Wire } from './types';
import './styles.css'; $js('ready', () => format($wire.count));
const text = "import pretend from 'string'";
const load = () => import('./lazy');
`, "example.tsx");
        const ast = parse(result.code, { sourceType: "module", plugins: ["typescript", "jsx"] });
        expect(ast.program.body.map(node => node.type)).toEqual([
            "ImportDeclaration", "ImportDeclaration", "ImportDeclaration", "ExportNamedDeclaration",
        ]);
        expect(result.code).toContain("const load = () => import('./lazy')");
        expect(result.code).toContain("$js('ready', () => format($wire.count))");
        expect(result.map.sources).toEqual(["example.tsx"]);
        expect(result.map.sourcesContent?.[0]).toContain("import './styles.css'");
    });

    it("does not confuse comments or strings with imports", () => {
        const result = transformGenericEntry(`const message = \`\nimport nope from 'nope';\n\`;\n/* import other from 'other'; */`);
        const ast = parse(result.code, { sourceType: "module" });
        expect(ast.program.body).toHaveLength(1);
    });
});
