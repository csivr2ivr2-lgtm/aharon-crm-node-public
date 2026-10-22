# Hostel-only admin access from CRM

The CRM login stays password-only, exactly as before. The **ניהול אהרן בענן** top-bar button uses a short-lived cross-domain form POST to \`https://app.aharon.cloud/auth/crm-admin-sso\`.

Hostel public IPv4 was supplied on 2026-10-22 as **93.173.169.138** (candidate, not independently verified as static). Setup both Hostinger environments with \`HOSTEL_SSO_ALLOWED_IPS=93.173.169.138\` and the **same randomly generated 32+ character \`HOSTEL_SSO_SHARED_SECRET\`**. Set \`HOSTEL_SSO_CRM_ORIGIN=https://crm.ivrphone.org\` on the Aharon Cloud side and verify CRM's \`PUBLIC_BASE_URL=https://crm.ivrphone.org\`. Never add secrets to GitHub.

With Hostinger reverse proxies, set \`HOSTEL_SSO_TRUSTED_PROXY_IPS\` to the **direct proxy socket peer IP**, not the hostel address, and configure CRM \`TRUST_PROXY\` correctly. If the real public visitor IP cannot be validated, access stays blocked. The server will show its perceived IP on a failed click, for troubleshooting.

The action requires a valid signed CRM cookie from the last 4 hours and the allowed network IP. It creates a 60-second HMAC-signed ticket with nonce, issuer, audience, timestamp, and IP. The Aharon Cloud side verifies it and restricts its new admin session to 4 hours and the same public IP. See Aharon Cloud's \`docs/HOSTEL_CRM_ADMIN_SSO.md\`.

**Important:** Wi-Fi is not a reliable identity factor; everyone on the same public network may share an IP. Anyone with the CRM password on that network could gain admin access. For best security, protect the CRM password and use private browsing on public machines; a passkey/WebAuthn or separate admin step-up is recommended for stronger identity assurance.

Production remains disabled until the actual public IP, shared secret, origin, and any trusted reverse-proxy addresses are set, and live HTTPS verification succeeds.
