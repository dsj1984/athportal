-- Migration 0004 — org branding columns (Epic #10 / Story #656)
--
-- Additive nullable columns on `organizations` so the admin org-config
-- page can persist a logo reference and a primary brand colour:
--   1. logo_r2_key — text, nullable. Points at the R2 object key for
--      the org's uploaded logo (finalised via the signed-upload flow
--      in Story #656 / Task #675). Null when no logo has been uploaded.
--   2. primary_color_hex — text, nullable. Stores the brand colour as
--      a 7-character hex string ("#RRGGBB"); validated at the API
--      boundary. Null when the org has not chosen a colour.
--
-- Both columns are intentionally nullable and carry no default so
-- existing organisations remain unaffected and future inserts continue
-- to specify only required fields.

ALTER TABLE `organizations` ADD `logo_r2_key` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `primary_color_hex` text;
