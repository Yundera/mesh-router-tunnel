import {exec as execCallback} from 'child_process';
import {promisify} from 'util';

const exec = promisify(execCallback);

/**
 * Inbound filter on this box's WireGuard interface: only the tunnel's own ports (80 for
 * the provider's HTTP path, 443 for the routed tunnel) and replies. The provider already
 * blocks peer-to-peer traffic; this keeps the box closed if a provider does not.
 * One chain per interface, flushed and refilled on every (re)start.
 */
export async function protectWgInterface(interfaceName: string): Promise<void> {
  const chain = `MESH_${interfaceName}`.slice(0, 28);
  try {
    try {
      await exec(`iptables -N ${chain}`);
    } catch {
      await exec(`iptables -F ${chain}`);
    }
    await exec(`iptables -A ${chain} -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`);
    await exec(`iptables -A ${chain} -p tcp -m multiport --dports 80,443 -j ACCEPT`);
    await exec(`iptables -A ${chain} -j DROP`);
    try {
      await exec(`iptables -C INPUT -i ${interfaceName} -j ${chain}`);
    } catch {
      await exec(`iptables -I INPUT 1 -i ${interfaceName} -j ${chain}`);
    }
    console.log(`[firewall] ${interfaceName}: inbound limited to tcp 80/443 and replies`);
  } catch (error) {
    console.error(`[firewall] ${interfaceName}: could not apply the inbound filter: ${error.message}`);
  }
}
