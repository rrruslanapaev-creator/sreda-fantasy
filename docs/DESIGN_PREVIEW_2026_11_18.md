# Preview: Sreda Fantasy redesign (Design-Only, 18 November 2026)

This branch is an integration prototype. It must **not be merged or deployed as production** without explicit approval of the owner.

## Source and scope
- Source: `Sreda-Fantasy-Design-Only-2026-11-18.zip` (user-provided visual handoff).
- Existing `/api/handler`, manager PIN auth, Supabase user records, player records, rosters, scores, transfer limits and rules remain the source of truth.
- New purple/white/lime visual layer in `redesign.css`, responsive header and mobile bottom nav; sample shirt icons in `assets/`.
- Four boost controls and revised Rules panel integrated into frontend, using a proposed migration `supabase/009_season_boosts.sql`.

## Non-production safety
Vercel Preview deployments have **all POST actions blocked server-side**. GET returns a marked demonstration lineup for visual testing. Local edits to that lineup are stored in the visitor's `sessionStorage` only. They do not reach production Supabase. Buttons for boosts stay disabled on preview. Account login is likewise disabled to prevent session writes into the live database.

The boost database migration has **not** been applied to the working Supabase project. It is exercised only in GitHub's disposable PostgreSQL CI. On production, deploy changes to the database **before** deploying this feature's API and UI, then activate it by explicit owner approval. Do not make the production rollout by merging this PR directly.

## Boost semantics (proposed)
- `bench_boost`: both present outfield substitutes count, including if the starting five all played.
- `triple_captain`: captain's points ×3, vice-captain inherits ×3 if captain is absent.
- `free_hit`: any budget-valid roster for one round; base team stored in `manager_boosts.base_roster` and restored through `sf_rollover_rosters(source_round,target_round)` when next round is created.
- `wildcard`: unlimited transfers, new valid squad persists to the next round.
- One boost per round; each named boost can be used only once per season. Boost activation and roster validation run atomically.
- Important: operators must use `sf_rollover_rosters` to create subsequent rounds' rosters. Manual `INSERT ... SELECT` would ignore Free Hit restoration.

## Before owner approval
1. Review Vercel preview layout on desktop/mobile.
2. Run GitHub CI with Node and PostgreSQL regression tests.
3. Obtain isolated Supabase staging database for live login/roster/boost tests. A Supabase dev branch may incur compute cost; do not create without cost approval.
4. Verify budget, saved rosters, old scores, cap/vice, bench substitution, Free Hit restoration, single use, API write protection on preview.
5. Only then plan the owner-authorized production migration and rollout.

## Rollback
Backup GitHub branch: `backup/pre-redesign-2026-11-18`. Backup of ten production public tables: schema `sreda_ui_backup_20261118` (created and checksummed before this work).
