import dotenv from 'dotenv';
dotenv.config();

interface EnvConfig {

    /** [provider] IP range for VPN */
    VPN_IP_RANGE: string;
    /** [provider] API used to verify if the user have righs to register on this server */
    AUTH_API_URL: string;
    /** [provider] Port for VPN */
    VPN_PORT: string;
    /** [provider] VPN endpoint announcement */
    VPN_ENDPOINT_ANNOUNCE: string;
    /** [provider] Provider announcement domain */
    PROVIDER_ANNONCE_DOMAIN: string;

    /** **/

    /** [requester] Routing target host - all traffic will be forwarded to this container */
    ROUTING_TARGET_HOST: string;
    /** [requester] Routing target port */
    ROUTING_TARGET_PORT: string;
    /** [requester]  provider connexion string <url>,<userid>,<secret> */
    PROVIDER: string;

    /** [requester] Backend URL for route registration (v2 API) */
    BACKEND_URL: string;
    /** [requester] Route priority for tunnel routes (default: 2, lower than direct) */
    ROUTE_PRIORITY: number;
    /** [requester] Route refresh interval in seconds (default: 300 = 5 minutes) */
    ROUTE_REFRESH_INTERVAL: number;
    /** [requester] Optional health check HTTP path */
    HEALTH_CHECK_PATH: string;
    /** [requester] Optional health check Host header override */
    HEALTH_CHECK_HOST: string;
}

export interface HealthCheckConfig {
    path: string;
    host?: string;
}

/**
 * Load environment variables into the config object
 */
export const config: EnvConfig = {
    VPN_IP_RANGE: process.env.VPN_IP_RANGE!,
    AUTH_API_URL: process.env.AUTH_API_URL!,
    VPN_PORT: process.env.VPN_PORT,
    VPN_ENDPOINT_ANNOUNCE: process.env.VPN_ENDPOINT_ANNOUNCE!,
    PROVIDER_ANNONCE_DOMAIN: process.env.PROVIDER_ANNONCE_DOMAIN!,
    ROUTING_TARGET_HOST: process.env.ROUTING_TARGET_HOST || "caddy",
    ROUTING_TARGET_PORT: process.env.ROUTING_TARGET_PORT || "80",
    PROVIDER: process.env.PROVIDER!,
    // Route registration config (v2 API)
    BACKEND_URL: process.env.BACKEND_URL || '',
    ROUTE_PRIORITY: parseInt(process.env.ROUTE_PRIORITY || '2', 10),
    ROUTE_REFRESH_INTERVAL: parseInt(process.env.ROUTE_REFRESH_INTERVAL || '300', 10),
    HEALTH_CHECK_PATH: process.env.HEALTH_CHECK_PATH || '',
    HEALTH_CHECK_HOST: process.env.HEALTH_CHECK_HOST || '',
};

/**
 * Build health check config from environment if configured
 */
export function getHealthCheckConfig(): HealthCheckConfig | undefined {
    if (!config.HEALTH_CHECK_PATH) {
        return undefined;
    }

    return {
        path: config.HEALTH_CHECK_PATH,
        ...(config.HEALTH_CHECK_HOST && { host: config.HEALTH_CHECK_HOST }),
    };
}
