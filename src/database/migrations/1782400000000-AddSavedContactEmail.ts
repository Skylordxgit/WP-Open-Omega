import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSavedContactEmail1782400000000 implements MigrationInterface {
  name = 'AddSavedContactEmail1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('saved_contacts');
    const hasEmail = table?.findColumnByName('email');

    if (hasEmail) {
      return;
    }

    const driver = queryRunner.connection.options.type;

    if (driver === 'postgres') {
      await queryRunner.query(`ALTER TABLE "saved_contacts" ADD COLUMN "email" varchar(180)`);
      return;
    }

    await queryRunner.query(`ALTER TABLE "saved_contacts" ADD COLUMN "email" varchar(180)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('saved_contacts');
    const hasEmail = table?.findColumnByName('email');

    if (!hasEmail) {
      return;
    }

    const driver = queryRunner.connection.options.type;

    if (driver === 'postgres') {
      await queryRunner.query(`ALTER TABLE "saved_contacts" DROP COLUMN "email"`);
      return;
    }

    await queryRunner.query(`ALTER TABLE "saved_contacts" DROP COLUMN "email"`);
  }
}
