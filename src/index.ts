import {updateRequestersFromConfig} from "./requester/Requester.js";
import {startProvider} from "./provider/Provider.js";
import {config} from "./common/EnvConfig.js";
import {parseForwardFrom} from "./provider/Firewall.js";
import {RequesterConfig} from "./requester/RequesterConfig.js";


(async () => {
  console.log(`version ${process.env.BUILD_VERSION}`);

  if (config.PROVIDER_ANNONCE_DOMAIN) {
    //start a provider
    await startProvider({
      announcedDomain: config.PROVIDER_ANNONCE_DOMAIN,
      authApiUrl: config.AUTH_API_URL,
      VPNPort: config.VPN_PORT,
      VPNEndPointAnnounce: config.VPN_ENDPOINT_ANNOUNCE,
      VPNIpRange:config.VPN_IP_RANGE,
      VPNForwardFrom: parseForwardFrom(config.TUNNEL_FORWARD_FROM),
    });

  } else {

    const rconfig = RequesterConfig.getInstance();
    // will create the file if it doesn't exist based on the env if a config file is already present the env will be ignored
    rconfig.ensureDefaultConfig({
      providers: [{
        provider: config.PROVIDER,
      }],
    });
    rconfig.watchConfig();// will watch the file for changes
    rconfig.on('configUpdated', async (newConfig) => {
      console.log('Config updated:', newConfig);
      await updateRequestersFromConfig(rconfig.getConfig());
    });
    await updateRequestersFromConfig(rconfig.getConfig());
  }

})().catch(console.error);