/**
 * Gmail Tool — SolixAI Marketplace
 * Contributor : solix
 * Version     : 1.0.0
 *
 * Integrates with the Gmail REST API (v1) using OAuth 2.0 refresh-token flow.
 * The set of operations the agent may perform is controlled by the
 * `allowedOperations` config key so administrators can enforce least-privilege.
 *
 * Required Google OAuth 2.0 scope list (grant only those you enable):
 *   read / search   → https://www.googleapis.com/auth/gmail.readonly
 *   send / reply    → https://www.googleapis.com/auth/gmail.send
 *   create-draft    → https://www.googleapis.com/auth/gmail.compose
 *   move / label    → https://www.googleapis.com/auth/gmail.modify
 *   delete          → https://www.googleapis.com/auth/gmail.modify
 *   create-template → https://www.googleapis.com/auth/gmail.modify
 */

// ─── helpers ──────────────────────────────────────────────────────────────────

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL  = "https://oauth2.googleapis.com/token";

/** Exchange a refresh token for a fresh access token. */
async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${data.error_description ?? data.error}`);
  return data.access_token;
}

/** Thin authenticated wrapper around fetch for the Gmail REST API. */
async function gmailFetch(accessToken, path, { method = "GET", body } = {}) {
  const url = `${GMAIL_BASE}${path}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  const res = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json();
  if (!res.ok) {
    throw new Error(
      `Gmail API error ${res.status}: ${payload?.error?.message ?? JSON.stringify(payload)}`
    );
  }
  return payload;
}

