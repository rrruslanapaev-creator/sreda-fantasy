# Sreda Fantasy: production launch checklist, 19 November 2026

## Scope
- New visual shell, responsive field, mobile navigation, two-tap starter/bench substitutions, league ownership, three footballer statistics (season points, published-round average, ownership).
- Familiar login and registration UI is retained and styled for the new design. Username/PIN endpoints, hashing (scrypt with AUTH_PEPPER), session cookies and access rules remain the same.
- Four boosts display as non-interactive cards. There is no boost activation and no required SQL migration.
- Existing backend scoring, admin.js, /api/results.js and database tables are preserved.

## Before launch
1. A new confidential snapshot was created on the production Supabase project in schema `sreda_ui_backup_20261119`, including all 10 public tables, with per-table row counts and checksums. Snapshot includes PIN hashes and session token hashes; **never export it to public GitHub, logs, or client applications**. This is a data snapshot, not a full PostgreSQL backup.
2. Production code backup branch: `backup/pre-ui-launch-2026-11-19`, commit `cf798f6c7bf6318f64cf43e479cb55c3761d2279`.
3. Production project and environment variables remain unchanged; do not rotate AUTH_PEPPER during the redesign or old PINs will fail.
4. Review CI: JavaScript checks, PIN/sessions mocks, published scoring regression, and PostgreSQL scoring fixtures.
5. Review Vercel Preview: live DB writes are blocked there. The preview may display the login dialog, but submission buttons must remain disabled in preview.

## Live smoke check after deployment (do not use real users' PINs in test logs)
- Site loads with `theme-fpl` body, login header button, team, market, players, league and rules.
- Existing manager logs in with original username and PIN; the saved roster appears unchanged.
- Logout, login again, confirm that sessions work and admin-only tools stay restricted.
- Inspect market and roster while deadline is closed; do not create a dummy transfer. If an authorized manager has a real upcoming open round, verify save using that manager's permission.
- Four boosts remain disabled; old scoring remains unchanged.
- Check historical results and leaderboard, current ownership and average; verify roster privacy for other managers before a deadline.
- On phones, inspect bottom navigation, login modal, field, and the touch substitution gesture.

## Revert
If the interface or authentication misbehaves, restore production files by reverting the release merge commit (or redeploy `backup/pre-ui-launch-2026-11-19`), leaving the database unchanged. The snapshot schema is only for a separate, carefully planned database restore, not a user-visible rollback. No SQL migration is performed as part of this launch.

## Limitations
- Production PIN values are unknown to the developer and must not be accessed or exposed. Automated login tests use synthetic, in-memory accounts and synthetic PIN hashes.
- Vercel Preview is intentionally read-only and does not prove live Supabase login; run the live smoke check after deployment and keep a rollback path.
