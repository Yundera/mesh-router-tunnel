# Local Development Setup with CasaOS

This repository contains scripts for setting up a local development environment with CasaOS and mesh routing capabilities.

## Prerequisites

- Docker installed and running
- PowerShell
- At least 2GB of free RAM
- A directory `C:\DATA` created on your system (or modify the path in the scripts)

## Network Setup

Before running the scripts, you need to create two Docker networks:

```powershell
docker network create pcs
docker network create provider
```

## Components

The setup consists of three main components:

1. **Provider (mesh-router-provider)**: Handles routing and VPN endpoints
2. **Requester (mesh-router)**: Manages traffic routing between components
3. **CasaOS**: The main application dashboard

## Running the Environment

1. Clone this repository and navigate to the scripts directory
2. Run the main script:

```powershell
.\run.ps1
```

This script will:
- Build and start the provider container
- Build and start the requester container
- Start the CasaOS container

## Accessing the Dashboard

Once all containers are running, you can access the CasaOS dashboard through either:
- http://dev.test.localhost
- http://8080-casaos-dev.test.localhost

## Container Details

### Provider Container
- Name: mesh-router-provider-test.localhost
- Ports: 80, 51820 (UDP)
- Networks: provider
- Special capabilities: NET_ADMIN, SYS_MODULE

### Requester Container
- Name: mesh-router-localhost
- Networks: pcs, provider
- Environment variables:
    - PROVIDER: http://dprovider,dev
    - ROUTING_TARGET_HOST: casaos
    - ROUTING_TARGET_PORT: 8080

### CasaOS Container
- Name: casa-os-dev
- Port: 12380:8080
- Networks: pcs
- Volume mounts:
    - C:\DATA:/DATA
    - /var/run/docker.sock:/var/run/docker.sock

## Troubleshooting

If you encounter issues:

1. Ensure all required Docker networks exist
2. Check if any of the ports (80, 51820, 12380, 8080) are already in use
3. Verify the C:\DATA directory exists and has proper permissions
4. Check Docker logs for specific container issues:
```powershell
docker logs mesh-router-provider-test.localhost
docker logs mesh-router-localhost
docker logs casa-os-dev
```

## Cleaning Up

To stop and remove all containers:

```powershell
docker stop mesh-router-provider-test.localhost mesh-router-localhost casa-os-dev
docker rm mesh-router-provider-test.localhost mesh-router-localhost casa-os-dev
```

## Architecture Overview

```
[Provider Container] <---> [Requester Container] <---> [CasaOS Container]
     (routing)              (traffic management)         (dashboard)
```

The provider container handles routing and VPN endpoints, the requester manages traffic between components, and the CasaOS container hosts the main application dashboard. All components communicate through Docker networks (pcs and provider) to ensure proper isolation and connectivity.