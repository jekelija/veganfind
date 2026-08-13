ALTER TABLE "flags" DROP CONSTRAINT "flags_submission_id_vegan_submissions_id_fk";
--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_submission_id_vegan_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."vegan_submissions"("id") ON DELETE set null ON UPDATE no action;