import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { config, getHealthCheckConfig, HealthCheckConfig } from '../common/EnvConfig.js';

const exec = promisify(execCallback);

export interface Route {
    ip: string;
    port: number;
    priority: number;
    healthCheck?: HealthCheckConfig;
}

export interface RouteRegistrationResult {
    success: boolean;
    message: string;
    routes?: Route[];
    domain?: string;
    error?: string;
}

interface ProviderInfo {
    providerUrl: string;
    userId: string;
    signature: string;
}

// Store active route refresh intervals
const refreshIntervals = new Map<string, NodeJS.Timeout>();

/**
 * Parse provider string into components
 */
function parseProviderString(providerString: string): ProviderInfo {
    const [providerUrl, userId = '', signature = ''] = providerString.split(',');
    return { providerUrl, userId, signature };
}

/**
 * Extract the provider's public IP from the provider URL
 * The provider URL format is typically: https://provider.domain.com:port
 * We need to resolve this to get the actual IP, or use the VPN_ENDPOINT_ANNOUNCE if available
 */
async function getProviderPublicIp(providerUrl: string): Promise<string> {
    // Extract hostname from URL
    const url = new URL(providerUrl);
    const hostname = url.hostname;

    // If it's already an IP, return it
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
        return hostname;
    }

    // Try to resolve the hostname to an IP
    try {
        const { stdout } = await exec(`getent hosts ${hostname} | awk '{ print $1 }' | head -1`);
        const ip = stdout.trim();
        if (ip) {
            return ip;
        }
    } catch {
        // Fall through to use hostname
    }

    // Return hostname if we can't resolve (gateway will resolve it)
    return hostname;
}

/**
 * Register tunnel route with mesh-router-backend
 * POST /router/api/routes/:userid/:sig { routes: Route[] }
 */
export async function registerTunnelRoute(
    providerString: string,
    tunnelPort: number = 443
): Promise<RouteRegistrationResult> {
    const backendUrl = config.BACKEND_URL;

    if (!backendUrl) {
        console.log('[RouteRegistrar] BACKEND_URL not configured, skipping route registration');
        return {
            success: true,
            message: 'Route registration skipped (no BACKEND_URL)',
        };
    }

    const { providerUrl, userId, signature } = parseProviderString(providerString);

    if (!userId || !signature) {
        return {
            success: false,
            message: 'Route registration failed',
            error: 'Missing userId or signature in provider string',
        };
    }

    try {
        // Get the provider's public IP (this is where the gateway will route traffic)
        const providerIp = await getProviderPublicIp(providerUrl);
        const healthCheck = getHealthCheckConfig();

        const route: Route = {
            ip: providerIp,
            port: tunnelPort,
            priority: config.ROUTE_PRIORITY,
        };

        if (healthCheck) {
            route.healthCheck = healthCheck;
        }

        const url = `${backendUrl}/router/api/routes/${encodeURIComponent(userId)}/${encodeURIComponent(signature)}`;
        const jsonData = JSON.stringify({ routes: [route] }).replace(/"/g, '\\"');
        const curlCommand = `curl -s -X POST -H "Content-Type: application/json" -d "${jsonData}" "${url}"`;

        const { stdout } = await exec(curlCommand);
        const response = JSON.parse(stdout);

        if (response.error) {
            return {
                success: false,
                message: 'Route registration failed',
                error: response.error,
            };
        }

        console.log(`[RouteRegistrar] Route registered: ${providerIp}:${tunnelPort} (priority: ${config.ROUTE_PRIORITY})`);

        return {
            success: true,
            message: response.message || 'Route registered successfully',
            routes: response.routes,
            domain: response.domain,
        };
    } catch (error) {
        return {
            success: false,
            message: 'Route registration request failed',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Start the route refresh loop for a provider
 */
export function startRouteRefreshLoop(providerString: string, tunnelPort: number = 443): void {
    // Stop any existing refresh loop for this provider
    stopRouteRefreshLoop(providerString);

    if (!config.BACKEND_URL) {
        console.log('[RouteRegistrar] BACKEND_URL not configured, not starting refresh loop');
        return;
    }

    const refreshInterval = config.ROUTE_REFRESH_INTERVAL * 1000;
    console.log(`[RouteRegistrar] Starting route refresh loop (interval: ${config.ROUTE_REFRESH_INTERVAL}s)`);

    const interval = setInterval(async () => {
        try {
            const result = await registerTunnelRoute(providerString, tunnelPort);
            if (!result.success) {
                console.error(`[RouteRegistrar] Route refresh failed: ${result.error}`);
            }
        } catch (error) {
            console.error('[RouteRegistrar] Route refresh error:', error);
        }
    }, refreshInterval);

    refreshIntervals.set(providerString, interval);
}

/**
 * Stop the route refresh loop for a provider
 */
export function stopRouteRefreshLoop(providerString: string): void {
    const interval = refreshIntervals.get(providerString);
    if (interval) {
        clearInterval(interval);
        refreshIntervals.delete(providerString);
        console.log('[RouteRegistrar] Stopped route refresh loop');
    }
}

/**
 * Stop all route refresh loops
 */
export function stopAllRouteRefreshLoops(): void {
    for (const [providerString, interval] of refreshIntervals) {
        clearInterval(interval);
        console.log(`[RouteRegistrar] Stopped route refresh loop for ${providerString.split(',')[0]}`);
    }
    refreshIntervals.clear();
}
