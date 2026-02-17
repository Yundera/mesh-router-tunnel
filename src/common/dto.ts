import {WgConfigObject} from "wireguard-tools/dist/types/WgConfigObject.js";

export interface registerSendDTO {
    userId: string,
    vpnPublicKey: string,
    authToken: string, // userId signed by the private key
    clientVersion?: number, // v2+ clients must send this to register with v2 providers
}

export interface registerRecvDTO {
  wgConfig: Partial<WgConfigObject> & { filePath?: string; };
  serverIp: string;
  serverDomain: string;
  domainName: string;
  domain: string;
  /** IP for tunnel route registration (provider's internal gateway IP) */
  routeIp: string;
  /** Port for tunnel route registration (provider's listening port) */
  routePort: number;
}

export interface verifyRecvDTO {
  serverDomain:string;
  domainName:string;
}