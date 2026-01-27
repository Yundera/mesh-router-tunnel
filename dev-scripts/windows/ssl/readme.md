# SSL Development Environment

This folder contains scripts for testing mesh-router-tunnel with SSL/TLS enabled.

## Usage

Run the SSL development script to start the tunnel with HTTPS support:

```powershell
.\run-ssl-dev.ps1
```

## Test URL

Once running, access the test endpoint at:

```
https://dev.test.localhost:443/
```

## Notes

- Uses self-signed certificates for local development
- Browser may show certificate warning (expected for self-signed certs)
- Useful for testing end-to-end SSL flows before deploying to production
