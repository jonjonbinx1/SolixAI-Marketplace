/**
 * Discord Tool — SolixAI Marketplace
 * Contributor: solix
 *
 * Minimal send/read tool that delegates to the Solix core Discord bridge.
 * Does NOT modify any package.json; relies on the bridge for tokens/config.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function readSolixToolConfig() {
  try {
    const cfgPath = join(homedir(), '.solix', 'config.json');
    const raw = readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed?.toolConfig?.['solix/discord'] ?? {};
  } catch (e) {
    console.warn('[discord] could not read ~/.solix/config.json:', e.message);
    return {};
  }
}

function assertAllowed(config, operation) {
  const allowed = config?.allowedOperations ?? [];
  if (!allowed.includes(operation)) {
    throw new Error(`Operation "${operation}" is not enabled in the Discord tool config.`);
  }
}

async function ensureBridge(context = {}) {
  const ctx = context ?? {};
  // First, attempt to use a bridge / core instance passed via the tool `context`.
  try {
    // Direct candidates which might already be the bridge instance or core module
    const direct = ctx.bridge ?? ctx.bridgeInstance ?? ctx.core ?? ctx.solixCore ?? ctx.toolBridge ?? ctx.globalBridge ?? ctx.client;
    if (direct) {
      // If it's a function that returns the bridge, call it
      if (typeof direct === 'function') {
        try {
          const b = direct();
          if (b && typeof b.then === 'function') return await b;
          if (b) return b;
        } catch (_) {}
      } else {
        return direct;
      }
    }

    // Also allow the context to expose getter functions directly
    const maybeGetters = ['getGlobalBridge', 'getBridge', 'getBridgeInstance', 'startGlobalBridge', 'startBridge'];
    for (const fn of maybeGetters) {
      if (typeof ctx[fn] === 'function') {
        try {
          const b = ctx[fn]();
          if (b && typeof b.then === 'function') return await b;
          if (b) return b;
        } catch (_) {}
      }
    }
  } catch (_) {}
  // Fallback: try reading global Discord config (prefer injected helper if available)
  try {
    let globalCfg = null;
    if (typeof ctx.readGlobalDiscordConfig === 'function') {
      try { globalCfg = await ctx.readGlobalDiscordConfig(); } catch (_) { globalCfg = null; }
    }
    if (!globalCfg) {
      globalCfg = readGlobalDiscordConfig();
    }
    if (globalCfg && globalCfg.botToken) {
      return new RestDiscordBridge(globalCfg.botToken, globalCfg.guildId, globalCfg.baseUrl);
    }
    throw new Error('No bridge found in context and no globalDiscord.botToken configured.');
  } catch (e) {
    throw new Error(
      `No bridge provided in context and no global Discord bot token found. ` +
      `Provide a bridge via the tool context (e.g. context.bridge or context.getGlobalBridge), ` +
      `or configure ~/.solix/config.json with { "globalDiscord": { "botToken": "<token>", "guildId": "<guild>" } }.`
    );
  }
}

async function sendViaBridge(bridge, channelId, content, options = {}) {
  if (typeof bridge.sendDiscordMessage === 'function') {
    return await bridge.sendDiscordMessage(channelId, content, options);
  }
  if (typeof bridge.sendMessage === 'function') {
    return await bridge.sendMessage(channelId, content, options);
  }
  if (typeof bridge.send === 'function') {
    return await bridge.send(channelId, content, options);
  }
  throw new Error('Bridge does not expose a send function.');
}

async function fetchViaBridge(bridge, channelId, opts = {}) {
  if (typeof bridge.fetchDiscordMessages === 'function') return await bridge.fetchDiscordMessages(channelId, opts);
  if (typeof bridge.fetchMessages === 'function') return await bridge.fetchMessages(channelId, opts);
  if (typeof bridge.getMessages === 'function') return await bridge.getMessages(channelId, opts);
  throw new Error('Bridge does not expose a fetch function.');
}

// Read global Discord config block from ~/.solix/config.json synchronously
function readGlobalDiscordConfig() {
  try {
    const cfgPath = join(homedir(), '.solix', 'config.json');
    const raw = readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed?.globalDiscord ?? null;
  } catch (e) {
    return null;
  }
}

// Minimal REST-based Discord bridge wrapper (uses globalThis.fetch or node-fetch)
class RestDiscordBridge {
  constructor(botToken, guildId, baseUrl = 'https://discord.com/api/v10') {
    if (!botToken) throw new Error('RestDiscordBridge requires a bot token');
    this.token = botToken;
    this.guildId = guildId ?? null;
    this.baseUrl = (baseUrl || 'https://discord.com/api/v10').replace(/\/$/, '');
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

  async _fetch(path, { method = 'GET', body = null, headers = {} } = {}) {
    const fetchFn = await this._getFetch();
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const h = Object.assign({}, headers, { Authorization: `Bot ${this.token}` });
    let b = body;
    if (b != null && typeof b === 'object' && !(b instanceof Buffer)) {
      h['Content-Type'] = h['Content-Type'] ?? 'application/json';
      b = JSON.stringify(b);
    }
    try {
      if (typeof process !== 'undefined' && process.env && process.env.SOLIX_DEBUG_PROVIDER_RAW === '1') {
        const safeHeaders = Object.assign({}, h);
        if (safeHeaders.Authorization) safeHeaders.Authorization = '<REDACTED>';
        let dbgBody = b;
        if (dbgBody instanceof Buffer) dbgBody = `<Buffer length=${dbgBody.length}>`;
        else if (typeof dbgBody === 'string') {
          dbgBody = dbgBody.length > 2000 ? dbgBody.slice(0, 2000) + '...[truncated]' : dbgBody;
        } else {
          try { dbgBody = JSON.stringify(dbgBody, null, 2); } catch (e) { dbgBody = String(dbgBody); }
        }
        console.debug('[discord] OUTGOING', method, url, 'headers:', safeHeaders, 'body:', dbgBody);
      }
    } catch (e) {}
    const res = await fetchFn(url, { method, headers: h, body: b });
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
      const err = new Error(`Discord API ${res.status} ${res.statusText}: ${msg}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  async sendDiscordMessage(channelId, content, options = {}) {
    // Allow passing a human-friendly channel name; resolve to ID when needed.
    let target = String(channelId ?? '');
    if (!/^\d+$/.test(target)) {
      try {
        const resolved = await this.resolveChannelByName(target);
        if (resolved) target = resolved;
        else throw new Error(`Could not resolve channel "${target}" to an ID`);
      } catch (e) {
        throw new Error(`Could not resolve channel "${target}" to an ID`);
      }
    }
    const path = `/channels/${target}/messages`;
    let payload = {};

    // Allow passing a full payload object as `content` when options are empty/null
    if (content && typeof content === 'object' && (!options || (typeof options === 'object' && Object.keys(options).length === 0))) {
      payload = content;
    } else {
      // Normalize content to string and enforce Discord limits
      let text = content == null ? '' : String(content);
      if (text.length > 2000) text = text.slice(0, 2000);
      payload.content = text;

      // Map common convenience options to Discord API fields (whitelist only)
      if (options && typeof options === 'object') {
        if (options.replyToId) payload.message_reference = { message_id: String(options.replyToId) };

        const map = {
          tts: 'tts',
          embeds: 'embeds',
          embed: 'embeds',
          allowed_mentions: 'allowed_mentions',
          allowedMentions: 'allowed_mentions',
          components: 'components',
          sticker_ids: 'sticker_ids',
          stickerIds: 'sticker_ids',
          flags: 'flags',
          nonce: 'nonce'
        };

        for (const [k, v] of Object.entries(options)) {
          if (k === 'replyToId') continue;
          const target = map[k];
          if (!target) continue;
          if (target === 'embeds') {
            if (k === 'embed' && v && !Array.isArray(v)) payload.embeds = [v];
            else payload.embeds = v;
          } else {
            payload[target] = v;
          }
        }
      }
    }

    // Attachments/multipart are not supported by this simple REST bridge yet
    if (payload.attachments) throw new Error('Attachments are not supported by RestDiscordBridge (multipart form-data required).');

    return await this._fetch(path, { method: 'POST', body: payload });
  }

  sendMessage(channelId, payload) { return this.sendDiscordMessage(channelId, payload); }
  send(channelId, content, options) { return this.sendDiscordMessage(channelId, content, options); }

  async fetchDiscordMessages(channelId, opts = {}) {
    // Resolve human-friendly channel names to numeric IDs when necessary
    let target = String(channelId ?? '');
    if (!/^\d+$/.test(target)) {
      try {
        const resolved = await this.resolveChannelByName(target);
        if (resolved) target = resolved;
        else throw new Error(`Could not resolve channel "${target}" to an ID`);
      } catch (e) {
        throw new Error(`Could not resolve channel "${target}" to an ID`);
      }
    }

    const params = [];
    if (opts.limit) params.push(`limit=${encodeURIComponent(String(opts.limit))}`);
    if (opts.before) params.push(`before=${encodeURIComponent(String(opts.before))}`);
    if (opts.after) params.push(`after=${encodeURIComponent(String(opts.after))}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    const path = `/channels/${target}/messages${qs}`;
    return await this._fetch(path, { method: 'GET' });
  }
  fetchMessages(channelId, opts) { return this.fetchDiscordMessages(channelId, opts); }
  getMessages(channelId, opts) { return this.fetchDiscordMessages(channelId, opts); }

  async resolveChannelByName(name) {
    if (!name) return null;
    const normalize = (s) => String(s ?? '').toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    const want = normalize(name);

    try {
      const guildIds = this.guildId ? [this.guildId] : null;

      // If a guildId is configured, search there first for a faster, scoped lookup.
      if (guildIds) {
        try {
          const path = `/guilds/${this.guildId}/channels`;
          const channels = await this._fetch(path, { method: 'GET' });
          for (const c of channels) {
            try {
              if (normalize(c.name) === want) return String(c.id);
            } catch (_) {}
          }
        } catch (_) {}
        return null;
      }

      // No configured guild: enumerate guilds the bot is in and search each.
      try {
        const guilds = await this._fetch('/users/@me/guilds', { method: 'GET' });
        if (!Array.isArray(guilds)) return null;
        for (const g of guilds) {
          if (!g || !g.id) continue;
          try {
            const channels = await this._fetch(`/guilds/${g.id}/channels`, { method: 'GET' });
            for (const c of channels) {
              try {
                if (normalize(c.name) === want) return String(c.id);
              } catch (_) {}
            }
          } catch (_) {
            continue;
          }
        }
      } catch (_) {}
    } catch (_) {}
    return null;
  }
}

// helper: return snowflake string or null
async function resolveChannelId(bridgeOrCore, candidate) {
  if (!candidate) return null;
  // strip mention like <#123456> or <@!123>
  const m = String(candidate).match(/^<#!?(\d+)>$/);
  if (m) return m[1];
  if (/^\d+$/.test(candidate)) return candidate; // already an ID

  const normalize = (s) => String(s ?? '').toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  const want = normalize(candidate);

  // If ensureBridge returned a core module, try to get the live bridge instance
  let inst = bridgeOrCore;
  if (!inst?.client && typeof bridgeOrCore?.getGlobalBridge === 'function') {
    try {
      inst = await bridgeOrCore.getGlobalBridge();
    } catch (_) {}
  }

  const client = inst?.client;
  if (client?.channels?.cache) {
    // cached lookup using normalized names
    const found = client.channels.cache.find((c) => normalize(c.name) === want);
    if (found) return String(found.id);
    // try fetching channels from guilds (may be necessary if not cached)
    for (const g of client.guilds.cache.values()) {
      try {
        const channels = await g.channels.fetch();
        const f = channels.find((c) => normalize(c.name) === want);
        if (f) return String(f.id);
      } catch (_) {}
    }
  }

  // If the bridge/core exposes a resolver helper, try it (e.g., RestDiscordBridge.resolveChannelByName)
  try {
    if (typeof (inst?.resolveChannelByName) === 'function') {
      try {
        // Pass the original candidate so bridge can apply its own normalization/search scope.
        const resolved = await inst.resolveChannelByName(String(candidate));
        if (resolved) return String(resolved);
      } catch (_) {}
    }
  } catch (_) {}

  // Fallback: check a channelAgentMap or similar mapping on the bridge/core.
  // Keys may be IDs or names; values may contain IDs as properties.
  try {
    const cam = inst?.channelAgentMap ?? inst?.channelMap ?? inst?.channelsMap;
    if (cam) {
      // If it's a Map-like
      if (typeof cam.entries === 'function') {
        for (const [k, v] of cam.entries()) {
          try {
            const keyStr = normalize(k);
            if (keyStr === want) {
              if (/^\d+$/.test(String(k))) return String(k);
              if (v && (v.id || v.channelId || v.channel?.id)) {
                return String(v.id ?? v.channelId ?? v.channel.id);
              }
            }
          } catch (_) {
            continue;
          }
        }
      } else if (typeof cam === 'object') {
        // Plain object mapping
        for (const [k, v] of Object.entries(cam)) {
          try {
            const keyStr = normalize(k);
            if (keyStr === want) {
              if (/^\d+$/.test(k)) return String(k);
              if (v && (v.id || v.channelId || v.channel?.id)) {
                return String(v.id ?? v.channelId ?? v.channel.id);
              }
            }
          } catch (_) {
            continue;
          }
        }
      }
    }
  } catch (_) {}

  return null;
}

const toolImpl = {
  name: 'discord',
  version: '1.0.0',
  contributor: 'solix',
  description: 'Send and read Discord messages via the Solix Discord bridge.',

  config: [
    {
      key: 'allowedOperations',
      label: 'Allowed Operations',
      type: 'multiselect',
      options: ['send', 'read'],
      default: ['send', 'read'],
      description: 'Which Discord operations are permitted.',
    },
    {
      key: 'defaultChannel',
      label: 'Default Channel ID',
      type: 'string',
      default: '',
      description: 'Optional default channelId when none provided.',
    },
  ],

  run: async ({ input, context }) => {
    const fileCfg = readSolixToolConfig();

    // Accept UI config from several possible context shapes used by different loaders
    const toolKey = 'solix/discord';
    const ctx = context ?? {};
    const candidates = [];
    if (ctx.toolConfig && ctx.toolConfig[toolKey]) candidates.push(ctx.toolConfig[toolKey]);
    if (ctx.config && ctx.config.toolConfig && ctx.config.toolConfig[toolKey]) candidates.push(ctx.config.toolConfig[toolKey]);
    if (ctx.config && typeof ctx.config === 'object') candidates.push(ctx.config);
    if (ctx.toolConfig && typeof ctx.toolConfig === 'object') candidates.push(ctx.toolConfig);

    const uiCfg = Object.assign({}, ...candidates);
    const cfg = { ...fileCfg, ...uiCfg };
    cfg.defaultChannel = cfg.defaultChannel ?? '';

    // Optional: print raw tool input when debugging is enabled.
    // Enable by setting the environment variable: SOLIX_DEBUG_PROVIDER_RAW=1
    try {
      if (typeof process !== 'undefined' && process.env && process.env.SOLIX_DEBUG_PROVIDER_RAW === '1') {
        try {
          console.debug('[discord] RAW TOOL INPUT:', JSON.stringify(input, null, 2));
        } catch (e) {
          console.debug('[discord] RAW TOOL INPUT (non-serializable):', input);
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

        case 'sendMessage': {
          assertAllowed(cfg, 'send');
          const bridge = await ensureBridge(context);
          // Accept a channel name (`channel`) or an ID (`channelId`). Prefer `channel` (UI friendly).
          let channelCandidate = input.channel ?? input.channelId ?? cfg.defaultChannel ?? '';
          if (channelCandidate && !/^\d+$/.test(String(channelCandidate))) {
            const resolved = await resolveChannelId(bridge, channelCandidate);
            if (resolved) {
              channelCandidate = resolved;
            } else if (typeof bridge?.resolveChannelByName === 'function') {
              try {
                const r = await bridge.resolveChannelByName(channelCandidate);
                if (r) channelCandidate = r;
              } catch (_) {}
            }
          }

          // Validate we have a numeric Discord channel ID before sending.
          if (!channelCandidate || !/^\d+$/.test(String(channelCandidate))) {
            throw new Error(`Channel "${String(input.channel ?? input.channelId ?? '')}" could not be resolved to a Discord channel ID`);
          }
          if (!input.content) throw new Error('content is required');

          const options = { ...(input.options ?? {}) };
          if (input.replyToId) options.replyToId = input.replyToId;
          const res = await sendViaBridge(bridge, channelCandidate, input.content, options);
          const messageId = res?.id ?? res?.messageId ?? null;
          return { ok: true, messageId, response: res };
        }

        case 'readMessages': {
          assertAllowed(cfg, 'read');
          const bridge = await ensureBridge(context);

          let channelCandidate = input.channel ?? input.channelId ?? cfg.defaultChannel ?? '';
          if (channelCandidate && !/^\d+$/.test(String(channelCandidate))) {
            const resolved = await resolveChannelId(bridge, channelCandidate);
            if (resolved) {
              channelCandidate = resolved;
            } else if (typeof bridge?.resolveChannelByName === 'function') {
              try {
                const r = await bridge.resolveChannelByName(channelCandidate);
                if (r) channelCandidate = r;
              } catch (_) {}
            }
          }
          if (!channelCandidate || !/^\d+$/.test(String(channelCandidate))) throw new Error(`Channel "${String(input.channel ?? input.channelId ?? '')}" could not be resolved to a Discord channel ID`);

          const opts = { limit: input.limit ?? 50, before: input.before, after: input.after };
          const raw = await fetchViaBridge(bridge, channelCandidate, opts);
          const items = Array.isArray(raw) ? raw : (raw?.messages ?? []);
          const messages = items.map((m) => ({
            id: m.id ?? m.messageId ?? null,
            author: (m.author && (m.author.username ?? m.author.name)) ?? m.author ?? null,
            content: m.content ?? m.text ?? '',
            timestamp: m.timestamp ?? m.ts ?? m.createdAt ?? null,
            raw: m,
          }));
          return { ok: true, channelId: channelCandidate, total: messages.length, messages };
        }

        default:
          return { ok: false, error: `Unknown action "${action}". Supported: sendMessage, readMessages, getConfig` };
      }
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },
};

export const spec = {
  name: 'discord',
  version: '1.0.0',
  requiresBridge: true,
  inputSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['sendMessage', 'readMessages', 'getConfig'] },
      channel: { type: 'string' },
      channelId: { type: 'string' },
      content: { type: 'string' },
      replyToId: { type: 'string' },
      options: { type: 'object' },
      limit: { type: 'number' },
      before: { type: 'string' },
      after: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['ok'],
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      messageId: { type: 'string' },
      response: { type: 'object' },
      messages: { type: 'array', items: { type: 'object' } },
      total: { type: 'number' },
      channelId: { type: 'string' },
    },
  },
  verify: ['discord.send', 'discord.read'],
};

export default toolImpl;

export function getTool() {
  return toolImpl;
}
