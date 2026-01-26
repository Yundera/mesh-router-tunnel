import {EventEmitter} from 'events';
import * as os from "node:os";
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import axios from 'axios';
import {VPNManager} from './VPNManager.js';
import {registerRecvDTO, registerSendDTO, verifyRecvDTO} from '../common/dto.js';
import {config} from '../common/EnvConfig.js';

export interface ApiServerConfig {
    authApiUrl?: string,
    announcedDomain: string,
}

const ROOT_DOMAIN = "$root$";

export class ApiServer {
    private vpnManager: VPNManager;

    constructor(vpnManager: VPNManager,private config:ApiServerConfig) {
        this.vpnManager = vpnManager;
    }

    async registerPeer(data: registerSendDTO): Promise<registerRecvDTO> {

        let serverData: verifyRecvDTO;
        if (this.config.authApiUrl) {
            const verifyRet = await axios.get<verifyRecvDTO>(`${this.config.authApiUrl}/${data.userId}/${data.authToken}`);
            serverData = verifyRet.data;
        } else {
            serverData = {
                serverDomain: this.config.announcedDomain,
                domainName: data.userId || ROOT_DOMAIN,
            };
        }
        if (!serverData.serverDomain || !serverData.domainName) {
            if (this.config.authApiUrl) {
                console.error(`Url => ${this.config.authApiUrl}/${data.userId}/${data.authToken}`);
            }
            console.error(serverData);
            throw new Error('Invalid Signature');
        }

        // Add the peer to WireGuard
        const wgconfig = this.vpnManager.registerPeer(data.vpnPublicKey, serverData.domainName);

        let domain;
        if(serverData.domainName === ROOT_DOMAIN) {
            domain = serverData.serverDomain;
        }else {
            domain = `${serverData.domainName}.${serverData.serverDomain}`;
        }

        const result: registerRecvDTO = {
            wgConfig: wgconfig,
            serverIp: this.vpnManager.getServerIp(),
            serverDomain: serverData.serverDomain,
            domainName: serverData.domainName,
            domain: domain,
            routeIp: config.PROVIDER_ROUTE_IP,
            routePort: config.PROVIDER_ROUTE_PORT,
        };

        return result;
    }

    async startProvider() {
        console.log(`Starting provider for ${this.config.announcedDomain}`);
        os.setPriority(os.constants.priority.PRIORITY_LOW);
        EventEmitter.defaultMaxListeners = 2000; // Or any number that suits your application's needs

        const app = express();
        app.use(bodyParser.json());
        app.use(cors());
        const port = 3000;

        // Serve static files
        app.use(express.static('/usr/share/nginx/html-provider/'));

        app.get('/api/ping', async (req, res) => {
            res.send('ok');
        });

        app.get('/api/get_ip/:host', async (req, res) => {
            try {
                const host = req.params.host.replaceAll("-", "."); //all dash are considered as dots
                if (!host.endsWith(this.config.announcedDomain)) {
                    res.status(404).send('Invalid domain');
                    return;
                }

                //remove the . + announced domain
                const subdomain = host.slice(0, -(this.config.announcedDomain.length + 1));
                // takes the right most part of the domain eg aa.bb.cc => cc
                const name = subdomain ? subdomain.split('.').pop() : null;

                if (!name) {
                    //if no name it means it is the root domain and or the API server (this server)
                    const rootIp = this.vpnManager.getIpFromName(ROOT_DOMAIN);
                    if (rootIp) {
                        console.log(`found ip for ${ROOT_DOMAIN}: ${rootIp}`);
                        return res.send(`http://${rootIp}:80`);
                    } else {
                        //in this case is will use the default host in the config server
                        console.log(`name not found for ${host}`);
                        res.status(404).send('Name not found');
                        return;
                    }
                }

                //will be directly used by nginx to proxy the request
                let ip = this.vpnManager.getIpFromName(name);
                if (!ip) {
                    res.status(404).send('IP not found');
                    return;
                }
                console.log(`found ip for ${name} (${subdomain}): ${ip}`)
                const ret = `http://${ip}:80`
                res.send(ret);
            } catch (err) {
                console.error(err);
                res.status(500).send('Internal error');
            }
        });

        app.post('/api/register', async (req, res) => {
            try {
                const data: registerSendDTO = req.body;
                const ret = await this.registerPeer(data);
                res.send(ret);
            } catch (err) {
                console.error(err);
                res.status(500).send('Internal error');
            }
        });

        app.listen(port, () => {
            console.log(`API Server is running at http://localhost:${port}`);
        });
    }

}
