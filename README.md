# agent-from-scratch

A tool-calling agent built by hand with the raw Anthropic SDK, without an agent framework. I built it to learn how tool calling actually works.

It's a terminal chat agent that can list, read, search and write files inside `sandbox/`, and it asks for approval before every write.

## Run it

Requires Node 22.18+ and an Anthropic API key.

```sh
npm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
npm start
```

## What's in it

- An agent loop driven by `stop_reason`, with parallel tool calls and an iteration cap
- Tool errors sent back to the model (`is_error`) so it can recover
- Every file path checked against the sandbox in code, not just in the prompt
- Write approval in the terminal, with a preview of the content
- Conversation memory across turns

`milestones/` shows how it was built, from a single API call to the full loop.

## Next steps

- Compact long conversations so they don't outgrow the context window
- Save conversation history between runs
