-- Replace the loose (workspace_id) index with a composite PK on
-- (workspace_id, user_id) so the same user can no longer be inserted into
-- the same workspace twice. Idempotent.

DROP INDEX IF EXISTS "workspace_members_workspace_id_idx";--> statement-breakpoint

-- Clean up any duplicate rows that slipped in before the PK existed.
-- Keep the earliest joined_at; tie-break on ctid (physical row id) so we
-- always converge to exactly one survivor per (workspace_id, user_id).
DELETE FROM "workspace_members" a
USING "workspace_members" b
WHERE a.workspace_id = b.workspace_id
  AND a.user_id = b.user_id
  AND (a.joined_at > b.joined_at
       OR (a.joined_at = b.joined_at AND a.ctid > b.ctid));--> statement-breakpoint

ALTER TABLE "workspace_members" DROP CONSTRAINT IF EXISTS "workspace_members_workspace_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id");
