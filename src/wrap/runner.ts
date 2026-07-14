/**
 * `pixroom wrap` runner (planning/end_product.md §6).
 *
 * Dispatches each agent to the right composition:
 *   - launch:   start the pixroom proxy, point the agent at it, spawn it.
 *   - print:    start the proxy and print IDE config (Cursor/Cline/Continue).
 *   - delegate: hand copilot to the headroom backbone (its subscription-OAuth
 *               transport is headroom's; pixroom's lossy optical can't help
 *               copilot's models). pixroom adds preflight + a unified CLI.
 *
 * Ephemeral: only the launched child's env is set — no config files are mutated.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import type { LogLevel } from '../config.js';
import { createProxyServer, type ProxyServer } from '../proxy/server.js';
import {
  BUILTIN_AGENT_REGISTRY,
  knownAgents,
  type AgentRegistry,
  type LaunchAgent,
  type PrintAgent,
} from './agents.js';

export interface WrapOptions {
  readonly agent: string;
  /** Args forwarded to the wrapped agent (everything after `--`). */
  readonly passthrough: string[];
  /** copilot only: use BYOK (API key) instead of the default subscription. */
  readonly byok?: boolean;
  /** copilot only: enable headroom's RTK context tool (writes repo files). Off by default (ephemeral). */
  readonly contextTool?: boolean;
  readonly port?: number;
  readonly verbose?: boolean;
  /** Custom adapter registry for embedders; built-ins by default. */
  readonly registry?: AgentRegistry;
}

/** Run `pixroom wrap`. Resolves to the process exit code. Never throws. */
export async function runWrap(opts: WrapOptions): Promise<number> {
  const registry = opts.registry ?? BUILTIN_AGENT_REGISTRY;
  const spec = registry.get(opts.agent)?.adapter;
  if (spec === undefined) {
    console.error(`unknown agent '${opts.agent}'. Supported: ${knownAgents(registry).join(', ')}.`);
    console.error("For any compatible client, run 'pixroom proxy' and point its base URL at it.");
    return 1;
  }
  switch (spec.kind) {
    case 'launch':
      return runLaunch(spec, opts);
    case 'print':
      return runPrint(spec, opts);
    case 'delegate':
      return runDelegateCopilot(opts);
  }
}

function proxyOverrides(opts: WrapOptions): { port?: number; logLevel?: LogLevel } {
  const o: { port?: number; logLevel?: LogLevel } = {};
  if (opts.port) o.port = opts.port;
  if (opts.verbose) o.logLevel = 'debug';
  return o;
}

async function runLaunch(spec: LaunchAgent, opts: WrapOptions): Promise<number> {
  const server = createProxyServer(proxyOverrides(opts));
  const { host, port } = await server.listen();
  const baseUrl = `http://${host}:${port}`;
  const agentEnv = spec.env(baseUrl);
  server.pixroom.log.info(`wrapping '${opts.agent}': ${Object.keys(agentEnv).join(', ')} → ${baseUrl}`);
  try {
    return await spawnAndWait(spec.command, opts.passthrough, { ...process.env, ...agentEnv });
  } catch (err) {
    console.error(`failed to launch ${spec.command}: ${err instanceof Error ? err.message : String(err)}`);
    return 127;
  } finally {
    await server.close();
  }
}

async function runPrint(spec: PrintAgent, opts: WrapOptions): Promise<number> {
  const server = createProxyServer(proxyOverrides(opts));
  const { host, port } = await server.listen();
  const baseUrl = `http://${host}:${port}`;
  console.log(`\npixroom proxy is running for ${spec.displayName} at ${baseUrl}\n`);
  console.log(spec.instructions(baseUrl));
  console.log('\nLeave this running; press Ctrl-C to stop.\n');
  return waitForSignal(server);
}

// ── Copilot delegation ─────────────────────────────────────────────────────

export interface CopilotPreflight {
  /** Resolved headroom binary, or null if not found. */
  readonly headroomBin: string | null;
  /** Resolved copilot CLI, or null if not found. */
  readonly copilotCli: string | null;
  /** true = a login token was found; false = not found; 'unknown' = can't probe here. */
  readonly tokenFound: boolean | 'unknown';
  /** Model that will be used if the user omits --model. */
  readonly model: string;
}

export function copilotPreflight(): CopilotPreflight {
  return {
    headroomBin: locateHeadroom(),
    copilotCli: which('copilot'),
    tokenFound: probeCopilotToken(),
    model: process.env.PIXROOM_COPILOT_MODEL || 'gpt-4o',
  };
}

