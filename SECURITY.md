# Security Policy

## Supported Scope

This project is intended for local simulation and development workflows.

## Safe-by-default Networking

- Web server binds to loopback by default (`127.0.0.1`).
- State API binds to loopback by default (`127.0.0.1`).
- Non-loopback hosts are rejected unless explicitly opted in.

Unsafe opt-in:

```bash
SPHERE_ALLOW_UNSAFE_EXPOSE=1
```

Use this only when you understand the risk and have external protections (firewall, auth proxy, network segmentation).

## Operational Recommendations

- Do not expose the State API directly to the public internet without an authenticated gateway.
- Keep this repository private if simulation data is sensitive.
- Review `web/tool_audit.log` regularly if running shared environments.

## Reporting

If you discover a security issue, open a private report to the maintainer before public disclosure.
