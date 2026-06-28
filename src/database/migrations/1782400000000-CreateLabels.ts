import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLabels1782400000000 implements MigrationInterface {
  name = 'CreateLabels1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (!(await queryRunner.hasTable('labels'))) {
      if (isPostgres) {
        await queryRunner.query(
          `CREATE TABLE "labels" (` +
            `"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, ` +
            `"name" varchar(60) NOT NULL, ` +
            `"color" varchar(9) NOT NULL DEFAULT '#18b561', ` +
            `"createdAt" timestamp NOT NULL DEFAULT NOW(), ` +
            `"updatedAt" timestamp NOT NULL DEFAULT NOW())`,
        );
      } else {
        await queryRunner.query(
          `CREATE TABLE "labels" (` +
            `"id" varchar PRIMARY KEY NOT NULL, ` +
            `"name" varchar(60) NOT NULL, ` +
            `"color" varchar(9) NOT NULL DEFAULT '#18b561', ` +
            `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
            `"updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`,
        );
      }
    }

    if (!(await queryRunner.hasTable('chat_labels'))) {
      if (isPostgres) {
        await queryRunner.query(
          `CREATE TABLE "chat_labels" (` +
            `"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, ` +
            `"sessionId" varchar NOT NULL, ` +
            `"chatId" varchar NOT NULL, ` +
            `"labelId" varchar NOT NULL, ` +
            `"createdAt" timestamp NOT NULL DEFAULT NOW(), ` +
            `CONSTRAINT "UQ_chat_labels_session_chat_label" UNIQUE ("sessionId", "chatId", "labelId"), ` +
            `CONSTRAINT "FK_chat_labels_labelId" FOREIGN KEY ("labelId") REFERENCES "labels" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
      } else {
        await queryRunner.query(
          `CREATE TABLE "chat_labels" (` +
            `"id" varchar PRIMARY KEY NOT NULL, ` +
            `"sessionId" varchar NOT NULL, ` +
            `"chatId" varchar NOT NULL, ` +
            `"labelId" varchar NOT NULL, ` +
            `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
            `CONSTRAINT "UQ_chat_labels_session_chat_label" UNIQUE ("sessionId", "chatId", "labelId"), ` +
            `CONSTRAINT "FK_chat_labels_labelId" FOREIGN KEY ("labelId") REFERENCES "labels" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
      }
      await queryRunner.query(`CREATE INDEX "IDX_chat_labels_session_chat" ON "chat_labels" ("sessionId", "chatId")`);
      await queryRunner.query(`CREATE INDEX "IDX_chat_labels_label" ON "chat_labels" ("labelId")`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_chat_labels_label"`);
    await queryRunner.query(`DROP INDEX "IDX_chat_labels_session_chat"`);
    await queryRunner.query(`DROP TABLE "chat_labels"`);
    await queryRunner.query(`DROP TABLE "labels"`);
  }
}
