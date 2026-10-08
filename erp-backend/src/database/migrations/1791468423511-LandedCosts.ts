import { MigrationInterface, QueryRunner } from "typeorm";

export class LandedCosts1791468423511 implements MigrationInterface {
    name = 'LandedCosts1791468423511'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."landed_costs_status_enum" AS ENUM('draft', 'posted', 'cancelled')`);
        await queryRunner.query(`CREATE TYPE "public"."landed_costs_split_method_enum" AS ENUM('by_value', 'by_quantity', 'equal')`);
        await queryRunner.query(`CREATE TABLE "landed_costs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "tenant_id" uuid NOT NULL, "number" character varying NOT NULL, "date" date NOT NULL, "status" "public"."landed_costs_status_enum" NOT NULL DEFAULT 'draft', "split_method" "public"."landed_costs_split_method_enum" NOT NULL DEFAULT 'by_value', "purchase_order_ids" uuid array NOT NULL, "charges" jsonb NOT NULL, "total_amount" numeric(18,4) NOT NULL DEFAULT '0', "allocations" jsonb, "notes" character varying, "created_by" uuid NOT NULL, "posted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ec31473d4a7b3dab090875c7a75" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ae351553e4f78ca40584bc8a98" ON "landed_costs" ("tenant_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_ae351553e4f78ca40584bc8a98"`);
        await queryRunner.query(`DROP TABLE "landed_costs"`);
        await queryRunner.query(`DROP TYPE "public"."landed_costs_split_method_enum"`);
        await queryRunner.query(`DROP TYPE "public"."landed_costs_status_enum"`);
    }

}
