import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { config, parseProvider, ProviderConfig } from '../common/EnvConfig.js';

const exec = promisify(execCallback);

export interface Route {
    ip: string;
    port: number;
    priority: number;
    scheme?: "http" | "https";       // Ingress protocol scheme - what traffic this route accepts
    targetScheme?: "http" | "https"; // Target protocol scheme - what protocol to use when connecting to backend
    source: string;
    tunnelIp?: string;               // This box's WireGuard address: the gateway can reach Caddy's :443 there directly
}

export interface RouteRegistrationResult {
    success: boolean;
    message: string;
    routes?: Route[];
    domain?: string;
    error?: string;
}

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

/** One provider's tunnel, as the box registers it. */
export interface Tunnel {
    routeIp: string;     // the provider's internal address (its nginx, plain HTTP path)
    routePort: number;
    tunnelIp?: string;   // this box's WireGuard address on that provider
}

// Every connected provider's tunnel, by provider URL. The backend keeps one route list per
// source and a POST replaces it, so all providers' routes go in one registration.
const tunnels = new Map<string, Tunnel>();

/** This tunnel's two routes (HTTPS and HTTP ingress). */
function tunnelRoutes(t: Tunnel): Route[] {
    // targetScheme is 'http' because SSL is terminated at the gateway, and WireGuard encrypts the tunnel.
    // tunnelIp on both: a gateway routing the WireGuard subnet goes to tunnelIp:443 with TLS
    // for HTTPS, and tells by it which provider (subnet) a route belongs to, so it never
    // picks another host's provider address (older gateways ignore the field)
    const common = {
        ip: t.routeIp,
        port: t.routePort,
        priority: config.ROUTE_PRIORITY,
        targetScheme: 'http' as const,
        source: 'tunnel',
        ...(t.tunnelIp ? { tunnelIp: t.tunnelIp } : {}),
    };
    return [
        { ...common, scheme: 'https' },  // Ingress: accept HTTPS traffic
        { ...common, scheme: 'http' },   // Ingress: accept HTTP traffic
    ];
}

/** Add or replace a provider's tunnel, then register every tunnel's routes. */
export async function setTunnel(providerURL: string, tunnel: Tunnel): Promise<RouteRegistrationResult> {
    tunnels.set(providerURL, tunnel);
    return registerTunnelRoutes();
}

/** Drop a provider's tunnel, then register the remaining ones. */
export async function removeTunnel(providerURL: string): Promise<void> {
    if (!tunnels.delete(providerURL)) return;
    const result = await registerTunnelRoutes();
    if (!result.success) console.error(`[RouteRegistrar] Route update after removing ${providerURL} failed: ${result.error}`);
}

/**
 * Register every connected provider's tunnel routes with mesh-router-backend
 * POST /router/api/routes/:userid/:sig { routes: Route[] }
 * Two routes per provider: HTTPS and HTTP ingress. No tunnel: nothing is sent, the
 * previous registration expires with its TTL.
 */
export async function registerTunnelRoutes(): Promise<RouteRegistrationResult> {
    const provider = getProvider();

    if (!provider) {
        console.log('[RouteRegistrar] PROVIDER not configured, skipping route registration');
        return {
            success: true,
            message: 'Route registration skipped (no PROVIDER)',
        };
    }
    if (tunnels.size === 0) {
        return { success: true, message: 'No tunnel to register' };
    }

    const { backendUrl, userId, signature } = provider;

    try {
        // Backend validates tunnel IPs since it's on the same network as the tunnel provider
        const routes: Route[] = [...tunnels.values()].flatMap(tunnelRoutes);

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

        const summary = [...tunnels.values()]
            .map(t => `${t.routeIp}:${t.routePort}${t.tunnelIp ? ` (tunnelIp ${t.tunnelIp})` : ''}`).join(', ');
        console.log(`[RouteRegistrar] Routes registered for ${tunnels.size} provider(s): ${summary} (https + http, priority: ${config.ROUTE_PRIORITY})`);

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

// The one refresh loop, for all tunnels
let refreshInterval: NodeJS.Timeout | null = null;

/** Start the route refresh loop if it is not running (it keeps every tunnel's routes alive). */
export function ensureRouteRefreshLoop(): void {
    if (refreshInterval) return;

    const provider = getProvider();
    if (!provider) {
        console.log('[RouteRegistrar] PROVIDER not configured, not starting refresh loop');
        return;
    }

    const intervalMs = config.ROUTE_REFRESH_INTERVAL * 1000;
    console.log(`[RouteRegistrar] Starting route refresh loop (interval: ${config.ROUTE_REFRESH_INTERVAL}s)`);

    refreshInterval = setInterval(async () => {
        try {
            const result = await registerTunnelRoutes();
            if (!result.success) {
                console.error(`[RouteRegistrar] Route refresh failed: ${result.error}`);
            }
        } catch (error) {
            console.error('[RouteRegistrar] Route refresh error:', error);
        }
    }, intervalMs);
}

/** Stop the route refresh loop */
export function stopRouteRefreshLoop(): void {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
        console.log('[RouteRegistrar] Stopped route refresh loop');
    }
}
