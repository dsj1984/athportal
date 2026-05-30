-- Migration 0009 — dedup pending roster invites (Story #1052 / F35)
--
-- Tech Spec #906 §Data Models records the single-pending-invite
-- invariant: at most one `roster_invite` row may be `status='pending'`
-- for a given `(email, team_id)` pair. Two independently-acceptable
-- accept links for the same recipient on the same team is a correctness
-- hazard — whichever token is accepted first wins, and the other
-- lingers as a live `pending` invite until expiry.
--
-- The create-invite handler probes for an existing pending row before
-- insert and refuses a duplicate with 409 INVITE_ALREADY_PENDING. This
-- partial unique index is the race-safe backstop: it makes the database
-- the final arbiter so two concurrent Sends cannot both win even if
-- both pass the application-side probe before either inserts.
--
-- Partial (filtered) so the constraint applies ONLY while a row is
-- pending. Accepted / declined / expired / revoked rows for the same
-- `(email, team_id)` pair are unconstrained, which keeps re-issue after
-- expiry / revoke working: the prior row is no longer `pending`, so a
-- fresh pending row does not collide.

CREATE UNIQUE INDEX `roster_invite_email_team_pending_unique`
	ON `roster_invite` (`email`,`team_id`)
	WHERE `status` = 'pending';
