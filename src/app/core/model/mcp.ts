import { Resource } from './types';

/** One server entry of an `.mcp.json` file. */
export type McpConfig = Record<string, unknown>;

/** Transports the inspector offers. */
export const MCP_TRANSPORTS = ['http', 'sse', 'stdio'];

/**
 * Splits a command line into the command and its arguments. Quotes group words and are removed.
 *
 * @param line - For example `npx -y "@scope/server" --port 3000`.
 * @returns The words in order; empty for a blank line.
 */
export function splitCommand(line: string): string[] {
  return (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^(["'])(.*)\1$/, '$2'));
}

/**
 * The fields the app shows for a server entry.
 *
 * @param cfg - Server entry as written in the file.
 * @returns Transport, and in `url` either the URL of a remote server or the command line of a local one.
 */
export function mcpFields(cfg: McpConfig | undefined): { transport: string; url: string } {
  const remote = typeof cfg?.['url'] === 'string';
  const args = Array.isArray(cfg?.['args']) ? (cfg['args'] as unknown[]).map(String) : [];
  const url = remote ? String(cfg!['url']) : [String(cfg?.['command'] ?? ''), ...args].join(' ').trim();
  return { transport: typeof cfg?.['type'] === 'string' ? String(cfg['type']) : remote ? 'http' : 'stdio', url };
}

/**
 * Server entry of a scanned MCP resource, as it was read.
 *
 * @param n - MCP resource. Its `raw` is the one-server document the scan produced.
 * @returns The entry, or null for a resource that is not on disk or cannot be parsed.
 */
function scannedConfig(n: Resource): McpConfig | null {
  if (n.raw === undefined) return null;
  try {
    const servers = (JSON.parse(n.raw) as { mcpServers?: Record<string, McpConfig> }).mcpServers ?? {};
    const cfg = servers[n.name] ?? Object.values(servers)[0];
    return cfg && typeof cfg === 'object' ? cfg : null;
  } catch {
    return null;
  }
}

/**
 * The server entry to write for an MCP resource.
 *
 * @remarks
 * A scanned entry is patched: only the keys behind an edited field are rewritten, so `env`,
 * `headers` and unknown keys survive. An untouched entry is returned exactly as scanned.
 *
 * @param n - MCP resource with pending edits applied.
 * @returns The entry for `mcpServers[n.name]`.
 */
export function mcpConfig(n: Resource): McpConfig {
  const scanned = scannedConfig(n);
  const was = mcpFields(scanned ?? undefined);
  const transport = n.transport ?? was.transport;
  const url = n.url ?? was.url;
  if (scanned && transport === was.transport && url === was.url) return scanned;

  const cfg: McpConfig = { ...(scanned ?? {}) };
  if (transport === 'stdio') {
    const [command = '', ...args] = splitCommand(url);
    delete cfg['url'];
    // "stdio" is the default for an entry with a command, so the key is only kept if it was there.
    if ('type' in cfg) cfg['type'] = 'stdio';
    cfg['command'] = command;
    if (args.length || 'args' in cfg) cfg['args'] = args;
  } else {
    delete cfg['command'];
    delete cfg['args'];
    return { type: transport, url, ...Object.fromEntries(Object.entries(cfg).filter(([k]) => k !== 'type' && k !== 'url')) };
  }
  return cfg;
}

/**
 * The one-server document shown as the source of an MCP resource.
 *
 * @param n - MCP resource with pending edits applied.
 * @returns Lines of JSON in the shape of an `.mcp.json` file.
 */
export function mcpSource(n: Resource): string[] {
  return JSON.stringify({ mcpServers: { [n.name]: mcpConfig(n) } }, null, 2).split('\n');
}
