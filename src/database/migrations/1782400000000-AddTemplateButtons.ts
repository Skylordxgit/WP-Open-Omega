import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTemplateButtons1782400000000 implements MigrationInterface {
  name = 'AddTemplateButtons1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "buttonLabel" varchar(40)`);
      await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "buttonUrl" text`);
      return;
    }

    const table = await queryRunner.getTable('templates');
    if (!table) return;

    if (!table.findColumnByName('buttonLabel')) {
      await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN "buttonLabel" varchar(40)`);
    }
    if (!table.findColumnByName('buttonUrl')) {
      await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN "buttonUrl" text`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "buttonUrl"`);
      await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "buttonLabel"`);
      return;
    }

    const table = await queryRunner.getTable('templates');
    if (!table) return;

    if (table.findColumnByName('buttonUrl')) {
      await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN "buttonUrl"`);
    }
    if (table.findColumnByName('buttonLabel')) {
      await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN "buttonLabel"`);
    }
  }
}
