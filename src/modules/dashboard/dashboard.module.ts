import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Session } from '../session/entities/session.entity';
import { Message } from '../message/entities/message.entity';
import { MessageBatch } from '../message/entities/message-batch.entity';
import { SavedContact } from '../contact/entities/saved-contact.entity';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule, TypeOrmModule.forFeature([Session, Message, MessageBatch, SavedContact], 'data')],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
