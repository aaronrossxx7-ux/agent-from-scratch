import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

const MAX_ITERATIONS = 10;
const SANDBOX_ROOT = path.resolve(import.meta.dirname, "sandbox");
const MAX_READ_CHARS = 20_000;
const MAX_SEARCH_RESULTS = 50;

const messageBasics = {
    model: "claude-sonnet-5-5",
    max_tokens: 1000,
    // responded in chinese the first time lol
    system: "always respond in english, briefly explain what you're doing before each tool call",
};

const client = new Anthropic();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const tools: Anthropic.Tool[] = [
    {
        name: "list_files",
        description: "Lists the files and folders inside a directory in the sandbox. Use this to see what exists before reading or writing a file.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: 'Directory path relative to the sandbox root. Use "." for the root, or a subfolder like "notes".' },
            },
            required: ["path"],
        },
    },
    {
        name: "read_files",
        description: "Returns the text contents of one file in the sandbox. Long files are truncated after 20,000 characters.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: 'File path relative to the sandbox root, e.g. "note.txt" or "notes/todo.txt".' },
            },
            required: ["path"],
        },
    },
    {
        name: "write_files",
        description: "Writes text to one file in the sandbox, creating it (and any missing folders) or overwriting it if it exists. The user must approve each write; if they decline, nothing is written.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: 'File path relative to the sandbox root, e.g. "note.txt" or "notes/todo.txt".' },
                content: { type: "string", description: "The full text to write. This replaces the file's existing contents." },
            },
            required: ["path", "content"],
        },
    },
    {
        name: "search",
        description: "Searching for text in files in the sandbox, it will then return what file/files the content was found in",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "A short word or phrase." },
            },
            required: ["query"],
        },
    },
];

function resolvePath(userPath: string): string {
    const resolvedPath = path.resolve(SANDBOX_ROOT, userPath);
    const relativePath = path.relative(SANDBOX_ROOT, resolvedPath);

    if (relativePath === ".." || relativePath.startsWith(".." + path.sep) || path.isAbsolute(relativePath)) {
        throw new Error(`Access denied: "${userPath}" is outside the sandbox. Use a path relative to the sandbox root, e.g. "." or "notes/todo.txt".`);
    }

    return resolvedPath;
}

async function listFiles(path: string): Promise<string> {
    const files = await fs.readdir(path);
    return files.join("\n");
}

async function readFile(resolvedPath: string): Promise<string> {
    const contents = await fs.readFile(resolvedPath, "utf-8");

    if (contents.length > MAX_READ_CHARS) {
        return contents.slice(0, MAX_READ_CHARS) + `\n\n[truncated: file is ${contents.length} characters, showing the first ${MAX_READ_CHARS}]`;
    }

    return contents;
}

async function writeFile(resolvedPath: string, content: string): Promise<string> {
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content, "utf-8");
    return `Wrote ${content.length} characters to ${path.relative(SANDBOX_ROOT, resolvedPath)}`;
}

async function searchFiles(query: string, resolvedDir: string = SANDBOX_ROOT): Promise<string> {
    const entries = await fs.readdir(resolvedDir, { recursive: true, withFileTypes: true });
    const needle = query.toLowerCase();
    const matches: string[] = [];

    for (const entry of entries) {
        if (!entry.isFile()) continue;

        const filePath = path.join(entry.parentPath, entry.name);
        let contents: string;
        try {
            contents = await fs.readFile(filePath, "utf-8");
        } catch {
            continue;
        }
        // NUL bytes mean a binary file; its "lines" would just be noise.
        if (contents.includes("\0")) continue;

        const lines = contents.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(needle)) {
                matches.push(`${path.relative(SANDBOX_ROOT, filePath)}:${i + 1}: ${lines[i].trim()}`);
                if (matches.length >= MAX_SEARCH_RESULTS) {
                    return matches.join("\n") + `\n\n[stopped after ${MAX_SEARCH_RESULTS} matches; use a more specific query]`;
                }
            }
        }
    }

    return matches.length > 0 ? matches.join("\n") : `No matches for "${query}".`;
}

async function confirm(question: string): Promise<boolean> {
    const answer = await rl.question(`${question} (y/n) `);
    return answer.trim().toLowerCase() === "y";
}

