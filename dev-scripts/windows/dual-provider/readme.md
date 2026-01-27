# Dual-Provider Development Environment

This folder is used to test the multi-provider configuration where a requester connects to multiple providers simultaneously.

## Usage

Run the dual-provider requester development script:

```powershell
.\run-dual-provider-requester-dev.ps1
```

## Test URLs

Once running, you should be able to access the same CasaOS login page on both domains:

- http://dev.test2.localhost:8080/#/login
- http://dev.test.localhost/#/login

## Sample Configuration

Example `config.yml` for connecting to multiple providers:

```yaml
providers:
  # NSL.sh provider (production example)
  - provider: https://api.nsl.sh,<userid>,<signature>
    defaultService: casaos

  # Custom domain provider (local example)
  - provider: http://mesh-router-domain,<userid>
    defaultService: casaos
    services:
      casaos:
        defaultPort: '8080'
```

## Notes

- Replace `<userid>` and `<signature>` with your actual credentials
- The sample credentials in scripts are examples only - do not use in production
- This configuration enables failover between multiple tunnel providers
