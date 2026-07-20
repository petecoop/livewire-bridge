export function createGenericEntryModule(script: string): string {
    const imports: string[] = [];
    const body = script
        .split("\n")
        .filter((line) => {
            if (/^\s*import\s+.+;?\s*$/.test(line)) {
                imports.push(line.trim());
                return false;
            }

            return true;
        })
        .join("\n")
        .trim();

    return `${imports.join("\n")}\n\nexport function run($wire, $js) {\n${body}\n}\n`;
}
