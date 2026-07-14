/**
 * Agent registry for `pixroom wrap` (planning/end_product.md §6).
 *
 * Each agent declares how pixroom routes it to the right composition:
 *   - `launch`   — pixroom is the front door: start the pixroom proxy and launch
 *                  the agent with base-URL env vars pointing at it.
 *   - `delegate` — hand the whole flow to the headroom backbone (copilot: its
 *                  subscription-OAuth transport is headroom's, and pixroom's
 *                  lossy optical can't help copilot's models anyway).
 *   - `print`    — IDE extensions that can't be spawned: start the proxy and
 *                  print the config the user pastes in.
 *
 * Env contracts are taken from headroom's verified provider modules
 * (providers/{claude,codex,aider,opencode,mistral_vibe,copilot}).
 */

/** An agent pixroom launches with base-URL env vars pointing at its proxy. */
export interface LaunchAgent {
  readonly kind: 'launch';
  readonly command: string;
  /** Env vars that point the agent at the pixroom proxy (`baseUrl` = http://host:port). */
  env(baseUrl: string): Record<string, string>;
}

/** An agent whose transport pixroom delegates to the headroom backbone. */
export interface DelegateAgent {
  readonly kind: 'delegate';
  readonly to: 'headroom';
  /** headroom `wrap` subcommand (e.g. 'copilot'). */
  readonly subcommand: string;
}

/** An IDE extension pixroom can't spawn — it prints config for the running proxy. */
export interface PrintAgent {
  readonly kind: 'print';
  readonly displayName: string;
  instructions(baseUrl: string): string;
}

export type WrapAgent = LaunchAgent | DelegateAgent | PrintAgent;

export type AgentInterception = 'traffic' | 'delegate' | 'config-only';

export interface AgentDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly interception: AgentInterception;
  readonly protocols: readonly string[];
  readonly adapter: WrapAgent;
}

export class AgentRegistry {
  private readonly descriptors = new Map<string, AgentDescriptor>();

  register(descriptor: AgentDescriptor): this {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(`duplicate agent id: ${descriptor.id}`);
    }
    this.descriptors.set(descriptor.id, descriptor);
    return this;
  }

  get(id: string): AgentDescriptor | undefined {
    return this.descriptors.get(id);
  }

  list(): readonly AgentDescriptor[] {
    return [...this.descriptors.values()];
  }
}

/** OpenAI-compatible clients expect the base URL to include `/v1`. */
const v1 = (base: string): string => `${base}/v1`;

export const WRAP_AGENTS: Record<string, WrapAgent> = {
  // ── Anthropic / OpenAI CLIs pixroom fronts directly ──────────────────────
  claude: {
    kind: 'launch',
    command: 'claude',
    env: (b) => ({ ANTHROPIC_BASE_URL: b }),
  },
  codex: {
    kind: 'launch',
    command: 'codex',
    env: (b) => ({ OPENAI_BASE_URL: v1(b) }),
  },
  aider: {
    kind: 'launch',
    command: 'aider',
    env: (b) => ({ OPENAI_API_BASE: v1(b), ANTHROPIC_BASE_URL: b }),
  },
  goose: {
    kind: 'launch',
    command: 'goose',
    env: (b) => ({ OPENAI_BASE_URL: v1(b), ANTHROPIC_BASE_URL: b }),
  },
  openhands: {
    kind: 'launch',
    command: 'openhands',
    env: (b) => ({ OPENAI_BASE_URL: v1(b), ANTHROPIC_BASE_URL: b }),
  },
  opencode: {
    kind: 'launch',
    command: 'opencode',
    env: (b) => ({
      // Native-provider baseURL override (verified against opencode 1.17):
      // points OpenCode's built-in providers at the proxy; the proxy forwards
      // upstream by path (/v1/messages → Anthropic, /v1/chat/completions → OpenAI).
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        provider: {
          anthropic: { options: { baseURL: v1(b) } },
          openai: { options: { baseURL: v1(b) } },
        },
      }),
    }),
  },
  vibe: {
    kind: 'launch',
    command: 'vibe',
    env: (b) => ({
      VIBE_PROVIDERS: JSON.stringify([
        {
          name: 'mistral',
          api_base: v1(b),
          api_key_env_var: 'MISTRAL_API_KEY',
          backend: 'mistral',
        },
      ]),
    }),
  },

  // ── Delegated to the headroom backbone ───────────────────────────────────
  copilot: { kind: 'delegate', to: 'headroom', subcommand: 'copilot' },

  // ── IDE extensions: print config for the running proxy ───────────────────
  cursor: {
    kind: 'print',
    displayName: 'Cursor',
    instructions: (b) =>
      [
        'Cursor → Settings → Models → OpenAI API:',
        `  • Override Base URL: ${v1(b)}`,
        '  • Set any API key (it is forwarded to the upstream).',
        'Keep this proxy running while you use Cursor.',
      ].join('\n'),
  },
  cline: {
    kind: 'print',
    displayName: 'Cline',
    instructions: (b) =>
      [
        'Cline (VS Code) → API Provider = OpenAI Compatible:',
        `  • Base URL: ${v1(b)}`,
        '  • API Key: your upstream key (forwarded as-is).',
        'Keep this proxy running while you use Cline.',
      ].join('\n'),
  },
  continue: {
    kind: 'print',
    displayName: 'Continue',
    instructions: (b) =>
      [
        'Continue (VS Code/JetBrains) → add to your model config:',
        `  "apiBase": "${v1(b)}"`,
        'Keep this proxy running while you use Continue.',
      ].join('\n'),
  },
};

const PROTOCOLS: Record<string, readonly string[]> = {
  claude: ['anthropic.messages'],
  codex: ['openai.responses', 'openai.chat-completions'],
  aider: ['anthropic.messages', 'openai.chat-completions'],
  goose: ['anthropic.messages', 'openai.chat-completions'],
  openhands: ['anthropic.messages', 'openai.chat-completions'],
  opencode: ['anthropic.messages', 'openai.chat-completions', 'openai.responses'],
  vibe: ['openai.chat-completions'],
  copilot: ['delegated-to-headroom'],
  cursor: ['openai-compatible-config'],
  cline: ['openai-compatible-config'],
  continue: ['openai-compatible-config'],
};

function interception(adapter: WrapAgent): AgentInterception {
  if (adapter.kind === 'launch') return 'traffic';
  if (adapter.kind === 'delegate') return 'delegate';
  return 'config-only';
}

function displayName(id: string, adapter: WrapAgent): string {
  if (adapter.kind === 'print') return adapter.displayName;
  if (id === 'copilot') return 'GitHub Copilot';
  if (id === 'opencode') return 'OpenCode';
  if (id === 'openhands') return 'OpenHands';
  return id[0]!.toUpperCase() + id.slice(1);
}

export function createBuiltinAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  for (const [id, adapter] of Object.entries(WRAP_AGENTS)) {
    registry.register({
      id,
      displayName: displayName(id, adapter),
      interception: interception(adapter),
      protocols: PROTOCOLS[id] ?? [],
      adapter,
    });
  }
  return registry;
}

export const BUILTIN_AGENT_REGISTRY = createBuiltinAgentRegistry();

export function knownAgents(registry: AgentRegistry = BUILTIN_AGENT_REGISTRY): string[] {
  return registry.list().map((descriptor) => descriptor.id);
}

export function describeAgents(
  registry: AgentRegistry = BUILTIN_AGENT_REGISTRY,
): readonly AgentDescriptor[] {
  return registry.list();
}
