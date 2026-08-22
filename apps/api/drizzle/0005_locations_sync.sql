-- Give `locations` the two columns the sync engine tracks everything by.
--
-- The engine pulls with an `updated_at` cursor and represents deletions as tombstones rather
-- than removed rows, so a table without both is a table it cannot sync. `locations` predates the
-- sync work and has neither, which is why gyms are recorded on the device and go no further.
--
-- Existing rows get `updated_at` from `created_at` rather than `now()`: stamping every row with
-- the moment of the migration would make the first pull look like every gym had just changed.

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint

UPDATE "locations" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
--> statement-breakpoint

-- The pull is "everything for this user changed since the cursor", which is this index exactly.
CREATE INDEX IF NOT EXISTS "locations_user_updated_idx"
  ON "locations" ("user_id", "updated_at");
--> statement-breakpoint

-- RLS was enabled on this table in 0001 and its policy already reaches the owner through
-- `user_id`; adding columns does not change who may see a row. The audit in src/db/rls.test.ts
-- covers that and will fail if a later migration adds a table without the same protection.
