import Anthropic from "@anthropic-ai/sdk";
import fs from 'node:fs/promises';

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
    {
        name: "list_files",
        description: "list files in a given directory",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Directory path, e.g. Current Directory or ../Aaron/Repository"}
            },
            required: ["path"]
        }
    }
]

const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "What files are in my current directory"}
]

const response = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 1000,
    tools,
    tool_choice: {type: "auto", disable_parallel_tool_use: true},
    messages
})

if(response.stop_reason !== "tool_use"){
    console.log(response.content)
    process.exit()
}

const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
)

if(!toolUse){
    console.log(response.content)
    process.exit()
}

console.log(`Claude called ${toolUse.name} with ${JSON.stringify(toolUse.input)}`);

const { path } = toolUse.input as {path: string}

const files = await fs.readdir(path)

messages.push(
  { role: "assistant", content: response.content },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUse.id, content: files.join("\n") }]
  }
);

const followup = await client.messages.create({
  model: "claude-sonnet-5-5",
  max_tokens: 1024,
  tools,
  tool_choice: { type: "auto", disable_parallel_tool_use: true },
  messages
});

const finalText = followup.content.find(
  (block): block is Anthropic.TextBlock => block.type === "text"
)!;

console.log(finalText.text);
