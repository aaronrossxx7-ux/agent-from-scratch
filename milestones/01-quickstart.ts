import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const model = "claude-sonnet-5-5"
const role = "user"
const content = "What should I search for to find the latest developments in renewable energy?"

const message = await client.messages.create({
    model,
    max_tokens: 1000,
    messages: [
    {
      role,
      content,
    }
  ],
})

// for (const block of message.content){
//     if(block.type === "text"){
//         console.log(block.text)
//     }
// }

console.log(message)