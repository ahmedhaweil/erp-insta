import { MigrationInterface, QueryRunner } from "typeorm";

export class OptionalPartnerContacts1791471898450 implements MigrationInterface {
    name = 'OptionalPartnerContacts1791471898450'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "customers" ALTER COLUMN "name_en" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "name_en" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "phone" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "address" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "city" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "country" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "country" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "city" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "address" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "phone" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "suppliers" ALTER COLUMN "name_en" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "customers" ALTER COLUMN "phone" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "customers" ALTER COLUMN "name_en" SET NOT NULL`);
    }

}
