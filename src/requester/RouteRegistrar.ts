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
 * Register tunnel route with mesh-router-backend
 * POST /router/api/routes/:userid/:sig { routes: Route[] }
 * @param providerString - Provider connection string
 * @param tunnelPort - Port for the tunnel route (from provider response)
 * @param routeIp - IP for the route (provider's internal gateway IP)
 */
export async function registerTunnelRoute(
    providerString: string,
    tunnelPort: number,
    routeIp: string
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
        const healthCheck = getHealthCheckConfig();

        const route: Route = {
            ip: routeIp,
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

        console.log(`[RouteRegistrar] Route registered: ${routeIp}:${tunnelPort} (priority: ${config.ROUTE_PRIORITY})`);

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
export function startRouteRefreshLoop(providerString: string, tunnelPort: number, routeIp: string): void {
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
            const result = await registerTunnelRoute(providerString, tunnelPort, routeIp);
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
