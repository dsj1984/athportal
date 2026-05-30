-- Migration 0010 — add nullable `first_name` / `last_name` to `users`
--
-- Story #1054 (F33). The system had no canonical home for a person's
-- name — `users` stored only `email`, and the roster projection derived
-- a display name from the email local-part, so an athlete rendered as
-- "E2e Roster S4 001" instead of their real name.
--
-- The real name lives in Clerk. `onboard.ts` already fetches the Clerk
-- user (for the verified-email re-query) but discarded everything except
-- the email. These two columns let onboarding promote the Clerk
-- `firstName` / `lastName` into `users` inside the same transaction that
-- promotes `email`, mirroring the ADR-005 email-promotion precedent. A
-- Clerk `user.updated` webhook re-promotes them on profile edits.
--
-- Both columns are nullable (no default, no NOT NULL): the
-- JIT-provisioned placeholder row exists before any name is known, and a
-- Clerk profile may legitimately omit either field. The coach roster
-- projection falls back to the email-derived name when both are null, so
-- a null here is never a hard error. This is an additive, non-destructive
-- migration (ADD COLUMN nullable) — it does not trip the ADR-017
-- destructive-migration guard.

ALTER TABLE `users` ADD COLUMN `first_name` text;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `last_name` text;
