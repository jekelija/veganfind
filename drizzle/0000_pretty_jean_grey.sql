CREATE TABLE "osm_raw" (
	"osm_id" text PRIMARY KEY NOT NULL,
	"tags" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_scores" (
	"place_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"score" real NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osm_id" text,
	"google_place_id" text,
	"name" text NOT NULL,
	"address" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"source" text NOT NULL,
	"osm_diet_vegan" text,
	"osm_diet_vegetarian" text,
	"cuisine" text,
	"closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_osm_id_unique" UNIQUE("osm_id"),
	CONSTRAINT "places_google_place_id_unique" UNIQUE("google_place_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"trust_score" real DEFAULT 1 NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vegan_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "place_scores" ADD CONSTRAINT "place_scores_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vegan_submissions" ADD CONSTRAINT "vegan_submissions_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vegan_submissions" ADD CONSTRAINT "vegan_submissions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_submission_id_vegan_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."vegan_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "places_lat_lng_idx" ON "places" USING btree ("lat","lng");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_place_user_uq" ON "vegan_submissions" USING btree ("place_id","user_id");--> statement-breakpoint
CREATE INDEX "submissions_place_idx" ON "vegan_submissions" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_submission_user_uq" ON "votes" USING btree ("submission_id","user_id");--> statement-breakpoint
CREATE INDEX "votes_submission_idx" ON "votes" USING btree ("submission_id");