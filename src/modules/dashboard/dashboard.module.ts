import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Session } from '../session/entities/session.entity';
import { Message } from '../message/entities/message.entity';
import { MessageBatch } from '../message/entities/message-batch.entity';
import { SessionModule } from '../session/session.module';
import { ContactResolverModule } from '../contact-resolver/contact-resolver.module';

@Module({
  imports: [
    SessionModule,
    ContactResolverModule,
    TypeOrmModule.forFeature([Session, Message, MessageBatch], 'data'),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
