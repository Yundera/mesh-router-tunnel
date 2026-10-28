import {exec} from 'child_process';
import {promisify} from 'util';

const execAsync = promisify(exec);

/**
 * Provider firewall, applied from code after wg0 is up (the persisted wg0.conf is reused
 * as is, so its PostUp cannot carry a policy change to existing deployments).
 *
 * Boxes reach nothing through the provider: no box to box, no box to the server's
 * internal networks, no egress with the server's IP. The only traffic allowed into wg0
 * is TCP/443 from the addresses in TUNNEL_FORWARD_FROM (the gateways), masqueraded to
 * the provider's wg0 address so the box answers through the tunnel. The provider's own
 * nginx talks to the peers from this container (OUTPUT/INPUT), so it needs no forwarding.
 *
 * Own chains, flushed and refilled on every start: idempotent.
 */

const FORWARD_PORT = 443;

async function run(cmd: string): Promise<void> {
  await execAsync(cmd);
}

async function tryRun(cmd: string): Promise<boolean> {
  try {
    await execAsync(cmd);
    return true;
  } catch {
    return false;
  }
}

/** Create (or flush) a chain and make sure `parent` jumps to it first. */
async function ownChain(table: string, parent: string, chain: string): Promise<void> {
  if (!await tryRun(`iptables -t ${table} -N ${chain}`)) {
    await run(`iptables -t ${table} -F ${chain}`);
  }
  if (!await tryRun(`iptables -t ${table} -C ${parent} -j ${chain}`)) {
    await run(`iptables -t ${table} -I ${parent} 1 -j ${chain}`);
  }
}

/** Rules the pre-1.4 PostUp added: removed if a live container still carries them. */
async function removeLegacyRules(ipRange: string): Promise<void> {
  const legacy = [
    `iptables -D FORWARD -i wg0 -j ACCEPT`,
    `iptables -D FORWARD -o wg0 -j ACCEPT`,
    `iptables -t nat -D POSTROUTING -s ${ipRange} -o $(ip route | grep default | awk '{print $5}') -j MASQUERADE`,
  ];
  for (const cmd of legacy) {
    while (await tryRun(cmd)) { /* a rule may have been added more than once */ }
  }
}

export function parseForwardFrom(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[0-9.]+(\/\d{1,2})?$/.test(s));
}

export interface GatewayPeer {
  publicKey: string;
  ip: string;
}

/**
 * TUNNEL_GATEWAY_PEERS: gateways on other hosts that reach the boxes through this
 * provider, as `<wireguard public key>@<address in VPN_IP_RANGE>`, comma-separated. Each
 * is pinned as a wg0 peer and allowed to forward like TUNNEL_FORWARD_FROM. Malformed
 * entries are dropped with a warning.
 */
export function parseGatewayPeers(value: string | undefined): GatewayPeer[] {
  const peers: GatewayPeer[] = [];
  for (const entry of (value || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const m = entry.match(/^([A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=)@(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (m) peers.push({publicKey: m[1], ip: m[2]});
    else console.warn(`[gateway-peers] ignored malformed entry '${entry}' (want <public key>@<ip>)`);
  }
  return peers;
}

export async function applyFirewall(ipRange: string, forwardFrom: string[]): Promise<void> {
  await removeLegacyRules(ipRange);

  // FORWARD: return traffic, gateways → wg0 tcp/443, nothing else.
  await ownChain('filter', 'FORWARD', 'MESH_FWD');
  await run(`iptables -A MESH_FWD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`);
  for (const src of forwardFrom) {
    await run(`iptables -A MESH_FWD -s ${src} -o wg0 -p tcp --dport ${FORWARD_PORT} -j ACCEPT`);
  }
  await run(`iptables -A MESH_FWD -j DROP`);
  await run(`iptables -P FORWARD DROP`);

  // NAT: the box only knows the provider's address, so forwarded traffic leaves as it.
  await ownChain('nat', 'POSTROUTING', 'MESH_NAT');
  for (const src of forwardFrom) {
    await run(`iptables -t nat -A MESH_NAT -s ${src} -o wg0 -j MASQUERADE`);
  }

  // INPUT from boxes: replies to the provider's own connections, and the requester's
  // connectivity ping. Nothing else (the API on :3000 and nginx are not for boxes).
  await ownChain('filter', 'INPUT', 'MESH_IN');
  await run(`iptables -A MESH_IN -i wg0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`);
  await run(`iptables -A MESH_IN -i wg0 -p icmp --icmp-type echo-request -j ACCEPT`);
  await run(`iptables -A MESH_IN -i wg0 -j DROP`);

  console.log(`[firewall] applied: box traffic blocked, forward to wg0 tcp/${FORWARD_PORT} from ${forwardFrom.length ? forwardFrom.join(', ') : '(none)'}`);
}