async function runDelegateCopilot(opts: WrapOptions): Promise<number> {
  const pf = copilotPreflight();

  if (!pf.headroomBin) {
    console.error(
      'Copilot support delegates to the headroom backbone, but `headroom` was not found.\n' +
        '  Install it (pipx install headroom-ai / pip install headroom-ai) or set\n' +
        '  PIXROOM_HEADROOM_BIN to the binary (e.g. ~/repos-pixroom/.headroom-venv/bin/headroom).',
    );
    return 1;
  }
  if (!pf.copilotCli) {
    console.error(
      'GitHub Copilot CLI not found on PATH.\n  Install it: npm install -g @github/copilot',
    );
    return 1;
  }

  const passthrough = ensureModel(opts.passthrough, pf.model);
  const args = ['wrap', 'copilot'];
  if (!opts.byok) args.push('--subscription');
  // Ephemeral by default: don't let headroom's RTK context tool write repo files
  // (.github/copilot-instructions.md). Opt in with `--context-tool`.
  if (!opts.contextTool) args.push('--no-context-tool');
  if (opts.port) args.push('--port', String(opts.port));
  if (opts.verbose) args.push('-v');
  args.push('--', ...passthrough);

  const mode = opts.byok ? 'BYOK' : 'subscription';
  console.error(
    `pixroom wrap copilot → delegating to headroom (${mode}); model=${modelOf(passthrough)}; headroom=${pf.headroomBin}`,
  );
  console.error(
    "  Copilot compression runs via headroom's semantic engine; savings appear in headroom's dashboard.",
  );

  try {
    return await spawnAndWait(pf.headroomBin, args, process.env);
  } catch (err) {
    console.error(`failed to launch headroom: ${err instanceof Error ? err.message : String(err)}`);
    return 127;
  }
}

// ── process helpers ─────────────────────────────────────────────────────────

/** Spawn a child with inherited stdio, forward signals, resolve with its exit code. */
function spawnAndWait(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child: ChildProcess = spawn(command, args, { stdio: 'inherit', env });
    const forward = (sig: NodeJS.Signals) => {
      if (!child.killed) child.kill(sig);
    };
    const onInt = () => forward('SIGINT');
    const onTerm = () => forward('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    const cleanup = () => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
    };
    child.once('error', (err) => {
      cleanup();
      reject(err);
    });
    child.once('exit', (code, signal) => {
      cleanup();
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function waitForSignal(server: ProxyServer): Promise<number> {
  return new Promise<number>((resolve) => {
    const stop = () => {
      void server.close().then(() => resolve(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

// ── discovery helpers ────────────────────────────────────────────────────────

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(cmd: string): string | null {
  const path = process.env.PATH ?? '';
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const full = join(dir, cmd);
    if (isExecutable(full)) return full;
  }
  return null;
}

function locateHeadroom(): string | null {
  const explicit = process.env.PIXROOM_HEADROOM_BIN;
  if (explicit && isExecutable(explicit)) return explicit;
  const onPath = which('headroom');
  if (onPath) return onPath;
  for (const c of [
    join(homedir(), 'repos-pixroom', '.headroom-venv', 'bin', 'headroom'),
    join(process.cwd(), '.headroom-venv', 'bin', 'headroom'),
    join(homedir(), '.headroom-venv', 'bin', 'headroom'),
  ]) {
    if (isExecutable(c)) return c;
  }
  return null;
}

function probeCopilotToken(): boolean | 'unknown' {
  // Only check the explicit env var. We deliberately do NOT shell out to the OS
  // secret store (e.g. macOS `security find-generic-password`): reading another
  // app's Keychain item can trigger a BLOCKING GUI permission prompt. headroom
  // performs the real Keychain discovery at launch, where a one-time prompt is
  // expected and the user is present to allow it.
  return process.env.GITHUB_COPILOT_TOKEN ? true : 'unknown';
}

function ensureModel(passthrough: string[], model: string): string[] {
  const hasModel =
    passthrough.includes('--model') || passthrough.some((a) => a.startsWith('--model='));
  return hasModel ? passthrough : ['--model', model, ...passthrough];
}

function modelOf(args: string[]): string {
  const i = args.indexOf('--model');
  if (i >= 0 && i + 1 < args.length) return args[i + 1] ?? '(default)';
  const eq = args.find((a) => a.startsWith('--model='));
  return eq ? eq.slice('--model='.length) : '(default)';
}
