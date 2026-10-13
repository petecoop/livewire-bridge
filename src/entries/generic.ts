import { parse } from "@babel/parser";
import MagicString, { Bundle } from "magic-string";

export function transformGenericEntry(script: string, filename = "bridge.tsx") {
    const ast = parse(script, {
        sourceType: "module",
        sourceFilename: filename,
        plugins: ["typescript", "jsx"],
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
    });
    // Hoist complete declarations; import() expressions stay inside run.
    const imports = ast.program.body.filter(statement => statement.type === "ImportDeclaration");
    const original = new MagicString(script, { filename });
    const body = original.clone();
    const bundle = new Bundle({ separator: "\n" });
    for (const statement of imports) {
        bundle.addSource(original.snip(statement.start!, statement.end!));
        body.remove(statement.start!, statement.end!);
    }
    body.prepend("\nexport function run($wire, $js) {\n");
    body.append("\n}\n");
    bundle.addSource(body);
    return { code: bundle.toString(), map: bundle.generateMap({ includeContent: true, hires: true }) };
}

export function createGenericEntryModule(script: string): string {
    return transformGenericEntry(script).code;
}
