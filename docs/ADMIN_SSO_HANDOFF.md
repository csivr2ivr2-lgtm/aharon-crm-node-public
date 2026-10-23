# CRM to Aharon Cloud administrator handoff

## Purpose
A signed, one-use cross-domain POST transfers an authenticated CRM administrator to the Cloud administrator interface. All browser-facing login and denial messages must be generic and must never disclose a person's physical context, internal network conditions, visitor IP, secret configuration, or detailed rejection reason.

## Important limitation
Browsers do **not** provide a reliable, authenticated Wi-Fi SSID or access-point identity to websites. Network name, provider name, local IP and dynamically assigned public IP are not adequate administrator authentication. A hardware-backed WebAuthn/passkey challenge or device-bound certificate is required before replacing a fixed network policy. No Wi-Fi-name bypass exists.

## Current deployment
- Existing CRM password login and signed session are still required.
- `HOSTEL_SSO_SHARED_SECRET`: same randomly generated, private 32+ character secret in both applications. Never add it to Git.
- `HOSTEL_SSO_ALLOWED_IPS`: current **verified** public visitor IP list; configure privately in both applications. A dynamically changing address needs an explicit update, not a wildcard range.
- `HOSTEL_SSO_TRUSTED_PROXY_IPS`: direct reverse-proxy socket peer, only after verifying it replaces/appends a trustworthy rightmost `X-Forwarded-For` hop. Avoid global trust of arbitrary client headers.
- `HOSTEL_SSO_CRM_ORIGIN` on Cloud: exact HTTPS CRM origin. CRM's `PUBLIC_BASE_URL` must agree.
- Token: HMAC-SHA256, 60-second maximum, random nonce, audience-bound, verified source IP. The receiver stores used nonce hashes with a unique key.
- Session: normal Cloud session lifetime, no special 4-hour limit; same-IP restriction remains. Signing out of CRM does not revoke the independent Cloud session.

## Privacy and diagnostics
Public responses are intentionally neutral and do not disclose the restricted network type, detected IP, allowed IP, origin, or SSO reason. Server-only diagnostic codes can be inspected in restricted logs. Do not copy diagnostic information into URLs, user-visible errors or public repositories.

Deploy both applications from current main only after testing signed transfers, proxy correctness, rejection from an unapproved IP, expiration, replay blocking and logout behavior. Use a private browser session on a shared workstation; sign out from both applications and close the window.

**Historical note:** Older repository commits might still contain obsolete network-specific documentation. This change does not rewrite repository history.
