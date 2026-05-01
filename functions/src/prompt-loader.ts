import { readFileSync } from "fs";
import { join } from "path";

const PROMPTS_DIR = join(__dirname, "..", "prompts");

export function loadPrompt(name: string): string {
    return readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8");
}

export function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value.trim();
}
