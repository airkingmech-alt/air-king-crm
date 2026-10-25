# Remember me

The deployed app already used Supabase `persistSession: true` with the browser's default persistent storage and automatic token refresh. There was no checkbox. The separate automation-browser credential-state error is a tooling/session-access issue; this change does not repair it or promise permanent authentication.

New password sign-ins have an unchecked-by-default **Remember me on this device** choice:

- Checked uses Supabase's existing project-scoped localStorage key. Sessions can survive browser restarts while valid. Existing saved sessions remain compatible.
- Unchecked uses sessionStorage with a per-tab auth key. Refresh retains the session; a new independent tab/clean browser restart does not inherit it. Browser tab duplication or session-restore features can restore sessionStorage, so users must still sign out on shared devices. The UI states this limitation.

Only Supabase session tokens are stored using its supported `storage`/`storageKey` options. The app never saves passwords or logs tokens/credentials. Password form state is cleared after successful sign-in. Automatic token refresh, URL session detection, server expiry, server authorization/RLS, and default global Supabase sign-out remain in force. No database migration, production auth setting, grant, credential, or server session-lifetime changes are involved.

Changing mode disposes the old SDK client and updates the shared client binding before sign-in. A guarded storage adapter prevents late requests from a retired SDK client from rewriting old persistent tokens. The inactive app auth keys are cleared without clearing other application data. Unique session-only auth keys prevent Supabase's BroadcastChannel from sharing a tab-only login with unrelated tabs. Auth-state callbacks schedule session/profile reads outside the SDK's auth lock and ignore stale responses after client changes or unmount.

Storage denial produces an error rather than silently enabling persistent storage. SDK sign-out errors no longer pretend a session was removed.

Validation: `npm run release:check`, `npm run build:deploy`, seven isolated storage tests, and `node tests/remember-me-browser.mjs`. The browser test uses the real installed Supabase client against synthetic local fetch responses: both checkbox states, duplicate submit, refresh, clean restart, separate-tab isolation, logout, revoked/expired refresh, invalid credentials, password-not-stored and mobile layout. No real sign-ins or credentials are used. A synthetic mobile preview is in `docs/screenshots/remember-me-mobile.png`.

This PR is based on production master and contains none of the unmerged Text Messages PR51 changes. Publication requires separate approval.
