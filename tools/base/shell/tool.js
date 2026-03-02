import { exec } from "node:child_process";

export default {
  name: "shell",
  version: "1.2.0",
  contributor: "base",
  description:
    "Run shell commands with allowlist enforcement, dangerous-command blocking, and environment isolation. Returns stdout, stderr, and exit code.",

  config: [
    {
      key: "defaultShell",
      label: "Default Shell",
      type: "string",
      placeholder: "cmd.exe  or  /bin/bash",
      description: "Explicit shell binary to use (e.g. /bin/bash, cmd.exe, pwsh). Leave empty to use the OS default.",
    },
    {
      key: "defaultTimeout",
      label: "Default Timeout (ms)",
      type: "number",
      default: 30000,
      min: 1000,
      max: 600000,
      step: 1000,
      description: "Maximum time in milliseconds a command may run before being killed. Per-call timeout values override this.",
    },
    {
      key: "allowedCommands",
      label: "Allowed Commands (whitelist)",
      type: "textarea",
      placeholder: "echo\nls\ngit\nnpm\npwsh",
      description: "One command prefix per line. Agents may only run commands whose first token matches an entry. Leave empty to allow all commands.",
    },
    {
      key: "confirmDangerous",
      label: "Block Dangerous Commands",
      type: "boolean",
      default: true,
      description: "Reject commands matching destructive patterns (rm, dd, shutdown, mkfs, etc.). Recommended: on.",
    },
    {
      key: "allowedEnvVars",
      label: "Allowed Environment Variables",
      type: "textarea",
      placeholder: "PATH\nHOME\nNODE_ENV",
      description: "Whitelist of environment variable names to pass into commands, one per line. Only PATH is forwarded unless additional entries are listed here.",
    },
    {
      key: "defaultCwd",
      label: "Working Directory",
      type: "string",
      placeholder: "C:\\projects\\myapp  or  /home/user/project",
      description: "Default working directory for commands. Leave empty to use the agent workspace root.",
    },
  ],

  run: async ({ input, context }) => {
    const cfg = context?.config ?? {};
    const {
      command,
      cwd,
      timeout = cfg.defaultTimeout ?? 30_000,
    } = input;

    if (!command || typeof command !== "string") {
      return { ok: false, error: "A non-empty command string is required." };
    }

    // --- parse textarea configs (newline-separated strings → string[]) ---
    const parseLines = (raw) =>
      (typeof raw === "string" ? raw : "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

    // --- allowedCommands whitelist ---
    const allowedCommands = parseLines(cfg.allowedCommands);
    if (allowedCommands.length > 0) {
      const firstToken = command.trim().split(/\s+/)[0];
      if (!allowedCommands.includes(firstToken)) {
        return {
          ok: false,
          error: `Command "${firstToken}" is not in the allowed-commands whitelist.`,
        };
      }
    }

    // --- dangerous-command guard ---
    if (cfg.confirmDangerous !== false) {
      const dangerous = /\b(rm\b|\bdd\b|shutdown|poweroff|reboot|mkfs|format\s|del\s+\/[fFsS]|rd\s+\/[sS])/i;
      if (dangerous.test(command)) {
        return {
          ok: false,
          error:
            'Command matches a dangerous pattern and was blocked. Disable "Block Dangerous Commands" in the tool config to override.',
        };
      }
    }

    // --- build exec options ---
    const execOpts = {
      cwd: cwd || cfg.defaultCwd || process.cwd(),
      timeout,
    };

    if (cfg.defaultShell) {
      execOpts.shell = cfg.defaultShell;
    }

    // --- environment isolation: forward only whitelisted vars ---
    const allowedEnvVars = ["PATH", ...parseLines(cfg.allowedEnvVars)];
    execOpts.env = Object.fromEntries(
      allowedEnvVars
        .filter((k) => Object.prototype.hasOwnProperty.call(process.env, k))
        .map((k) => [k, process.env[k]])
    );

    return new Promise((resolve) => {
      exec(command, execOpts, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          exitCode: error ? error.code ?? 1 : 0,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          ...(error && { error: error.message }),
        });
      });
    });
  },
};

/**
 * Interface contract — consumed by the SolixAI runtime for call validation.
 * Schema format: JSON Schema draft-07.
 * @since 1.1.0
 */
export const spec = {
  name: "shell",
  version: "1.2.0",
  inputSchema: {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string", description: "Shell command string to execute." },
      cwd: { type: "string", description: "Working directory override for this call. Falls back to the configured defaultCwd." },
      timeout: {
        type: "number",
        description: "Execution timeout in milliseconds. Falls back to the configured defaultTimeout (30000).",
        default: 30000,
      },
    },
  },
  outputSchema: {
    type: "object",
    required: ["ok", "exitCode", "stdout", "stderr"],
    properties: {
      ok: { type: "boolean" },
      exitCode: { type: "number" },
      stdout: { type: "string" },
      stderr: { type: "string" },
      error: { type: "string", description: "Present when ok=false." },
    },
  },
  sideEffects: true,
  verify: [],
};
