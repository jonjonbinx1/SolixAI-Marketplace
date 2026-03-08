/**
 * Trello Tool — SolixAI Marketplace
 * Contributor: solix
 *
 * Minimal Trello tool for listing and modifying boards, lists and cards.
 * Reads ~/.solix/config.json for API key/token under toolConfig['solix/trello']
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function readSolixToolConfig() {
  try {
    const cfgPath = join(homedir(), '.solix', 'config.json');
    const raw = readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed?.toolConfig?.['solix/trello'] ?? {};
  } catch (e) {
    console.warn('[trello] could not read ~/.solix/config.json:', e.message);
    return {};
  }
}

function assertAllowed(config, operation) {
  const allowed = config?.allowedOperations ?? [];
  if (!allowed.includes(operation)) {
    throw new Error(`Operation "${operation}" is not enabled in the Trello tool config.`);
  }
}

async function ensureClient(context = {}) {
  const ctx = context ?? {};
  // Accept an injected client or factory
  try {
    const direct = ctx.trelloClient ?? ctx.trello ?? ctx.client ?? ctx.toolClient;
    if (direct) {
      if (typeof direct === 'function') {
        try {
          const c = direct();
          if (c && typeof c.then === 'function') return await c;
          if (c) return c;
        } catch (_) {}
      } else {
        return direct;
      }
    }
  } catch (_) {}

  const cfg = readSolixToolConfig();
  const key = cfg.apiKey ?? cfg.key ?? process.env.TRELLO_API_KEY;
  const token = cfg.token ?? process.env.TRELLO_TOKEN;
  if (key && token) return new RestTrelloClient(key, token, cfg.baseUrl);

  // try reading a global block if provided by host
  try {
    const globalCfg = (typeof ctx.readGlobalTrelloConfig === 'function') ? await ctx.readGlobalTrelloConfig() : null;
    if (globalCfg) {
      const k = globalCfg.apiKey ?? globalCfg.key;
      const t = globalCfg.token;
      if (k && t) return new RestTrelloClient(k, t, globalCfg.baseUrl);
    }
  } catch (_) {}

  throw new Error('No Trello client provided and no API key/token found in config or environment.');
}

class RestTrelloClient {
  constructor(apiKey, token, baseUrl = 'https://api.trello.com/1') {
    if (!apiKey || !token) throw new Error('RestTrelloClient requires apiKey and token');
    this.key = apiKey;
    this.token = token;
    this.baseUrl = (baseUrl || 'https://api.trello.com/1').replace(/\/$/, '');
  }

  async _getFetch() {
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    try {
      const mod = await import('node-fetch');
      return (mod.default ?? mod);
    } catch (e) {
      throw new Error('No fetch available (install node-fetch or use Node 18+).');
    }
  }

  async _fetch(path, { method = 'GET', params = {}, body = null, headers = {} } = {}) {
    const fetchFn = await this._getFetch();
    const rawUrl = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const q = Object.assign({}, params, { key: this.key, token: this.token });
    const qs = Object.keys(q).length ? `?${Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? '' : String(v))}`).join('&')}` : '';
    const url = `${rawUrl}${qs}`;
    const opts = { method, headers };
    if (body != null) {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    try {
      if (typeof process !== 'undefined' && process.env && process.env.SOLIX_DEBUG_PROVIDER_RAW === '1') {
        const safeHeaders = Object.assign({}, headers);
        if (safeHeaders.Authorization) safeHeaders.Authorization = '<REDACTED>';
        let dbgBody = opts.body;
        if (dbgBody && typeof dbgBody !== 'string') {
          try { dbgBody = JSON.stringify(dbgBody, null, 2); } catch (_) { dbgBody = String(dbgBody); }
        }
        console.debug('[trello] OUTGOING', method, url, 'headers:', safeHeaders, 'body:', dbgBody);
      }
    } catch (e) {}

    const res = await fetchFn(url, opts);
    let text;
    try { text = await res.text(); } catch (e) { text = ''; }
    const ctype = (res.headers && typeof res.headers.get === 'function') ? res.headers.get('content-type') : (res.headers && res.headers['content-type']) || '';
    let data = null;
    if (ctype && ctype.includes('application/json')) {
      try { data = JSON.parse(text); } catch (e) { data = text; }
    } else {
      data = text;
    }
    if (!res.ok) {
      const msg = (data && data.message) ? `${data.message}` : text || res.statusText;
      const err = new Error(`Trello API ${res.status} ${res.statusText}: ${msg}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  async getBoards(memberId = 'me', params = {}) {
    return await this._fetch(`/members/${encodeURIComponent(memberId)}/boards`, { method: 'GET', params });
  }

  async getBoard(boardId, params = {}) {
    return await this._fetch(`/boards/${encodeURIComponent(boardId)}`, { method: 'GET', params });
  }

  async getListsOnBoard(boardId, params = {}) {
    return await this._fetch(`/boards/${encodeURIComponent(boardId)}/lists`, { method: 'GET', params });
  }

  async getCardsOnBoard(boardId, params = {}) {
    return await this._fetch(`/boards/${encodeURIComponent(boardId)}/cards`, { method: 'GET', params });
  }

  async getCardsOnList(listId, params = {}) {
    return await this._fetch(`/lists/${encodeURIComponent(listId)}/cards`, { method: 'GET', params });
  }

  async createCard({ idList, name, desc, pos, due, idMembers, idLabels, dueComplete } = {}) {
    if (!idList) throw new Error('idList is required to create a card');
    const params = { idList, name, desc, pos, due, idMembers: Array.isArray(idMembers) ? idMembers.join(',') : idMembers, idLabels: Array.isArray(idLabels) ? idLabels.join(',') : idLabels, dueComplete };
    return await this._fetch('/cards', { method: 'POST', params });
  }

  async updateCard(cardId, fields = {}) {
    if (!cardId) throw new Error('cardId is required to update a card');
    return await this._fetch(`/cards/${encodeURIComponent(cardId)}`, { method: 'PUT', params: fields });
  }

  async addComment(cardId, text) {
    if (!cardId) throw new Error('cardId is required to add a comment');
    return await this._fetch(`/cards/${encodeURIComponent(cardId)}/actions/comments`, { method: 'POST', params: { text } });
  }

  async addAttachment(cardId, url, name) {
    if (!cardId) throw new Error('cardId is required to add attachment');
    return await this._fetch(`/cards/${encodeURIComponent(cardId)}/attachments`, { method: 'POST', params: { url, name } });
  }

  async moveCard(cardId, idList) {
    return await this.updateCard(cardId, { idList });
  }

  async search(query, options = {}) {
    const params = Object.assign({ query, modelTypes: 'cards,boards', partial: true }, options);
    return await this._fetch('/search', { method: 'GET', params });
  }

  async getMember(memberId = 'me', params = {}) {
    return await this._fetch(`/members/${encodeURIComponent(memberId)}`, { method: 'GET', params });
  }
}

const toolImpl = {
  name: 'trello',
  version: '1.0.0',
  contributor: 'solix',
  description: 'Interact with Trello boards, lists, and cards.',

  config: [
    {
      key: 'allowedOperations',
      label: 'Allowed Operations',
      type: 'multiselect',
      options: ['read', 'write'],
      default: ['read', 'write'],
      description: 'Which Trello operations are permitted.',
    },
    {
      key: 'defaultBoard',
      label: 'Default Board ID',
      type: 'string',
      default: '',
      description: 'Optional default board id when none provided.',
    },
    {
      key: 'defaultList',
      label: 'Default List ID',
      type: 'string',
      default: '',
      description: 'Optional default list id when none provided.',
    },
  ],

  run: async ({ input, context }) => {
    const fileCfg = readSolixToolConfig();

    const toolKey = 'solix/trello';
    const ctx = context ?? {};
    const candidates = [];
    if (ctx.toolConfig && ctx.toolConfig[toolKey]) candidates.push(ctx.toolConfig[toolKey]);
    if (ctx.config && ctx.config.toolConfig && ctx.config.toolConfig[toolKey]) candidates.push(ctx.config.toolConfig[toolKey]);
    if (ctx.config && typeof ctx.config === 'object') candidates.push(ctx.config);
    if (ctx.toolConfig && typeof ctx.toolConfig === 'object') candidates.push(ctx.toolConfig);

    const uiCfg = Object.assign({}, ...candidates);
    const cfg = { ...fileCfg, ...uiCfg };
    cfg.defaultBoard = cfg.defaultBoard ?? '';
    cfg.defaultList = cfg.defaultList ?? '';

    try {
      if (typeof process !== 'undefined' && process.env && process.env.SOLIX_DEBUG_PROVIDER_RAW === '1') {
        try {
          console.debug('[trello] RAW TOOL INPUT:', JSON.stringify(input, null, 2));
        } catch (e) {
          console.debug('[trello] RAW TOOL INPUT (non-serializable):', input);
        }
      }
    } catch (e) {}

    if (!input || typeof input.action !== 'string') return { ok: false, error: 'action is required' };
    const action = input.action;

    try {
      switch (action) {
        case 'getConfig': {
          return { ok: true, fileCfg, uiCfg, cfg };
        }

        case 'listBoards': {
          assertAllowed(cfg, 'read');
          const client = await ensureClient(context);
          const member = input.memberId ?? 'me';
          const params = {};
          if (input.filter) params.filter = input.filter;
          const boards = await client.getBoards(member, params);
          return { ok: true, total: Array.isArray(boards) ? boards.length : 0, boards };
        }

        case 'getBoard': {
          assertAllowed(cfg, 'read');
          const client = await ensureClient(context);
          const boardId = input.boardId ?? cfg.defaultBoard;
          if (!boardId) throw new Error('boardId is required');
          const board = await client.getBoard(boardId);
          return { ok: true, board };
        }

        case 'listLists': {
          assertAllowed(cfg, 'read');
          const client = await ensureClient(context);
          const boardId = input.boardId ?? cfg.defaultBoard;
          if (!boardId) throw new Error('boardId is required');
          const lists = await client.getListsOnBoard(boardId);
          return { ok: true, total: Array.isArray(lists) ? lists.length : 0, lists };
        }

        case 'listCards': {
          assertAllowed(cfg, 'read');
          const client = await ensureClient(context);
          const listId = input.listId;
          let cards;
          if (listId) cards = await client.getCardsOnList(listId);
          else {
            const boardId = input.boardId ?? cfg.defaultBoard;
            if (!boardId) throw new Error('boardId or listId is required');
            cards = await client.getCardsOnBoard(boardId);
          }
          return { ok: true, total: Array.isArray(cards) ? cards.length : 0, cards };
        }

        case 'createCard': {
          assertAllowed(cfg, 'write');
          const client = await ensureClient(context);
          const payload = Object.assign({}, input);
          const res = await client.createCard(payload);
          const id = res?.id ?? null;
          return { ok: true, card: res, cardId: id };
        }

        case 'updateCard': {
          assertAllowed(cfg, 'write');
          const client = await ensureClient(context);
          const cardId = input.cardId;
          if (!cardId) throw new Error('cardId is required');
          const fields = Object.assign({}, input.fields ?? { name: input.name, desc: input.desc });
          const updated = await client.updateCard(cardId, fields);
          return { ok: true, card: updated };
        }

        case 'moveCard': {
          assertAllowed(cfg, 'write');
          const client = await ensureClient(context);
          const cardId = input.cardId;
          const idList = input.idList ?? input.listId ?? cfg.defaultList;
          if (!cardId || !idList) throw new Error('cardId and idList are required');
          const moved = await client.moveCard(cardId, idList);
          return { ok: true, card: moved };
        }

        case 'addComment': {
          assertAllowed(cfg, 'write');
          const client = await ensureClient(context);
          const cardId = input.cardId;
          const text = input.text ?? input.comment;
          if (!cardId || !text) throw new Error('cardId and text are required');
          const cmt = await client.addComment(cardId, text);
          return { ok: true, comment: cmt };
        }

        case 'addAttachment': {
          assertAllowed(cfg, 'write');
          const client = await ensureClient(context);
          const cardId = input.cardId;
          const url = input.url;
          if (!cardId || !url) throw new Error('cardId and url are required');
          const att = await client.addAttachment(cardId, url, input.name);
          return { ok: true, attachment: att };
        }

        case 'search': {
          assertAllowed(cfg, 'read');
          const client = await ensureClient(context);
          const q = input.query ?? input.q;
          if (!q) throw new Error('query is required');
          const opts = { modelTypes: input.modelTypes ?? 'cards,boards', card_fields: input.card_fields };
          const result = await client.search(q, opts);
          return { ok: true, result };
        }

        case 'getMember': {
          assertAllowed(cfg, 'read');
          const client = await ensureClient(context);
          const memberId = input.memberId ?? 'me';
          const mem = await client.getMember(memberId);
          return { ok: true, member: mem };
        }

        default:
          return { ok: false, error: `Unknown action "${action}". Supported: getConfig, listBoards, getBoard, listLists, listCards, createCard, updateCard, moveCard, addComment, addAttachment, search, getMember` };
      }
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },
};

export const spec = {
  name: 'trello',
  version: '1.0.0',
  requiresBridge: false,
  inputSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['getConfig','listBoards','getBoard','listLists','listCards','createCard','updateCard','moveCard','addComment','addAttachment','search','getMember'] },
      boardId: { type: 'string' },
      listId: { type: 'string' },
      cardId: { type: 'string' },
      idList: { type: 'string' },
      name: { type: 'string' },
      desc: { type: 'string' },
      pos: { type: 'string' },
      due: { type: 'string' },
      idMembers: { type: 'array', items: { type: 'string' } },
      idLabels: { type: 'array', items: { type: 'string' } },
      fields: { type: 'object' },
      query: { type: 'string' },
      q: { type: 'string' },
      url: { type: 'string' },
      text: { type: 'string' },
      memberId: { type: 'string' },
      card_fields: { type: 'string' },
      modelTypes: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['ok'],
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      boards: { type: 'array', items: { type: 'object' } },
      board: { type: 'object' },
      lists: { type: 'array', items: { type: 'object' } },
      cards: { type: 'array', items: { type: 'object' } },
      card: { type: 'object' },
      comment: { type: 'object' },
      attachment: { type: 'object' },
      total: { type: 'number' },
      result: { type: 'object' },
      member: { type: 'object' },
    },
  },
  verify: ['trello.read','trello.write'],
};

export default toolImpl;

export function getTool() { return toolImpl; }
