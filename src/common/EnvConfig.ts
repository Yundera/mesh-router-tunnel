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
    /** [provider] Route IP for requesters to register (provider's internal gateway IP) */
    PROVIDER_ROUTE_IP: string;
    /** [provider] Route port for requesters to register (provider's listening port, default: 80) */
    PROVIDER_ROUTE_PORT: number;

    /** **/

    /** [requester] Routing target host - all traffic will be forwarded to this container */
    ROUTING_TARGET_HOST: string;
    /** [requester] Routing target port for HTTPS traffic (default: 443) */
    ROUTING_TARGET_PORT_HTTPS: number;
    /** [requester] Routing target port for HTTP traffic (default: 80) */
    ROUTING_TARGET_PORT_HTTP: number;
    /** [requester] Provider connection string <backend_url>,<userid>,<signature> */
    PROVIDER: string;

    /** [requester] Route priority for tunnel routes (default: 2, lower than direct) */
    ROUTE_PRIORITY: number;
    /** [requester] Route refresh interval in seconds (default: 300 = 5 minutes) */
    ROUTE_REFRESH_INTERVAL: number;
    /** [requester] Optional health check HTTP path */
    HEALTH_CHECK_PATH: string;
    /** [requester] Optional health check Host header override */
    HEALTH_CHECK_HOST: string;
    /** [requester] Provider retry interval in seconds when version check fails (default: 600 = 10 minutes) */
    PROVIDER_RETRY_INTERVAL: number;
}

/**
 * Parsed provider configuration
 */
export interface ProviderConfig {
    backendUrl: string;
    userId: string;
    signature: string;
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
    PROVIDER_ROUTE_IP: process.env.PROVIDER_ROUTE_IP || '',
    PROVIDER_ROUTE_PORT: parseInt(process.env.PROVIDER_ROUTE_PORT || '80', 10),
    ROUTING_TARGET_HOST: process.env.ROUTING_TARGET_HOST || "caddy",
    ROUTING_TARGET_PORT_HTTPS: parseInt(process.env.ROUTING_TARGET_PORT_HTTPS || '443', 10),
    ROUTING_TARGET_PORT_HTTP: parseInt(process.env.ROUTING_TARGET_PORT_HTTP || '80', 10),
    PROVIDER: process.env.PROVIDER!,
    // Route registration config (v2 API)
    ROUTE_PRIORITY: parseInt(process.env.ROUTE_PRIORITY || '2', 10),
    ROUTE_REFRESH_INTERVAL: parseInt(process.env.ROUTE_REFRESH_INTERVAL || '300', 10),
    HEALTH_CHECK_PATH: process.env.HEALTH_CHECK_PATH || '',
    HEALTH_CHECK_HOST: process.env.HEALTH_CHECK_HOST || '',
    PROVIDER_RETRY_INTERVAL: parseInt(process.env.PROVIDER_RETRY_INTERVAL || '600', 10),
};

/**
 * Parse PROVIDER string into components
 * Format: <backend_url>,<userid>,<signature>
 */
export function parseProvider(providerString: string): ProviderConfig {
    if (!providerString) {
        throw new Error('PROVIDER environment variable is required');
    }

    const [backendUrl, userId, signature] = providerString.split(',');

    if (!backendUrl || !userId || !signature) {
        throw new Error(
            'Invalid PROVIDER format. Expected: <backend_url>,<userid>,<signature>'
        );
    }

    if (!backendUrl.startsWith('http')) {
        throw new Error('PROVIDER backend_url must start with http:// or https://');
    }

    return { backendUrl, userId, signature };
}

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
