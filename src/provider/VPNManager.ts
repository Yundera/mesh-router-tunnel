import {IpManager} from '../lib/IpManager.js';
import {exec} from 'child_process';
import {promises as fs} from 'fs';
import {promisify} from 'util';
import path from 'path';
import { PeerMap } from './PeerMap.js';

const execAsync = promisify(exec);

export interface Meta {
  name: string;
}

export interface Peer {
  meta: Meta;
  publicKey: string;
  ip: string;
}

interface WGInterface {
  peers: { endpoint: string; allowedIps: string[]; persistentKeepalive: number; publicKey: string }[];
  wgInterface: { address: string[] }
}

export interface VPNManagerConfig {
  VPNPort?: string;
  VPNEndPointAnnounce?: string;
  VPNIpRange?: string;
  announcedDomain: string;
}

export class VPNManager {
  private ipManager: IpManager;
  private vpnEndpointAnnounce: string;
  private vpnPort: string;
  private ipRange: string;
  private readonly WG_CONFIG_DIR = '/etc/wireguard';
  private readonly WG_CONFIG_PATH: string;
  private peerMap: PeerMap;

  private serverPrivateKey: string = '';
  private serverPublicKey: string = '';
  private serverIp: string;

  constructor() {
    this.WG_CONFIG_PATH = path.join(this.WG_CONFIG_DIR, 'wg0.conf');
  }

  async setup(config: VPNManagerConfig): Promise<void> {
    if (!config.announcedDomain) {
      throw new Error('PROVIDER_ANNONCE_DOMAIN not set');
    }

    this.vpnPort = config.VPNPort || '51820';
    this.ipRange = config.VPNIpRange || '1.0.0.0/24';
    this.vpnEndpointAnnounce = `${(config.VPNEndPointAnnounce || config.announcedDomain)}:${this.vpnPort}`;

    // Reserve default IPs
    this.ipManager = new IpManager(this.ipRange);
    this.serverIp = this.ipRange.replace(/\.0\/\d+$/, '.1');
    this.ipManager.leaseIp(this.serverIp); // host
    const zero = this.ipRange.replace(/\.0\/\d+$/, '.0');
    this.ipManager.leaseIp(zero); // reserved

    console.log(`PROVIDER_ANNONCE_DOMAIN is set to '${config.announcedDomain}'`);

    await this.ensureDirectoryExists();
    await this.setupWireguardConfig();

    // Initialize PeerMap after config file is created
    this.peerMap = new PeerMap(this.WG_CONFIG_PATH);

    // Load and reserve IPs for existing peers
    for (const [, peer] of this.peerMap.getAll()) {
      this.ipManager.leaseIp(peer.ip);
    }

    await this.startWireGuard();
  }

  private async ensureDirectoryExists(): Promise<void> {
    try {
      await fs.access(this.WG_CONFIG_DIR);
    } catch {
      await fs.mkdir(this.WG_CONFIG_DIR, {recursive: true});
    }
  }

