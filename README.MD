
[![Build and Push Docker Image](https://github.com/Yundera/mesh-router-tunnel/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Yundera/mesh-router-tunnel/actions/workflows/docker-publish.yml)

# MeshRouter Tunnel

## Sponsor
Thanks for sponsoring this project

**Yundera** : [yundera.com](https://yundera.com) - Easy to use cloud server for open source container applications.
**NSL.SH** : [nsl.sh](https://nsl.sh) - free domain for opensouce project.

## Sibling project
[CasaIMG](https://github.com/worph/casa-img) - providing easy management of docker images and compatible with mesh router.

## Architecture

MeshRouter is a WireGuard-based VPN tunneling solution that enables secure routing of traffic between a provider (public server) and requesters (private PCS instances).

```
┌─────────────────────────────────────────────────────────────────────┐
│                            PCS Instance                              │
│                                                                      │
│  ┌──────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │ mesh-router  │───▶│   Caddy     │───▶│  Services (with labels) │ │
│  │  (port 80)   │    │  (port 80)  │    │  - casaos:8080          │ │
│  │              │    │             │    │  - app1:3000            │ │
│  │  WireGuard   │    │  Docker     │    │  - app2:8080            │ │
│  │  Tunnel ▲    │    │  Labels     │    │                         │ │
│  └──────────────┘    └─────────────┘    └─────────────────────────┘ │
│              │                                                       │
└──────────────│───────────────────────────────────────────────────────┘
               │
               ▼
        ┌─────────────┐
        │  Provider   │
        │  (nsl.sh)   │
        └─────────────┘
```

### How It Works

1. **Mesh Router (Requester)**: Establishes WireGuard tunnel to provider and forwards all incoming traffic to Caddy
2. **Caddy**: Uses [caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy) to discover services via Docker labels and routes traffic accordingly
3. **Services**: Containers with Caddy labels define their own routing rules

### Traffic Flow

1. **External Request**: User requests `https://app.user.nsl.sh`
2. **Provider**: nsl.sh receives request, looks up user's VPN IP, forwards via WireGuard
3. **Mesh Router**: Receives request on port 80, forwards to Caddy
4. **Caddy**: Matches request against container labels, proxies to appropriate service
5. **Service**: Container handles request and returns response

## Domain Routing

The mesh-router operates in two modes:

- **Provider Mode**: Runs on public servers, accepts incoming connections and routes traffic to registered requesters via WireGuard
- **Requester Mode**: Runs on PCS instances, establishes VPN tunnel to provider and forwards traffic to Caddy for local routing

### Domain Format

`<name>` : Name proposed by the user on registration (if accepted by the provider)
`<domain>` : The domain of the provider (eg nsl.sh)

Full format: `<service>.<name>.<domain>` or `<service>-<name>.<domain>`

Example: `nextcloud.mynas.nsl.sh` or `nextcloud-mynas.nsl.sh`

## Requester Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROVIDER` | - | Provider connection string: `<url>,<userId>,<signature>` (for single provider setup) |
| `ROUTING_TARGET_HOST` | `caddy` | Target container hostname for traffic forwarding |
| `ROUTING_TARGET_PORT` | `80` | Target container port |

### YAML Configuration (Multi-Provider)

For advanced setups with multiple providers, use a YAML configuration file mounted at `/app/config/config.yml`:

```yaml
providers:
  - provider: https://nsl.sh,userId,signature
    defaultService: casaos
  - provider: http://custom-provider.com,userId2
    defaultService: myapp
    services:
      myapp:
        defaultPort: '3000'
```

The configuration file is watched for changes and will automatically reconnect to providers when modified.

### Connection Health Monitoring

The requester automatically monitors WireGuard handshakes every 5 minutes. If a connection becomes stale (no handshake within 5 minutes), it will:
1. Log the connection issue
2. Tear down the WireGuard interface
3. Re-register with the provider
4. Re-establish the tunnel

This ensures resilient connections without manual intervention.

### Docker Compose Example

```yaml
services:
  mesh-router:
    image: ghcr.io/yundera/mesh-router-tunnel:latest
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.ip_forward=1
      - net.ipv4.conf.all.src_valid_mark=1
    environment:
      - PROVIDER=https://nsl.sh,<userId>,<signature>
      - ROUTING_TARGET_HOST=caddy
      - ROUTING_TARGET_PORT=80
    networks:
      - pcs
    depends_on:
      - caddy

  caddy:
    image: lucaslorentz/caddy-docker-proxy:ci-alpine
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - CADDY_INGRESS_NETWORKS=pcs
    networks:
      - pcs

  casaos:
    image: casa-img:latest
    labels:
      caddy: ":80"
      caddy.reverse_proxy: "{{upstreams 8080}}"
    networks:
      - pcs

networks:
  pcs:
    driver: bridge
    name: pcs
```

## Caddy Docker Labels

Labels define how Caddy routes traffic to each container:

```yaml
labels:
  caddy: ":80"                              # Match all requests on port 80
  caddy.reverse_proxy: "{{upstreams 8080}}" # Proxy to container port 8080
```

### `{{upstreams <port>}}` Template

This template function:
- Resolves to the container's IP address on the ingress network
- Uses the specified port as the upstream port
- Example: `{{upstreams 8080}}` → `172.20.0.2:8080`

### Routing Examples

**Route all traffic to a service:**
```yaml
labels:
  caddy: ":80"
  caddy.reverse_proxy: "{{upstreams 3000}}"
```

**Route by hostname:**
```yaml
labels:
  caddy: "myapp.example.com"
  caddy.reverse_proxy: "{{upstreams 8080}}"
```

**Route with path matching:**
```yaml
labels:
  caddy: ":80"
  caddy.0_matcher: "path /api/*"
  caddy.0_reverse_proxy: "{{upstreams 8080}}"
```

## Provider Configuration

Provider mode is used on public servers to accept incoming VPN connections.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROVIDER_ANNONCE_DOMAIN` | - | Domain to announce (e.g., `nsl.sh`) - presence of this variable enables provider mode |
| `AUTH_API_URL` | - | URL for user authentication API (optional) |
| `VPN_IP_RANGE` | `10.77.0.0/16` | IP range for VPN clients |
| `VPN_PORT` | `51820` | WireGuard listen port |
| `VPN_ENDPOINT_ANNOUNCE` | - | Public endpoint for VPN connections (IP or hostname) |
| `SSL` | `false` | Enable HTTPS with self-signed certificate on port 443 |

### Provider API Endpoints

The provider exposes an internal API on port 3000 (used by Nginx for routing):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ping` | GET | Health check - returns `ok` |
| `/api/get_ip/<host>` | GET | Resolves domain to backend VPN IP for routing |
| `/api/register` | POST | Peer registration endpoint for requesters |

**Registration Request Body:**
```json
{
  "userId": "username",
  "vpnPublicKey": "WireGuard public key",
  "authToken": "signature or auth token"
}
```

**Registration Response:**
```json
{
  "wgConfig": { "interface": {...}, "peers": [...] },
  "serverIp": "10.77.0.1",
  "serverDomain": "nsl.sh",
  "domainName": "username",
  "domain": "username.nsl.sh"
}
```

### Docker Compose Example

```yaml
services:
  routing:
    image: ghcr.io/yundera/mesh-router-tunnel:latest
    ports:
      - "80:80"
      - "443:443"
      - "51820:51820/udp"
    environment:
      - PROVIDER_ANNONCE_DOMAIN=domain.com
      - VPN_ENDPOINT_ANNOUNCE=x.x.x.x  # Use direct IP (not behind Cloudflare)
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.ip_forward=1
      - net.ipv4.conf.all.src_valid_mark=1
    volumes:
      - ./config.lua:/etc/nginx/lua/config.lua  # optional
```

### Cloudflare

It is recommended to set up Cloudflare for TLS management and DDoS protection. The provider container will use a self-signed certificate for end-to-end encryption.

# Alternative

Tailscale Funnel
Cloudflare Tunnels
https://github.com/hintjen/selfhosted-gateway : Docker native self-hosted alternative to Cloudflare Tunnels, Tailscale Funnel, ngrok and others.

# Development

To start development, use the scripts in `./dev-scripts/windows/simple` folder,
which contains everything needed to run mesh-router in a basic environment.
For detailed instructions, see [simple example](dev-scripts/windows/simple/readme.md).
