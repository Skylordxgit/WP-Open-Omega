import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatLabelController } from './chat-label.controller';
import { ChatLabelService } from './chat-label.service';
import { Label } from './entities/label.entity';
import { ChatLabel } from './entities/chat-label.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Label, ChatLabel], 'data')],
  controllers: [ChatLabelController],
  providers: [ChatLabelService],
  exports: [ChatLabelService],
})
export class ChatLabelModule {}