  private async setupWireguardConfig(): Promise<void> {
    let existingConfig: string | null = null;

    // Try to read existing config
    try {
      existingConfig = await fs.readFile(this.WG_CONFIG_PATH, 'utf-8');
      console.log('Found existing WireGuard configuration');
    } catch {
      console.log('No existing WireGuard configuration found');
    }

    // Try to extract private key from existing config
    if (existingConfig) {
      const privateKeyMatch = existingConfig.match(/PrivateKey\s*=\s*([^\n]+)/);
      if (privateKeyMatch) {
        this.serverPrivateKey = privateKeyMatch[1].trim();
        const {stdout: publicKey} = await execAsync(`echo "${this.serverPrivateKey}" | wg pubkey`);
        this.serverPublicKey = publicKey.trim();
        console.log('Using existing private key and derived public key');

        // If config exists and has valid keys, we're done
        if (existingConfig.length > 0) {
          console.log(`Using existing config with public key: ${this.serverPublicKey}`);
          return;
        }
      }
    }

    // Generate new keys if we don't have them
    if (!this.serverPrivateKey) {
      const {stdout: privateKey} = await execAsync('wg genkey');
      this.serverPrivateKey = privateKey.trim();

      const {stdout: publicKey} = await execAsync(`echo "${this.serverPrivateKey}" | wg pubkey`);
      this.serverPublicKey = publicKey.trim();
      console.log('Generated new WireGuard key pair');
    }

    // Create new config
    console.log('Creating new WireGuard configuration...');
    const config = `
[Interface]
Address = ${this.serverIp}/${this.ipRange.split('/')[1]}
SaveConfig = true
ListenPort = ${this.vpnPort}
PrivateKey = ${this.serverPrivateKey}

PostUp = iptables -t nat -A POSTROUTING -s ${this.ipRange} -o $(ip route | grep default | awk '{print $5}') -j MASQUERADE; iptables -A INPUT -p udp -m udp --dport ${this.vpnPort} -j ACCEPT; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT;
PostDown = iptables -t nat -D POSTROUTING -s ${this.ipRange} -o $(ip route | grep default | awk '{print $5}') -j MASQUERADE; iptables -D INPUT -p udp -m udp --dport ${this.vpnPort} -j ACCEPT; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT;

# Peers list
`;

    await fs.writeFile(this.WG_CONFIG_PATH, config);
    process.env.SERVER_WG_PUBLIC_KEY = this.serverPublicKey;
    console.log(`Created new config with public key: ${this.serverPublicKey}`);
  }

  private async startWireGuard(): Promise<void> {
    try {
      await execAsync('wg-quick down wg0');
    } catch (err) {
      /* Ignore error */
    }
    await execAsync('wg-quick up wg0');
  }

  private setWgPeer(vpnPublicKey: string, meta: Meta, uniqueIp?: string): string {
    // Check if peer already exists with this name
    if (this.peerMap.has(meta.name)) {
      const existingPeer = this.peerMap.get(meta.name);

      // If same public key, this is an idempotent re-registration - return existing IP
      if (existingPeer.publicKey === vpnPublicKey) {
        console.log(`Peer ${meta.name} re-registered with same key, keeping IP ${existingPeer.ip}`);
        return existingPeer.ip;
      }

      // Different public key (key rotation) - remove old peer first
      console.log(`Peer ${meta.name} key changed, rotating from old key`);
      this.removeWgPeer(meta.name);
    }

    // Assign new IP for new peer or key rotation
    if (!uniqueIp) {
      uniqueIp = this.ipManager.getFreeIp();
    } else {
      this.ipManager.leaseIp(uniqueIp);
    }

    // Add new peer - PeerMap now handles WireGuard interface updates
    this.peerMap.add(meta.name, {meta, publicKey: vpnPublicKey, ip: uniqueIp});

    return uniqueIp;
  }

  private removeWgPeer(name: string) {
    if (!this.peerMap.has(name)) {
      return;
    }

    const peer = this.peerMap.get(name);
    // Release IP
    this.ipManager.releaseIp(peer.ip);

    // Remove from PeerMap - PeerMap now handles WireGuard interface updates
    this.peerMap.delete(name);

    console.log(`Removed peer with name: ${name}`);
  }

  public registerPeer(vpnPublicKey: string, name: string): WGInterface {
    const meta: Meta = {
      name: name,
    }
    const uniqueIp = this.setWgPeer(vpnPublicKey, meta);

    console.log(`Registered peer ${name} with IP ${uniqueIp}`);

    return {
      wgInterface: {
        address: [`${uniqueIp}/32`],
      },
      peers: [
        {
          publicKey: this.serverPublicKey,
          allowedIps: [this.ipRange],
          endpoint: this.vpnEndpointAnnounce,
          persistentKeepalive: 60,
        }]
    };
  }

  public getIpFromName(name: string): string | null {
    try {
      const peer = this.peerMap.get(name);
      return peer ? peer.ip : null;
    } catch (err) {
      return null;
    }
  }

  public getServerIp(): string {
    return this.serverIp;
  }
}