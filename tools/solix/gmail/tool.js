/**
 * Gmail Tool â€” SolixAI Marketplace
 * Contributor : solix
 * Version     : 2.0.0
 *
 * Reads mail via IMAP and sends via SMTP â€” authenticated with a Gmail App Password.
 * No OAuth credentials or Google Cloud project are required.
 *
 * Prerequisites
 *   1. Enable 2-Step Verification on the Google account.
 *   2. Go to Google Account â†’ Security â†’ "App passwords".
 *   3. Generate a 16-character App Password for "Mail".
 *   4. Enter your Gmail address and that password (without spaces) in the tool config.
 *
 * IMAP : imap.gmail.com : 993 (TLS)
 * SMTP : smtp.gmail.com : 587 (STARTTLS)
 *
 * Required npm packages (see package.json in this directory):
 *   imapflow    â€” IMAP client
 *   nodemailer  â€” SMTP sending + raw message building
 *   mailparser  â€” MIME message parsing
 */

// â”€â”€â”€ static imports (Node built-ins only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Read the solix/gmail tool config directly from ~/.solix/config.json. */
function readSolixToolConfig() {
  try {
    const cfgPath = join(homedir(), '.solix', 'config.json');
    const raw = readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed?.toolConfig?.['solix/gmail'] ?? {};
  } catch (e) {
    console.warn('[gmail] could not read ~/.solix/config.json:', e.message);
    return {};
  }
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

/**
 * Open an ImapFlow client, run the provided callback, then cleanly close it.
 * The client is passed to the callback already logged-in.
 */
async function withImap(cfg, fn) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host:   cfg.imapHost ?? 'imap.gmail.com',
    port:   cfg.imapPort ?? 993,
    secure: true,
    auth: {
      user: cfg.email,
      pass: cfg.appPassword,
    },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Build a nodemailer SMTP transporter using Gmail App Password. */
async function buildTransport(cfg) {
  const nodemailer = await import('nodemailer');
  return nodemailer.createTransport({
    host:   cfg.smtpHost ?? 'smtp.gmail.com',
    port:   cfg.smtpPort ?? 587,
    secure: false,            // STARTTLS
    auth: {
      user: cfg.email,
      pass: cfg.appPassword,
    },
  });
}

/** Parse the plain-text body out of a raw MIME buffer via mailparser. */
async function parseMessage(source) {
  const { simpleParser } = await import('mailparser');
  const parsed = await simpleParser(source);
  return {
    from:    parsed.from?.text    ?? '',
    to:      parsed.to?.text      ?? '',
    cc:      parsed.cc?.text      ?? '',
    subject: parsed.subject       ?? '',
    date:    parsed.date?.toISOString() ?? '',
    body:    parsed.text          ?? parsed.html ?? '',
    messageId: parsed.messageId   ?? '',
    inReplyTo: parsed.inReplyTo   ?? '',
  };
}

// â”€â”€â”€ default export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const toolImpl = {
  name: "gmail",
  version: "2.0.0",
  contributor: "solix",
  description: "Read, search, send and organise Gmail messages via IMAP/SMTP using an App Password.",

  config: [
    // â”€â”€ Authentication â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: "email",
      label: "Gmail Address",
      type: "string",
      placeholder: "you@gmail.com",
      description:
        "Your full Gmail address. Used as the IMAP/SMTP login username and as the From address when sending.",
    },
    {
      key: "appPassword",
      label: "App Password",
      type: "secret",
      placeholder: "xxxx xxxx xxxx xxxx",
      description:
        "16-character Gmail App Password (spaces optional). " +
        "Generate one at myaccount.google.com â†’ Security â†’ App passwords. " +
        "Requires 2-Step Verification to be enabled on the account.",
    },

    // â”€â”€ Server overrides (rarely needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: "imapHost",
      label: "IMAP Host",
      type: "string",
      default: "imap.gmail.com",
      description: "IMAP server hostname. Default: imap.gmail.com",
    },
    {
      key: "imapPort",
      label: "IMAP Port",
      type: "number",
      default: 993,
      description: "IMAP server port (TLS). Default: 993",
    },
    {
      key: "smtpHost",
      label: "SMTP Host",
      type: "string",
      default: "smtp.gmail.com",
      description: "SMTP server hostname. Default: smtp.gmail.com",
    },
    {
      key: "smtpPort",
      label: "SMTP Port",
      type: "number",
      default: 587,
      description: "SMTP server port (STARTTLS). Default: 587",
    },

    // â”€â”€ Permission gates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        "delete",
        "create-template",
        "list-templates",
        "list-mailboxes",
      ],
      default: ["read", "search"],
      description:
        "Controls which Gmail operations the agent is permitted to perform. " +
        "Operations not listed here will be refused at runtime.",
    },

    // â”€â”€ Behaviour â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      key: "maxResults",
      label: "Max Messages per Request",
      type: "number",
      default: 20,
      min: 1,
      max: 200,
      step: 5,
      description: "Maximum number of messages returned by list and search actions.",
    },
    {
      key: "defaultMailbox",
      label: "Default Mailbox",
      type: "string",
      default: "INBOX",
      description: "IMAP mailbox to use when none is specified (e.g. 'INBOX', '[Gmail]/All Mail').",
    },
    {
      key: "trashOnDelete",
      label: "Trash Instead of Permanent Delete",
      type: "boolean",
      default: true,
      description:
        "When true, 'delete' moves messages to [Gmail]/Trash rather than permanently expunging them.",
    },
    {
      key: "templateMailbox",
      label: "Template Mailbox Name",
      type: "string",
      default: "SolixTemplates",
      description:
        "IMAP mailbox (folder) used to store reusable email templates. " +
        "Will be created automatically on first template save if it does not exist.",
    },
  ],

  // â”€â”€ run â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  run: async ({ input, context }) => {
    const uiCfg   = context?.config ?? {};
    const fileCfg = readSolixToolConfig();

    // Merge: file config as baseline; UI config on top.
    // Never let UI overwrite credentials with an empty string.
    const pick = (val, fallback) =>
      (typeof val === 'string' && val.trim() !== '') ? val : fallback;

    const cfg = { ...fileCfg, ...uiCfg };
    cfg.email       = pick(uiCfg.email,       fileCfg.email);
    cfg.appPassword = pick(uiCfg.appPassword, fileCfg.appPassword);
    // Strip spaces from app password (Google allows spaces in the displayed value)
    if (cfg.appPassword) cfg.appPassword = cfg.appPassword.replace(/\s+/g, '');

    if (!cfg.email || !cfg.appPassword) {
      return {
        ok: false,
        error:
          "Gmail tool is not configured. " +
          "Set 'email' and 'appPassword' in the tool settings.",
      };
    }

    const { action } = input;
    const maxResults = cfg.maxResults ?? 20;
    const defaultMailbox = cfg.defaultMailbox ?? 'INBOX';

    try {
      switch (action) {

        // â”€â”€ LIST MESSAGES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        case "listMessages": {
          assertAllowed(cfg, "read");
          const mailbox = input.mailbox ?? defaultMailbox;
          return await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock(mailbox);
            try {
              const messages = [];
              // Fetch the most recent N messages by sequence range
              const total = client.mailbox.exists ?? 0;
              if (total === 0) return { ok: true, total: 0, messages: [] };
              const from = Math.max(1, total - maxResults + 1);
              for await (const msg of client.fetch(`${from}:${total}`, {
                uid: true, flags: true, envelope: true, bodyStructure: false,
              })) {
                messages.push({
                  uid:     msg.uid,
                  seq:     msg.seq,
                  from:    msg.envelope.from?.[0]?.address ?? '',
                  subject: msg.envelope.subject ?? '',
                  date:    msg.envelope.date?.toISOString() ?? '',
                  flags:   [...(msg.flags ?? [])],
                  seen:    msg.flags?.has('\\Seen') ?? false,
                });
              }
              return { ok: true, mailbox, total, messages: messages.reverse() };
            } finally {
              lock.release();
            }
          });
        }

        // â”€â”€ GET MESSAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        case "getMessage": {
          assertAllowed(cfg, "read");
          if (!input.uid) throw new Error("uid is required.");
          const mailbox = input.mailbox ?? defaultMailbox;
          return await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock(mailbox);
            try {
              for await (const msg of client.fetch(
                { uid: input.uid },
                { uid: true, flags: true, envelope: true, source: true },
                { uid: true }
              )) {
                const parsed = await parseMessage(msg.source);
                return {
                  ok:      true,
                  uid:     msg.uid,
                  flags:   [...(msg.flags ?? [])],
                  seen:    msg.flags?.has('\\Seen') ?? false,
                  ...parsed,
                };
              }
              throw new Error(`Message UID ${input.uid} not found in ${mailbox}.`);
            } finally {
              lock.release();
            }
          });
        }

        // â”€â”€ SEARCH MESSAGES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        case "searchMessages": {
          assertAllowed(cfg, "search");
          if (!input.query) throw new Error("query is required.");
          const mailbox = input.mailbox ?? defaultMailbox;
          return await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock(mailbox);
            try {
              // Gmail IMAP supports X-GM-RAW for Gmail-style search strings.
              // Fall back to a basic SUBJECT/TEXT search when not connected to Gmail.
              let criteria;
              try {
                // imapflow search criteria: { xgmRaw: '...' } for Gmail
                criteria = { xgmRaw: input.query };
              } catch {
                criteria = { text: input.query };
              }
              const raw = await client.search(criteria, { uid: true });
              // Normalize
              let uids = [];
              if (Array.isArray(raw)) uids = raw;
              else if (raw instanceof Set) uids = [...raw];
              else if (raw) uids = [raw]; // single UID case

              uids = uids.map(Number);

              const limited = uids.slice(-maxResults).reverse();
              const messages = [];
              if (limited.length > 0) {
                for await (const msg of client.fetch(
                  { uid: limited },
                  { uid: true, flags: true, envelope: true },
                  { uid: true }
                )) {
                  messages.push({
                    uid:     msg.uid,
                    from:    msg.envelope.from?.[0]?.address ?? '',
                    subject: msg.envelope.subject ?? '',
                    date:    msg.envelope.date?.toISOString() ?? '',
                    seen:    msg.flags?.has('\\Seen') ?? false,
                  });
                }
              }
              return { ok: true, query: input.query, mailbox, total: uids.length, messages };
            } finally {
              lock.release();
            }
          });
        }

        // â”€â”€ SEND MESSAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        case "sendMessage": {
          assertAllowed(cfg, "send");
          if (!input.to || !input.subject || !input.body) {
            throw new Error("to, subject, and body are required.");
          }
          const transport = await buildTransport(cfg);
          const info = await transport.sendMail({
            from:    cfg.email,
            to:      input.to,
            cc:      input.cc,
            bcc:     input.bcc,
            subject: input.subject,
            text:    input.body,
          });
          return { ok: true, messageId: info.messageId, response: info.response };
        }

        // â”€â”€ REPLY MESSAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        case "replyMessage": {
          assertAllowed(cfg, "reply");
          if (!input.uid || !input.body) {
            throw new Error("uid and body are required.");
          }
          const mailbox = input.mailbox ?? defaultMailbox;
          // Fetch original to get headers needed for threading
          const original = await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock(mailbox);
            try {
              for await (const msg of client.fetch(
                { uid: input.uid },
                { uid: true, envelope: true, source: true },
                { uid: true }
              )) {
                return await parseMessage(msg.source);
              }
              throw new Error(`Message UID ${input.uid} not found.`);
            } finally {
              lock.release();
            }
          });
          const replySubject = input.subject ??
            (original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`);
          const transport = await buildTransport(cfg);
          const info = await transport.sendMail({
            from:         cfg.email,
            to:           input.to ?? original.from,
            cc:           input.cc,
            subject:      replySubject,
            text:         input.body,
            inReplyTo:    original.messageId,
            references:   original.messageId,
          });
          return { ok: true, messageId: info.messageId, response: info.response };
        }

        // â”€â”€ CREATE DRAFT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        case "createDraft": {
          assertAllowed(cfg, "create-draft");
          if (!input.to || !input.subject || !input.body) {
            throw new Error("to, subject, and body are required.");
          }
          const nodemailer = await import('nodemailer');
          // Build the raw RFC-2822 message without sending it
          const transport = nodemailer.createTransport({ streamTransport: true, newline: 'crlf' });
          const { message } = await transport.sendMail({
            from:    cfg.email,
            to:      input.to,
            cc:      input.cc,
            subject: input.subject,
            text:    input.body,
          });
          const chunks = [];
          await new Promise((resolve, reject) => {
            message.on('data', (c) => chunks.push(c));
            message.on('end', resolve);
            message.on('error', reject);
          });
          const raw = Buffer.concat(chunks);
          // IMAP APPEND to [Gmail]/Drafts
          const draftMailbox = '[Gmail]/Drafts';
          return await withImap(cfg, async (client) => {
            const result = await client.append(draftMailbox, raw, ['\\Draft']);
            return { ok: true, uid: result.uid, mailbox: draftMailbox };
          });
        }

        // â”€â”€ LIST MAILBOXES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        case "listMailboxes": {
          assertAllowed(cfg, "list-mailboxes");
          return await withImap(cfg, async (client) => {
            const list = await client.list();
            return {
              ok: true,
              mailboxes: list.map((m) => ({
                path:        m.path,
                name:        m.name,
                delimiter:   m.delimiter,
                flags:       [...(m.flags ?? [])],
                specialUse:  m.specialUse ?? null,
              })),
            };
          });
        }

        // â”€â”€ MOVE MESSAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        case "moveMessage": {
          assertAllowed(cfg, "move");
          if (!input.uid || !input.destMailbox) {
            throw new Error("uid and destMailbox are required.");
          }
          const srcMailbox = input.mailbox ?? defaultMailbox;
          return await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock(srcMailbox);
            try {
              await client.messageMove({ uid: input.uid }, input.destMailbox, { uid: true });
              return { ok: true, uid: input.uid, from: srcMailbox, to: input.destMailbox };
            } finally {
              lock.release();
            }
          });
        }

        // â”€â”€ DELETE MESSAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        case "deleteMessage": {
          assertAllowed(cfg, "delete");
          if (!input.uid) throw new Error("uid is required.");
          const srcMailbox = input.mailbox ?? defaultMailbox;
          if (cfg.trashOnDelete !== false) {
            return await withImap(cfg, async (client) => {
              const lock = await client.getMailboxLock(srcMailbox);
              try {
                await client.messageMove({ uid: input.uid }, '[Gmail]/Trash', { uid: true });
                return { ok: true, uid: input.uid, action: 'trashed' };
              } finally {
                lock.release();
              }
            });
          } else {
            return await withImap(cfg, async (client) => {
              const lock = await client.getMailboxLock(srcMailbox);
              try {
                await client.messageFlagsAdd({ uid: input.uid }, ['\\Deleted'], { uid: true });
                await client.mailboxClose();
                return { ok: true, uid: input.uid, action: 'permanently-deleted' };
              } finally {
                lock.release();
              }
            });
          }
        }

        // â”€â”€ TEMPLATES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Templates are stored as plain messages in a dedicated IMAP mailbox.
        // A [TPL:name] prefix in the subject is used for identification.

        case "createTemplate": {
          assertAllowed(cfg, "create-template");
          if (!input.name || !input.subject || !input.body) {
            throw new Error("name, subject, and body are required.");
          }
          const tmplMailbox = cfg.templateMailbox ?? 'SolixTemplates';
          const nodemailer = await import('nodemailer');
          const transport = nodemailer.createTransport({ streamTransport: true, newline: 'crlf' });
          const { message } = await transport.sendMail({
            from:    cfg.email,
            to:      'template@solix.internal',
            subject: `[TPL:${input.name}] ${input.subject}`,
            text:    input.body,
          });
          const chunks = [];
          await new Promise((resolve, reject) => {
            message.on('data', (c) => chunks.push(c));
            message.on('end', resolve);
            message.on('error', reject);
          });
          const raw = Buffer.concat(chunks);
          return await withImap(cfg, async (client) => {
            // Create the mailbox if it does not exist
            const exists = await client.mailboxExists(tmplMailbox).catch(() => false);
            if (!exists) await client.mailboxCreate(tmplMailbox);
            const result = await client.append(tmplMailbox, raw);
            return { ok: true, uid: result.uid, mailbox: tmplMailbox, name: input.name, subject: input.subject };
          });
        }

        case "listTemplates": {
          assertAllowed(cfg, "list-templates");
          const tmplMailbox = cfg.templateMailbox ?? 'SolixTemplates';
          return await withImap(cfg, async (client) => {
            const exists = await client.mailboxExists(tmplMailbox).catch(() => false);
            if (!exists) return { ok: true, templates: [] };
            const lock = await client.getMailboxLock(tmplMailbox);
            try {
              const templates = [];
              for await (const msg of client.fetch('1:*', {
                uid: true, envelope: true,
              })) {
                const subj = msg.envelope.subject ?? '';
                const nameMatch = subj.match(/^\[TPL:(.+?)\]\s*(.*)/);
                templates.push({
                  uid:     msg.uid,
                  name:    nameMatch?.[1] ?? subj,
                  subject: nameMatch?.[2] ?? subj,
                  date:    msg.envelope.date?.toISOString() ?? '',
                });
              }
              return { ok: true, templates };
            } finally {
              lock.release();
            }
          });
        }

        default:
          return {
            ok:    false,
            error: `Unknown action "${action}". Supported: listMessages, getMessage, searchMessages, ` +
                   `sendMessage, replyMessage, createDraft, listMailboxes, moveMessage, ` +
                   `deleteMessage, createTemplate, listTemplates.`,
          };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};

// â”€â”€â”€ spec â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const spec = {
  name: "gmail",
  version: "2.0.0",
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
          "listMailboxes",
          "moveMessage",
          "deleteMessage",
          "createTemplate",
          "listTemplates",
        ],
        description: "The Gmail operation to perform.",
      },

      // â”€â”€ mailbox / uid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      mailbox: {
        type: "string",
        description: "IMAP mailbox path to operate on (e.g. 'INBOX', '[Gmail]/Sent Mail'). Defaults to the tool's defaultMailbox setting.",
      },
      uid: {
        type: "number",
        description: "IMAP UID of the target message. Required for getMessage, replyMessage, moveMessage, deleteMessage.",
      },
      destMailbox: {
        type: "string",
        description: "Destination IMAP mailbox path for moveMessage.",
      },

      // â”€â”€ search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      query: {
        type: "string",
        description: "Gmail-style search query (e.g. 'from:alice is:unread') used by searchMessages. Gmail IMAP supports X-GM-RAW extension.",
      },

      // â”€â”€ compose fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      to: {
        type: "string",
        description: "Recipient email address(es). Required for sendMessage and createDraft; optional for replyMessage (defaults to original sender).",
      },
      cc:      { type: "string", description: "CC recipients." },
      bcc:     { type: "string", description: "BCC recipients." },
      subject: {
        type: "string",
        description: "Email subject. Required for sendMessage, createDraft, createTemplate.",
      },
      body: {
        type: "string",
        description: "Plain-text message body. Required for sendMessage, replyMessage, createDraft, createTemplate.",
      },

      // â”€â”€ template fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      name: {
        type: "string",
        description: "Template name used as identifier in createTemplate.",
      },
    },
  },

  outputSchema: {
    type: "object",
    required: ["ok"],
    properties: {
      ok:       { type: "boolean" },
      error:    { type: "string", description: "Present when ok=false." },

      // listMessages / searchMessages
      total:    { type: "number" },
      messages: { type: "array", items: { type: "object" } },
      mailbox:  { type: "string" },

      // getMessage
      uid:      { type: "number" },
      from:     { type: "string" },
      to:       { type: "string" },
      subject:  { type: "string" },
      date:     { type: "string" },
      body:     { type: "string" },
      flags:    { type: "array", items: { type: "string" } },
      seen:     { type: "boolean" },
      messageId: { type: "string" },

      // sendMessage / replyMessage
      response: { type: "string" },

      // listMailboxes
      mailboxes: { type: "array", items: { type: "object" } },

      // moveMessage / deleteMessage
      action: { type: "string" },

      // createTemplate / listTemplates
      name:      { type: "string" },
      templates: { type: "array", items: { type: "object" } },
    },
  },

  verify: ["gmail.listMailboxes"],
};

export default toolImpl;

export function getTool() {
  return toolImpl;
}
