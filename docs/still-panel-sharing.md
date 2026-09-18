# Still shared developer panel

Create a link under **Share panel · QR code** in the host Developer Panel. The link expires after one hour and can be revoked with **Stop sharing**. The host tab must remain open. Existing Sites access/sign-in is still required; the link never signs someone in as the host.

The panel-only entry uses the host's snapshots; it does not load another creative workspace or run Jev. Viewers can inspect state and responses, set the onboarding flag, set the action limit (1–7), and show/hide the host's desktop Developer Panel. Closing that sidebar keeps the relay active. The detached same-browser window continues to use its existing postMessage connection.

Snapshots update through a two-second polling relay. Network time and background-tab throttling can increase that interval. A host heartbeat older than 30 seconds disables remote controls and hides stale snapshots until reconnection. Reloading or closing the host tab ends its session; start a new share after reopening.

## Access and storage

- Every endpoint requires the visitor's own authenticated principal. The site's existing audience is unchanged.
- A random 256-bit token authorizes viewer access to one panel session. The server retains its hash. Owner-only endpoints publish and revoke; a viewer token cannot use them.
- Snapshot payloads are encrypted in the browser with AES-GCM and a separate random 256-bit key. Token and key stay in the link fragment, out of the page request URL and referrer. QR encoding happens locally.
- Sharing includes creative content present in the diagnostic snapshot. Anyone with both site access and the link can inspect it during the session.
- Remote commands are limited to three validated UI settings. They cannot generate content, edit documents, refresh Jev, or run experiments. A page-scoped hash rejects commands from an older view. Setting commands are coalesced and acknowledged.
- Sessions are bounded to five per owner, one hour of access, and a 1.8 MB encrypted payload. Expired rows are removed during share creation and scheduled cleanup. Revocation removes the snapshot and queued commands immediately.
- Browser storage is not used for the sharing credential. A copied link remains a capability until revoked or expired.

## Validation

`tests/still-remote-panel.test.mjs` exercises the actual handler against SQLite with distinct authenticated identities, ownership, token gating, lease/expiry/revocation, command allowlisting, stale scopes, snapshot encryption, and both client transports. Existing detached-console and action-density tests cover their regressions.
