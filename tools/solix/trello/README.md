# Trello tool — Solix (SolixAI Marketplace)

Minimal Trello integration tool used by Solix agents to read and modify boards, lists and cards.

## Features
- List boards, lists, and cards
- Create, update and move cards
- Add comments and attachments to cards
- Search and retrieve member info

## Requirements
- Node 18+ recommended. If using older Node, install `node-fetch`:

```bash
npm install node-fetch
```

- Trello API key and token (create from Trello developer/app settings).

## Configuration

Preferred: add credentials to `~/.solix/config.json` under `toolConfig['solix/trello']`:

```json
{
  "toolConfig": {
    "solix/trello": {
      "apiKey": "YOUR_API_KEY",
      "token": "YOUR_TOKEN",
      "defaultBoard": "<BOARD_ID>",
      "defaultList": "<LIST_ID>",
      "allowedOperations": ["read", "write"]
    }
  }
}
```

Alternatively set environment variables `TRELLO_API_KEY` and `TRELLO_TOKEN`, or pass credentials via the tool `context`:

```js
const context = { toolConfig: { 'solix/trello': { apiKey: '...', token: '...' } } };
```

## Usage

Import the tool and call `run({ input, context })`. Example (ESM):

```js
import trello from '../../tools/solix/trello/tool.js';

// list boards for the current user (uses configured creds)
const res = await trello.run({ input: { action: 'listBoards' }, context: {} });
console.log(res);

// create a card
const r2 = await trello.run({
  input: { action: 'createCard', idList: '<LIST_ID>', name: 'New card', desc: 'Created by agent' },
  context: {}
});
console.log(r2);
```

You can also call `getTool()` if your loader expects that:

```js
import { getTool } from '../../tools/solix/trello/tool.js';
const tool = getTool();
await tool.run({ input: { action: 'getConfig' }, context: {} });
```

Quick test from shell (one-liner):

```bash
node -e "import('./tools/solix/trello/tool.js').then(m=>m.default.run({input:{action:'getConfig'},context:{}}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>console.error(e)))"
```

## Notes
- The tool attaches `key` and `token` as query parameters to Trello API requests; keep them private.
- If you want per-user OAuth flow, I can add an OAuth helper to the tool (optional).

## Supported actions
- `getConfig`, `listBoards`, `getBoard`, `listLists`, `listCards`, `createCard`, `updateCard`, `moveCard`, `addComment`, `addAttachment`, `search`, `getMember`

## Next steps
- Add tests/examples under `tools/solix/trello/examples` (optional)
- Add OAuth helper for per-user auth (optional)
