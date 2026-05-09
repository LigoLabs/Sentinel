# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** via [GitHub Security Advisories](https://github.com/LigoLabs/Sentinel/security/advisories/new).

Do **not** open a public issue for security reports.

We aim to acknowledge reports within 7 days and to ship a fix or mitigation within 30 days for critical issues.

## Threat model

Sentinel is designed for **single-operator self-hosting behind a reverse proxy with HTTPS**. The default configuration assumes:

- A single trusted administrator with the `ADMIN_PASSWORD`.
- The dashboard is **not** exposed directly to the public internet without TLS termination upstream.
- The host filesystem (containing `data/sentinel.db` and `.env`) is trusted and not shared with untrusted processes or users.

Deployments outside this model (multi-tenant, public-internet without HTTPS, shared hosts) are out of scope.

## In scope

- Authentication bypass on the `/api/*` routes.
- Exposure of decrypted source credentials (DB / storage tokens).
- Tampering with backups (write or delete) without authentication.
- Server-side injection (SQLi, command injection, path traversal) in connectors or routes.
- Cryptographic flaws in `server/src/crypto/encryption.ts`.

## Out of scope

- Misconfiguration: default `ADMIN_PASSWORD` left unchanged, dashboard exposed without HTTPS, weak `JWT_SECRET` set manually after auto-generation.
- Self-DoS via a malicious admin (rate-limit only protects against pre-auth brute force).
- Vulnerabilities in third-party dependencies that already have a published fix — please update first and re-test.
- Issues requiring local OS-level access to the host running Sentinel.

## Cryptography

Source configurations (DB URLs, tokens, SSH keys) are encrypted at rest with AES-256-GCM using `ENCRYPTION_KEY` (64-char hex, auto-generated on first boot). The key is stored in `.env` on the host.

If `ENCRYPTION_KEY` is lost or rotated, all stored source configurations become unrecoverable.
