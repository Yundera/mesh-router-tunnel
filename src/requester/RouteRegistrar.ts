import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { config, getHealthCheckConfig, HealthCheckConfig, parseProvider, ProviderConfig } from '../common/EnvConfig.js';

const exec = promisify(execCallback);

export interface Route {
    ip: string;
    port: number;
    priority: number;
    scheme?: "http" | "https";
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
 * Register tunnel routes with mesh-router-backend
 * POST /router/api/routes/:userid/:sig { routes: Route[] }
 * Registers two routes: one for HTTPS (port from config) and one for HTTP (port 80)
 * @param tunnelPortHttps - Port for HTTPS tunnel route (from provider response)
 * @param tunnelPortHttp - Port for HTTP tunnel route (from provider response, default: 80)
 * @param routeIp - IP for the route (provider's internal gateway IP)
 */
export async function registerTunnelRoute(
    tunnelPortHttps: number,
    routeIp: string,
    tunnelPortHttp: number = 80
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

        // Build dual routes: HTTPS and HTTP
        const routes: Route[] = [
            {
                ip: routeIp,
                port: tunnelPortHttps,
                priority: config.ROUTE_PRIORITY,
                scheme: 'https',
                source: 'tunnel',
                ...(healthCheck && { healthCheck }),
            },
            {
                ip: routeIp,
                port: tunnelPortHttp,
                priority: config.ROUTE_PRIORITY,
                scheme: 'http',
                source: 'tunnel',
                // No health check for HTTP route
            },
        ];

        const url = `${backendUrl}/router/api/routes/${encodeURIComponent(userId)}/${encodeURIComponent(signature)}`;
        const jsonData = JSON.stringify({ routes }).replace(/"/g, '\\"');
        const curlCommand = `curl -s -w "\\n%{http_code}" -X POST -H "Content-Type: application/json" -d "${jsonData}" "${url}"`;

        const { stdout } = await exec(curlCommand);

        // Parse response and HTTP status code
        const lines = stdout.trim().split('\n');
        const httpCode = parseInt(lines.pop() || '0', 10);
        const body = lines.join('\n');

        // Check for HTTP errors
        if (httpCode >= 400 || httpCode === 0) {
            return {
                success: false,
                message: 'Route registration failed',
                error: `HTTP ${httpCode}: Server returned an error (endpoint may not exist on this backend version)`,
            };
        }

        // Parse JSON response
        let response;
        try {
            response = JSON.parse(body);
        } catch {
            return {
                success: false,
                message: 'Route registration failed',
                error: `Invalid JSON response from server (backend may not support routes API)`,
            };
        }

        if (response.error) {
            return {
                success: false,
                message: 'Route registration failed',
                error: response.error,
            };
        }

        console.log(`[RouteRegistrar] Routes registered: ${routeIp}:${tunnelPortHttps} (https), ${routeIp}:${tunnelPortHttp} (http) (priority: ${config.ROUTE_PRIORITY})`);

        return {
            success: true,
            message: response.message || 'Routes registered successfully',
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
 * @param tunnelPortHttps - Port for HTTPS traffic
 * @param routeIp - IP address for the route
 * @param tunnelPortHttp - Port for HTTP traffic (default: 80)
 */
export function startRouteRefreshLoop(tunnelPortHttps: number, routeIp: string, tunnelPortHttp: number = 80): void {
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
            const result = await registerTunnelRoute(tunnelPortHttps, routeIp, tunnelPortHttp);
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
