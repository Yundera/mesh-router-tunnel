import {updateRequestersFromConfig} from "./requester/Requester.js";
import {startProvider} from "./provider/Provider.js";
import {config, parseProvider} from "./common/EnvConfig.js";
import {parseForwardFrom} from "./provider/Firewall.js";
import {RequesterConfig} from "./requester/RequesterConfig.js";
import {fetchTunnelProviders, withDiscovered} from "./requester/ProviderDiscovery.js";


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
    // Providers on other hosts, listed by the backend (/version tunnelProviders): added to
    // the file's, refreshed every ROUTE_REFRESH_INTERVAL. A backend that can't answer keeps
    // the current list.
    let discovered: string[] = [];
    const effective = () => withDiscovered(rconfig.getConfig(), discovered, config.PROVIDER || '');
    rconfig.watchConfig();// will watch the file for changes
    rconfig.on('configUpdated', async (newConfig) => {
      console.log('Config updated:', newConfig);
      await updateRequestersFromConfig(effective());
    });
    const discover = async () => {
      if (!config.PROVIDER) return;
      let backendUrl: string;
      try {
        backendUrl = parseProvider(config.PROVIDER).backendUrl;
      } catch {
        return;
      }
      const list = await fetchTunnelProviders(backendUrl);
      if (list === null || list.join(' ') === discovered.join(' ')) return;
      console.log(`Tunnel providers from the backend: ${list.length ? list.join(', ') : '(none)'}`);
      discovered = list;
      await updateRequestersFromConfig(effective());
    };
    await updateRequestersFromConfig(effective());
    await discover();
    setInterval(() => discover().catch(console.error), config.ROUTE_REFRESH_INTERVAL * 1000);
  }

})().catch(console.error);