async function runTool(toolUse: Anthropic.ToolUseBlock): Promise<string> {
    switch (toolUse.name) {
        case "list_files": {
            const { path } = toolUse.input as { path: string };
            return await listFiles(resolvePath(path));
        }
        case "read_files": {
            const { path } = toolUse.input as { path: string };
            return await readFile(resolvePath(path));
        }
        case "write_files": {
            const { path, content } = toolUse.input as { path: string; content: string };
            const resolvedPath = resolvePath(path);
            const preview = content.length > 500 ? content.slice(0, 500) + `\n... (${content.length - 500} more characters)` : content;

            const approved = await confirm(
                `\nClaude wants to write to sandbox/${path}:\n` +
                `----------------------------------------\n` +
                `${preview}\n` +
                `----------------------------------------\n` +
                `Are you sure you want to write this content to this file?`
            );

            if (approved) {
                return await writeFile(resolvedPath, content);
            } else {
                throw new Error(`The user declined this write to ${path}. Nothing was written. Do not retry the same write. Ask the user what they'd like to change.`);
            }
        }
        case "search": {
            const { query } = toolUse.input as { query: string };
            return await searchFiles(query);
        }
        default:
            throw new Error(`Unknown tool: ${toolUse.name}`);
    }
}

async function runTurn(messages: Anthropic.MessageParam[]): Promise<void> {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await client.messages.create({
            ...messageBasics,
            tools,
            messages,
        });

        const text = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === "text")
            .map((block) => block.text)
            .join("\n");

        switch (response.stop_reason) {
            case "tool_use": {
                const toolUse = response.content.filter(
                    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
                );

                if (text) console.log(text);

                messages.push({ role: "assistant", content: response.content });

                const toolResults: Anthropic.ToolResultBlockParam[] = [];

                for (const tool of toolUse) {
                    console.log(`Claude called ${tool.name} with ${JSON.stringify(tool.input)}`);

                    try {
                        toolResults.push({
                            content: await runTool(tool),
                            tool_use_id: tool.id,
                            type: "tool_result",
                        });
                    } catch (err) {
                        console.error(`[tool error] ${tool.name}: ${String(err)}`);
                        toolResults.push({
                            content: String(err),
                            tool_use_id: tool.id,
                            type: "tool_result",
                            is_error: true,
                        });
                    }
                }

                messages.push({ role: "user", content: toolResults });
                continue;
            }

            case "max_tokens":
                console.log(text);
                messages.push({ role: "assistant", content: response.content });
                console.warn(`\n[cut off: hit max_tokens (${messageBasics.max_tokens})]`);
                return;

            case "end_turn":
                console.log(text);
                messages.push({ role: "assistant", content: response.content });
                return;

            default:
                console.log(text);
                messages.push({ role: "assistant", content: response.content });
                console.warn(`\n[stopped: unexpected stop_reason "${response.stop_reason}"]`);
                return;
        }
    }

    const lastMessage = messages[messages.length - 1];
    if (Array.isArray(lastMessage.content)) {
        lastMessage.content.push({
            type: "text",
            text: "Step limit reached. Summarize what you found and what's left unfinished.",
        });
    }

    const followUpResponse = await client.messages.create({
        ...messageBasics,
        tools,
        messages,
        tool_choice: { type: "none" },
    });

    const text = followUpResponse.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");

    console.log(text);
    messages.push({ role: "assistant", content: followUpResponse.content })

    console.warn(`\n[stopped: hit MAX_ITERATIONS (${MAX_ITERATIONS}) before the model finished]`);
}

async function main() {
    const messages: Anthropic.MessageParam[] = [];
    const exitCommand: string = "exit";

    while (true) {
        let question: string = "";
        if (messages.length === 0) {
            console.log('Type "exit" to quit');
            question = `What can I help you with today? `;
        } else {
            question = `What can I help you with next? `;
        }

        const answer = await rl.question(question);
        if (answer.trim().toLowerCase() === exitCommand) {
            rl.close();
            return;
        }

        messages.push({ role: "user", content: `${answer}` });
        await runTurn(messages);
    }
}

await main();
