import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";

const MAX_ITERATIONS = 10;

const messageBasics = {
    model: "claude-sonnet-5-5",
    max_tokens: 1000,
    // responded in chinese the first time lol
    system: "always respond in english, briefly explain what you're doing before each tool call"
};

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
    {
        name: "list_files",
        description: "list files in a given directory",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Directory path, e.g. Current Directory or ../Aaron/Repository" },
            },
            required: ["path"],
        },
    },
];

async function main() {

    const messages: Anthropic.MessageParam[] = [
        { role: "user", content: "Find any TypeScript files in this project, do not check inside node_modules/..." },
    ];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await client.messages.create({
            ...messageBasics,
            tools,
            tool_choice: {type: "auto", disable_parallel_tool_use: true},
            messages
        })
        
        const text = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === "text")
            .map((block) => block.text)
            .join("\n");

        switch (response.stop_reason) {
            case "tool_use": {
                const toolUse = response.content.find(
                    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
                )!;

                if (text) console.log(text);
                console.log(`Claude called ${toolUse.name} with ${JSON.stringify(toolUse.input)}`);

                const { path } = toolUse.input as { path: string };
                const files = await fs.readdir(path);

                messages.push(
                    { role: "assistant", content: response.content },
                    {
                        role: "user",
                        content: [{ type: "tool_result", tool_use_id: toolUse.id, content: files.join("\n") }],
                    }
                );
                continue;
            }

            case "max_tokens":
                console.log(text);
                console.warn(`\n[cut off: hit max_tokens (${messageBasics.max_tokens})]`);
                return;

            case "end_turn":
                console.log(text);
                return;

            default:
                console.log(text);
                console.warn(`\n[stopped: unexpected stop_reason "${response.stop_reason}"]`);
                return;
        }
    }

    console.warn(`\n[stopped: hit MAX_ITERATIONS (${MAX_ITERATIONS}) before the model finished]`);
}

await main();
