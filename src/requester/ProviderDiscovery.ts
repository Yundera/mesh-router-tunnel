import {exec as execCallback} from 'child_process';
import {promisify} from 'util';
import {Config} from "./RequesterConfig.js";

const exec = promisify(execCallback);

/**
 * Tunnel providers on other hosts, from the backend's /version (`tunnelProviders`,
 * TUNNEL_PROVIDERS on the backend): the box connects to each of them besides its own
 * PROVIDER, so it stays reachable through every gateway's host.
 */

/** The listed provider URLs, or null when the backend can't tell (keep what runs). */
export async function fetchTunnelProviders(backendUrl: string): Promise<string[] | null> {
  try {
    const {stdout} = await exec(`curl -s -k --max-time 10 ${backendUrl}/router/api/version`);
    const data = JSON.parse(stdout);
    if (typeof data.version !== 'number') return null;
    const list = Array.isArray(data.tunnelProviders) ? data.tunnelProviders : [];
    return list.filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\/[^\s,]+$/.test(u))
      .map((u: string) => u.replace(/\/+$/, ''));
  } catch {
    return null;
  }
}

/**
 * The file's providers plus the discovered ones not already in it, each with the
 * credentials of the box's PROVIDER (`<url>,<userId>,<signature>`). Pure.
 */
export function withDiscovered(base: Config, discovered: string[], providerString: string): Config {
  const credentials = providerString.split(',').slice(1).join(',');
  if (!credentials) return base;
  const have = new Set(base.providers.map(p => p.provider.split(',')[0].replace(/\/+$/, '')));
  const extra = discovered.filter(u => !have.has(u)).map(u => ({provider: `${u},${credentials}`}));
  return {...base, providers: [...base.providers, ...extra]};
}