/** Encode a raw RFC-2822 message string to base64url (required by Gmail API). */
function toBase64Url(str) {
  const b64 = Buffer.from(str).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build a minimal RFC-2822 MIME message string. */
function buildMimeMessage({ to, from, subject, body, replyToMessageId, threadId, cc, bcc }) {
  const lines = [
    `To: ${to}`,
    from ? `From: ${from}` : null,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    replyToMessageId ? `In-Reply-To: ${replyToMessageId}` : null,
    replyToMessageId ? `References: ${replyToMessageId}` : null,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ];
  return lines.filter(Boolean).join("\r\n");
}

/** Decode base64url payload parts from a Gmail message. */
function decodeBase64Url(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

/** Extract a header value from a Gmail message headers array. */
function header(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Extract the plain-text body from a Gmail message. */
function extractBody(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const result = extractBody(part);
    if (result) return result;
  }
  return "";
}

/** Guard: throw if the requested operation is not in allowedOperations. */
function assertAllowed(config, operation) {
  const allowed = config?.allowedOperations ?? [];
  if (!allowed.includes(operation)) {
    throw new Error(
      `Operation "${operation}" is not enabled. ` +
      `Enable it in the Gmail tool's "Allowed Operations" setting.`
    );
  }
}

// ─── default export ────────────────────────────────────────────────────────────

const toolImpl = {
  name: "gmail",
  version: "1.0.0",
  contributor: "solix",
  description: "Read, search, send, organise and template Gmail messages via the Gmail REST API.",

  config: [
    // ── Authentication ──────────────────────────────────────────────────────
    {
      key: "clientId",
      label: "OAuth 2.0 Client ID",
      type: "string",
      placeholder: "your-client-id.apps.googleusercontent.com",
      description:
        "Google OAuth 2.0 Client ID. Create credentials at console.cloud.google.com → APIs & Services → Credentials.",
    },
    {
      key: "clientSecret",
      label: "OAuth 2.0 Client Secret",
      type: "secret",
      placeholder: "GOCSPX-…",
      description: "OAuth 2.0 Client Secret for the above Client ID.",
    },
    {
      key: "refreshToken",
      label: "OAuth 2.0 Refresh Token",
      type: "secret",
      placeholder: "1//0g…",
      description:
        "Long-lived refresh token obtained via the OAuth consent flow. " +
        "Use the Google OAuth Playground (oauth.googleapis.com/oauthplayground) to generate one.",
    },
    {
      key: "userEmail",
      label: "Mailbox Address",
      type: "string",
      placeholder: "you@gmail.com",
      description:
        "The Gmail address to operate on. Use 'me' to always target the authenticated account.",
      default: "me",
    },

    // ── Permission gates ─────────────────────────────────────────────────────
    {
      key: "allowedOperations",
      label: "Allowed Operations",
      type: "multiselect",
      options: [
        "read",
        "search",
        "send",
        "reply",
        "create-draft",
        "move",
        "label",
        "delete",
        "create-template",
        "list-templates",
      ],
      default: ["read", "search"],
      description:
        "Controls which Gmail operations the agent is permitted to perform. " +
        "Operations not listed here will be refused at runtime, even if the OAuth scope allows them.",
    },

    // ── Behaviour ────────────────────────────────────────────────────────────
    {
      key: "maxResults",
      label: "Max Messages per Request",
      type: "number",
      default: 20,
      min: 1,
      max: 500,
      step: 5,
      description: "Maximum number of messages returned by list and search actions.",
    },
    {
      key: "defaultQuery",
      label: "Default List Filter",
      type: "string",
      placeholder: "in:inbox is:unread",
      default: "in:inbox",
      description: "Gmail search query applied when no explicit query is provided to listMessages.",
    },
    {
      key: "templateLabel",
      label: "Template Label Name",
      type: "string",
      default: "SolixTemplates",
      description:
        "Gmail label used to tag messages stored as reusable templates. " +
        "The label will be created automatically if it does not exist.",
    },
    {
      key: "refreshCredentials",
      label: "Refresh credentials",
      type: "action",
      actionLabel: "Re-authenticate",
      actionConfirmText:
        "This will open a browser window to complete OAuth and return a refresh token. Continue?",
      actionCode: `// Runs the local helper to perform an OAuth consent flow and return a refresh token.
import { spawnSync } from 'node:child_process';
// The runtime will execute the tool's configAction when the user confirms.
`,
    },
    {
      key: "trashOnDelete",
      label: "Trash Instead of Permanent Delete",
      type: "boolean",
      default: true,
      description:
        "When true, 'delete' moves messages to Trash rather than permanently expunging them.",
    },
    {
      key: "includeSpamTrash",
      label: "Include Spam & Trash in Search",
      type: "boolean",
      default: false,
      description: "Include Spam and Trash folders when searching messages.",
    },
  ],

  // ── run ─────────────────────────────────────────────────────────────────────

  run: async ({ input, context }) => {
    const cfg = context?.config ?? {};
    const { action } = input;

    // Resolve credentials
    const clientId     = cfg.clientId     ?? input.clientId;
    const clientSecret = cfg.clientSecret ?? input.clientSecret;
    const refreshToken = cfg.refreshToken ?? input.refreshToken;

    if (!clientId || !clientSecret || !refreshToken) {
      return {
        ok: false,
        error:
          "Gmail tool is not configured. " +
          "Set clientId, clientSecret, and refreshToken in the tool settings.",
       };
    }

    let accessToken;
    try {
      accessToken = await getAccessToken({ clientId, clientSecret, refreshToken });
    } catch (err) {
      return { ok: false, error: `Authentication failed: ${err.message}` };
    }

    const call = (path, opts) => gmailFetch(accessToken, path, opts);
    const maxResults = cfg.maxResults ?? 20;

    try {
      switch (action) {

        // ── READ ──────────────────────────────────────────────────────────────

        case "listMessages": {
          assertAllowed(cfg, "read");
          const q       = input.query ?? cfg.defaultQuery ?? "in:inbox";
          const include = cfg.includeSpamTrash ? "&includeSpamTrash=true" : "";
          const data    = await call(
            `/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}${include}`
          );
          const messages = data.messages ?? [];
          // Fetch metadata for each message (parallel, capped)
          const detailed = await Promise.all(
            messages.slice(0, maxResults).map((m) =>
              call(`/messages/${m.id}?format=metadata&metadataHeaders=From,To,Subject,Date`)
            )
          );
          return {
            ok: true,
            total: data.resultSizeEstimate ?? messages.length,
            messages: detailed.map((m) => ({
              id:      m.id,
              threadId: m.threadId,
              from:    header(m.payload?.headers, "From"),
              to:      header(m.payload?.headers, "To"),
              subject: header(m.payload?.headers, "Subject"),
              date:    header(m.payload?.headers, "Date"),
              snippet: m.snippet,
              labelIds: m.labelIds,
            })),
          };
        }

        case "getMessage": {
          assertAllowed(cfg, "read");
          if (!input.messageId) throw new Error("messageId is required.");
          const m = await call(`/messages/${input.messageId}?format=full`);
          return {
            ok: true,
            id:       m.id,
            threadId: m.threadId,
            from:     header(m.payload?.headers, "From"),
            to:       header(m.payload?.headers, "To"),
            subject:  header(m.payload?.headers, "Subject"),
            date:     header(m.payload?.headers, "Date"),
            body:     extractBody(m.payload),
            labelIds: m.labelIds,
            snippet:  m.snippet,
          };
        }

        case "searchMessages": {
          assertAllowed(cfg, "search");
          if (!input.query) throw new Error("query is required.");
          const include = cfg.includeSpamTrash ? "&includeSpamTrash=true" : "";
          const data    = await call(
            `/messages?maxResults=${maxResults}&q=${encodeURIComponent(input.query)}${include}`
          );
          const messages = data.messages ?? [];
          const detailed = await Promise.all(
            messages.slice(0, maxResults).map((m) =>
              call(`/messages/${m.id}?format=metadata&metadataHeaders=From,To,Subject,Date`)
            )
          );
          return {
            ok: true,
            query: input.query,
            total: data.resultSizeEstimate ?? messages.length,
            messages: detailed.map((m) => ({
              id:      m.id,
              threadId: m.threadId,
              from:    header(m.payload?.headers, "From"),
              to:      header(m.payload?.headers, "To"),
              subject: header(m.payload?.headers, "Subject"),
              date:    header(m.payload?.headers, "Date"),
              snippet: m.snippet,
            })),
          };
        }

        // ── SEND / REPLY / DRAFT ─────────────────────────────────────────────

        case "sendMessage": {
          assertAllowed(cfg, "send");
          if (!input.to || !input.subject || !input.body) {
            throw new Error("to, subject, and body are required.");
          }
          const raw = toBase64Url(buildMimeMessage(input));
          const sent = await call("/messages/send", {
            method: "POST",
            body:   { raw },
          });
          return { ok: true, id: sent.id, threadId: sent.threadId, labelIds: sent.labelIds };
        }

        case "replyMessage": {
          assertAllowed(cfg, "reply");
          if (!input.messageId || !input.body) {
            throw new Error("messageId and body are required.");
          }
          // Fetch original to get headers
          const orig = await call(`/messages/${input.messageId}?format=metadata&metadataHeaders=From,To,Subject,Message-ID`);
          const origFrom    = header(orig.payload?.headers, "From");
          const origSubject = header(orig.payload?.headers, "Subject");
          const origMsgId   = header(orig.payload?.headers, "Message-ID");
          const subject     = input.subject ?? (origSubject.startsWith("Re:") ? origSubject : `Re: ${origSubject}`);
          const raw = toBase64Url(buildMimeMessage({
            to:               input.to ?? origFrom,
            subject,
            body:             input.body,
            replyToMessageId: origMsgId,
            cc:               input.cc,
          }));
          const sent = await call("/messages/send", {
            method: "POST",
            body:   { raw, threadId: orig.threadId },
          });
          return { ok: true, id: sent.id, threadId: sent.threadId };
        }

        case "createDraft": {
          assertAllowed(cfg, "create-draft");
          if (!input.to || !input.subject || !input.body) {
            throw new Error("to, subject, and body are required.");
          }
          const raw   = toBase64Url(buildMimeMessage(input));
          const draft = await call("/drafts", {
            method: "POST",
            body:   { message: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) } },
          });
          return { ok: true, draftId: draft.id, messageId: draft.message?.id };
        }

        // ── LABELS ────────────────────────────────────────────────────────────

        case "listLabels": {
          assertAllowed(cfg, "label");
          const data = await call("/labels");
          return {
            ok: true,
            labels: (data.labels ?? []).map((l) => ({
              id:   l.id,
              name: l.name,
              type: l.type,
            })),
          };
        }

        case "createLabel": {
          assertAllowed(cfg, "label");
          if (!input.name) throw new Error("name is required.");
          const label = await call("/labels", {
            method: "POST",
            body:   { name: input.name, labelListVisibility: "labelShow", messageListVisibility: "show" },
          });
          return { ok: true, id: label.id, name: label.name };
        }

        case "addLabel": {
          assertAllowed(cfg, "label");
          if (!input.messageId || !input.labelIds?.length) {
            throw new Error("messageId and labelIds[] are required.");
          }
          await call(`/messages/${input.messageId}/modify`, {
            method: "POST",
            body:   { addLabelIds: input.labelIds },
          });
          return { ok: true, messageId: input.messageId, addedLabels: input.labelIds };
        }

        case "removeLabel": {
          assertAllowed(cfg, "label");
          if (!input.messageId || !input.labelIds?.length) {
            throw new Error("messageId and labelIds[] are required.");
          }
          await call(`/messages/${input.messageId}/modify`, {
            method: "POST",
            body:   { removeLabelIds: input.labelIds },
          });
          return { ok: true, messageId: input.messageId, removedLabels: input.labelIds };
        }

        // ── MOVE ─────────────────────────────────────────────────────────────

        case "moveMessage": {
          assertAllowed(cfg, "move");
          if (!input.messageId) throw new Error("messageId is required.");
          // Gmail 'move' = remove current location label, add destination label
          const addLabels    = input.addLabelIds    ?? [];
          const removeLabels = input.removeLabelIds ?? [];
          if (!addLabels.length && !removeLabels.length) {
            throw new Error("Provide at least one of addLabelIds or removeLabelIds.");
          }
          await call(`/messages/${input.messageId}/modify`, {
            method: "POST",
            body:   { addLabelIds: addLabels, removeLabelIds: removeLabels },
          });
          return { ok: true, messageId: input.messageId, addedLabels: addLabels, removedLabels: removeLabels };
        }

        // ── DELETE ────────────────────────────────────────────────────────────

        case "deleteMessage": {
          assertAllowed(cfg, "delete");
          if (!input.messageId) throw new Error("messageId is required.");
          if (cfg.trashOnDelete !== false) {
            await call(`/messages/${input.messageId}/trash`, { method: "POST" });
            return { ok: true, messageId: input.messageId, action: "trashed" };
          } else {
            await call(`/messages/${input.messageId}`, { method: "DELETE" });
            return { ok: true, messageId: input.messageId, action: "permanently-deleted" };
          }
        }

        // ── TEMPLATES ─────────────────────────────────────────────────────────
        // Templates are stored as Gmail drafts tagged with a configurable label.

        case "createTemplate": {
          assertAllowed(cfg, "create-template");
          if (!input.name || !input.subject || !input.body) {
            throw new Error("name, subject, and body are required.");
          }
          // 1. Ensure template label exists
          const labelName = cfg.templateLabel ?? "SolixTemplates";
          const labelsData = await call("/labels");
          let templateLabel = (labelsData.labels ?? []).find((l) => l.name === labelName);
          if (!templateLabel) {
            templateLabel = await call("/labels", {
              method: "POST",
              body:   { name: labelName, labelListVisibility: "labelHide", messageListVisibility: "hide" },
            });
          }
          // 2. Create draft with template content; embed name in subject prefix
          const raw   = toBase64Url(buildMimeMessage({
            to:      "template@solix.internal",
            subject: `[TPL:${input.name}] ${input.subject}`,
            body:    input.body,
          }));
          const draft = await call("/drafts", {
            method: "POST",
            body:   { message: { raw } },
          });
          // 3. Tag the message with the template label
          await call(`/messages/${draft.message.id}/modify`, {
            method: "POST",
            body:   { addLabelIds: [templateLabel.id] },
          });
          return {
            ok:         true,
            templateId: draft.id,
            messageId:  draft.message?.id,
            name:       input.name,
            subject:    input.subject,
          };
        }

        case "listTemplates": {
          assertAllowed(cfg, "list-templates");
          const labelName  = cfg.templateLabel ?? "SolixTemplates";
          const labelsData = await call("/labels");
          const templateLabel = (labelsData.labels ?? []).find((l) => l.name === labelName);
          if (!templateLabel) {
            return { ok: true, templates: [] };
          }
          const data = await call(
            `/messages?maxResults=${maxResults}&q=${encodeURIComponent(`label:${labelName}`)}&includeSpamTrash=true`
          );
          const messages = data.messages ?? [];
          const detailed = await Promise.all(
            messages.map((m) =>
              call(`/messages/${m.id}?format=metadata&metadataHeaders=Subject,Date`)
            )
          );
          return {
            ok: true,
            templates: detailed.map((m) => {
              const subj = header(m.payload?.headers, "Subject");
              const nameMatch = subj.match(/^\[TPL:(.+?)\]\s*(.*)/);
              return {
                messageId: m.id,
                name:      nameMatch?.[1] ?? subj,
                subject:   nameMatch?.[2] ?? subj,
                date:      header(m.payload?.headers, "Date"),
                snippet:   m.snippet,
              };
            }),
          };
        }

        default:
          return {
            ok:    false,
            error: `Unknown action "${action}". Supported: listMessages, getMessage, searchMessages, ` +
                   `sendMessage, replyMessage, createDraft, listLabels, createLabel, addLabel, ` +
                   `removeLabel, moveMessage, deleteMessage, createTemplate, listTemplates.`,
          };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
  // Called by the runtime when a user confirms a config action button in the UI.
  // IMPORTANT: must return a plain value (not a blocking/pending Promise) so the
  // Electron main process IPC reply settles immediately and the renderer stays
  // responsive. Build the consent URL synchronously and return it; the user
  // opens the URL in their browser, then runs get_refresh_token.js separately.
  async configAction(key, context) {
    console.log('[gmail:configAction] called, key=', key);
    // Dump the context shape so we can identify the correct property path.
    try {
      console.log('[gmail:configAction] context keys:', context ? Object.keys(context) : 'null/undefined');
      console.log('[gmail:configAction] context.config keys:', context?.config ? Object.keys(context.config) : 'n/a');
      console.log('[gmail:configAction] context raw (truncated):', JSON.stringify(context)?.slice(0, 400));
    } catch (e) { /* ignore serialization errors */ }

    if (key !== 'refreshCredentials') {
      throw new Error(`unknown config action "${key}"`);
    }

    // Try every shape the runtime might use to pass config values.
    // shape A: context.config.clientId  (same as run())
    // shape B: context.clientId         (flat on context)
    // shape C: context.settings.clientId
    // shape D: context.toolConfig.clientId
    const cfgA = context?.config ?? {};
    const cfgB = context ?? {};
    const cfgC = context?.settings ?? {};
    const cfgD = context?.toolConfig ?? {};
    const clientId =
      cfgA.clientId ?? cfgB.clientId ?? cfgC.clientId ?? cfgD.clientId ?? null;
    const clientSecret =
      cfgA.clientSecret ?? cfgB.clientSecret ?? cfgC.clientSecret ?? cfgD.clientSecret ?? null;
    const port =
      cfgA.oauthCallbackPort ?? cfgB.oauthCallbackPort ?? 3000;
    const scopes =
      cfgA.scopes ?? cfgB.scopes ??
      'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';

    console.log('[gmail:configAction] clientId present?', !!clientId, 'clientSecret present?', !!clientSecret);

    if (!clientId || !clientSecret) {
      console.warn('[gmail:configAction] missing credentials — returning early');
      return {
        ok: false,
        message: "Set 'clientId' and 'clientSecret' in the Gmail tool config, then click Re-authenticate again.",
      };
    }

    // Build the consent URL synchronously and return it immediately.
    // Never spawn, never start a server here — doing so blocks the Electron
    // main-process IPC handler and freezes the renderer.
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', `http://localhost:${port}/oauth2callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    const authUrl = url.toString();

    console.log('[gmail:configAction] returning authUrl immediately (no server started)');
    return {
      ok: true,
      authUrl,
      message:
        'Open the authUrl in your browser, complete sign-in, then run:\n' +
        `  node ".solix/tools/solix/gmail/get_refresh_token.js"\n` +
        'and paste the printed refresh token into the tool config.',
    };
  },
};

// ─── spec ─────────────────────────────────────────────────────────────────────
/**
 * Interface contract — consumed by the SolixAI runtime for call validation.
 * Schema format: JSON Schema draft-07.
 * @since 1.0.0
 */
export const spec = {
  name: "gmail",
  version: "1.0.0",
  inputSchema: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: [
          "listMessages",
          "getMessage",
          "searchMessages",
          "sendMessage",
          "replyMessage",
          "createDraft",
          "listLabels",
          "createLabel",
          "addLabel",
          "removeLabel",
          "moveMessage",
          "deleteMessage",
          "createTemplate",
          "listTemplates",
        ],
        description: "The Gmail operation to perform.",
      },

      // ── read / search ─────────────────────────────────────────────────────
      query: {
        type: "string",
        description: "Gmail search query string (e.g. 'from:alice is:unread'). Used by listMessages and searchMessages.",
      },
      messageId: {
        type: "string",
        description: "Gmail message ID. Required for getMessage, replyMessage, addLabel, removeLabel, moveMessage, deleteMessage.",
      },

      // ── compose fields ────────────────────────────────────────────────────
      to: {
        type: "string",
        description: "Recipient email address(es). Required for sendMessage, createDraft; optional for replyMessage.",
      },
      cc: { type: "string", description: "CC recipients." },
      bcc: { type: "string", description: "BCC recipients." },
      subject: {
        type: "string",
        description: "Email subject. Required for sendMessage, createDraft, createTemplate.",
      },
      body: {
        type: "string",
        description: "Plain-text message body. Required for sendMessage, replyMessage, createDraft, createTemplate.",
      },
      threadId: {
        type: "string",
        description: "Gmail thread ID. Optionally pass to createDraft to add a draft to an existing thread.",
      },

      // ── label fields ──────────────────────────────────────────────────────
      name: {
        type: "string",
        description: "Label name (createLabel) or template name (createTemplate).",
      },
      labelIds: {
        type: "array",
        items: { type: "string" },
        description: "One or more Gmail label IDs. Required for addLabel and removeLabel.",
      },

      // ── move fields ───────────────────────────────────────────────────────
      addLabelIds: {
        type: "array",
        items: { type: "string" },
        description: "Label IDs to add when moving a message.",
      },
      removeLabelIds: {
        type: "array",
        items: { type: "string" },
        description: "Label IDs to remove when moving a message.",
      },
    },
  },

  outputSchema: {
    type: "object",
    required: ["ok"],
    properties: {
      ok:        { type: "boolean" },
      error:     { type: "string", description: "Present when ok=false." },

      // listMessages / searchMessages
      total:     { type: "number" },
      messages:  { type: "array", items: { type: "object" } },

      // getMessage
      id:        { type: "string" },
      threadId:  { type: "string" },
      from:      { type: "string" },
      to:        { type: "string" },
      subject:   { type: "string" },
      date:      { type: "string" },
      body:      { type: "string" },
      snippet:   { type: "string" },
      labelIds:  { type: "array", items: { type: "string" } },

      // createDraft
      draftId:   { type: "string" },
      messageId: { type: "string" },

      // listLabels / createLabel
      labels:    { type: "array", items: { type: "object" } },

      // moveMessage / addLabel / removeLabel
      addedLabels:   { type: "array", items: { type: "string" } },
      removedLabels: { type: "array", items: { type: "string" } },

      // deleteMessage
      action: { type: "string", enum: ["trashed", "permanently-deleted"] },

      // createTemplate
      templateId: { type: "string" },
      name:       { type: "string" },

      // listTemplates
      templates: { type: "array", items: { type: "object" } },
    },
  },

  verify: ["gmail.listLabels"],
};

export default toolImpl;

// Backwards/alternate compatibility: export a named function that some runtimes
// invoke directly when performing config actions. Delegate to the tool's
// `configAction` method if present.
export async function configAction(key, ...args) {
  if (typeof toolImpl.configAction === "function") {
    return toolImpl.configAction(key, ...args);
  }
  throw new Error("configAction not implemented on gmail tool");
}

// Compatibility helper: some runtimes call `getTool()` to retrieve the tool
// implementation. Export it here so those callers don't fail.
export function getTool() {
  return toolImpl;
}
