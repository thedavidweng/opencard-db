# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities through GitHub's **private vulnerability
reporting**:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** to open a private advisory.

This keeps the report confidential until a fix is available. Do **not** open a
public issue for security problems.

Please include what you'd expect: affected component (root tooling or the
`worker/` Cloudflare Worker API), reproduction steps, and impact. We'll
acknowledge the report and coordinate a fix and disclosure timeline with you.

## Scope

OpenCard DB is static card **metadata** plus a read-only API. There is no user
authentication, no write API, and no stored personal data. The most relevant
surfaces are the Cloudflare Worker (`worker/`) and the CI automation under
`.github/workflows/` (which handles untrusted issue and PR input).

## Card artwork takedown / copyright

Card face artwork is **not** a security vulnerability, but rights holders can
request removal here too. All issuer card art remains the **copyright of the
issuing bank or network** — OpenCard DB does not claim ownership and does not
relicense it (see [`images/README.md`](images/README.md)).

If you are an issuer or rights holder and want a local image mirror removed:

- Open an issue requesting removal (fastest), **or**
- Use the private security-reporting path above if you'd prefer not to file
  publicly, **or**
- Contact the maintainer [@thedavidweng](https://github.com/thedavidweng).

Maintainers will remove the file promptly on a valid request. After removal we
prefer switching the card to an official `image.url` or `null` — the API then
serves the generic OpenCard placeholder.
