# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest (`main` / latest release binary) | ✅ |
| Older tagged releases | Best-effort fixes only |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately via one of:

1. **GitHub Security Advisories** — [Report a vulnerability](https://github.com/devnonla/open-agent-hands/security/advisories/new) on this repository

Include:

- Description of the issue and impact
- Steps to reproduce or a proof of concept
- Affected version / commit if known

We aim to acknowledge reports within **72 hours** and share a remediation plan or status update within **7 days**. Please give us reasonable time to fix and disclose before public discussion.

## Scope

In scope examples: auth bypass, remote code execution in the default deployment, path traversal that escapes intended data directories, secret leakage through the API.

Out of scope examples: denial of service via resource exhaustion alone, issues that require already-compromised host access, findings that only apply to intentionally insecure local misconfiguration.
