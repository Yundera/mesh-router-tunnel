import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { config, getHealthCheckConfig, HealthCheckConfig, parseProvider, ProviderConfig } from '../common/EnvConfig.js';

const exec = promisify(execCallback);

export interface Route {
    ip: string;
    port: number;
    priority: number;
    healthCheck?: HealthCheckConfig;
    source: string;
}

export interface RouteRegistrationResult {
    success: boolean;
    message: string;
    routes?: Route[];
    domain?: string;
    error?: string;
}

// Store active route refresh intervals
const refreshIntervals = new Map<string, NodeJS.Timeout>();

// Cached parsed provider config
let cachedProvider: ProviderConfig | null = null;

/**
 * Get parsed provider config (cached)
 */
function getProvider(): ProviderConfig | null {
    if (cachedProvider) {
        return cachedProvider;
    }

    if (!config.PROVIDER) {
        return null;
    }

    try {
        cachedProvider = parseProvider(config.PROVIDER);
        return cachedProvider;
    } catch (error) {
        console.error('[RouteRegistrar] Failed to parse PROVIDER:', error);
        return null;
    }
}

/**
 * Register tunnel route with mesh-router-backend
 * POST /router/api/routes/:userid/:sig { routes: Route[] }
 * @param tunnelPort - Port for the tunnel route (from provider response)
 * @param routeIp - IP for the route (provider's internal gateway IP)
 */
export async function registerTunnelRoute(
    tunnelPort: number,
    routeIp: string
): Promise<RouteRegistrationResult> {
    const provider = getProvider();

    if (!provider) {
        console.log('[RouteRegistrar] PROVIDER not configured, skipping route registration');
        return {
            success: true,
            message: 'Route registration skipped (no PROVIDER)',
        };
    }

    const { backendUrl, userId, signature } = provider;

    try {
        const healthCheck = getHealthCheckConfig();

        const route: Route = {
            ip: routeIp,
            port: tunnelPort,
            priority: config.ROUTE_PRIORITY,
            source: 'tunnel',  // Source identifier for route replacement
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

// Store the active refresh interval
let refreshInterval: NodeJS.Timeout | null = null;

/**
 * Start the route refresh loop
 */
export function startRouteRefreshLoop(tunnelPort: number, routeIp: string): void {
    // Stop any existing refresh loop
    stopRouteRefreshLoop();

    const provider = getProvider();
    if (!provider) {
        console.log('[RouteRegistrar] PROVIDER not configured, not starting refresh loop');
        return;
    }

    const intervalMs = config.ROUTE_REFRESH_INTERVAL * 1000;
    console.log(`[RouteRegistrar] Starting route refresh loop (interval: ${config.ROUTE_REFRESH_INTERVAL}s)`);

    refreshInterval = setInterval(async () => {
        try {
            const result = await registerTunnelRoute(tunnelPort, routeIp);
            if (!result.success) {
                console.error(`[RouteRegistrar] Route refresh failed: ${result.error}`);
            }
        } catch (error) {
            console.error('[RouteRegistrar] Route refresh error:', error);
        }
    }, intervalMs);
}

/**
 * Stop the route refresh loop
 */
export function stopRouteRefreshLoop(): void {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
        console.log('[RouteRegistrar] Stopped route refresh loop');
    }
}
