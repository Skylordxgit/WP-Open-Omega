import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ChatLabelService } from './chat-label.service';
import { CreateLabelDto, UpdateLabelDto, AssignLabelDto } from './dto/label.dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('chat-labels')
@Controller('labels')
export class ChatLabelController {
  constructor(private readonly service: ChatLabelService) {}

  @Get()
  @ApiOperation({ summary: 'List all labels' })
  list() {
    return this.service.listLabels();
  }

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Create a label' })
  create(@Body() dto: CreateLabelDto) {
    return this.service.createLabel(dto);
  }

  @Patch(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Update a label (name/color)' })
  update(@Param('id') id: string, @Body() dto: UpdateLabelDto) {
    return this.service.updateLabel(id, dto);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Delete a label (and all its assignments)' })
  remove(@Param('id') id: string) {
    return this.service.deleteLabel(id);
  }

  @Post('assign')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Assign a label to a chat (scoped by session + chat)' })
  assign(@Body() dto: AssignLabelDto) {
    return this.service.assign(dto.sessionId, dto.chatId, dto.labelId);
  }

  @Post('unassign')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Remove a label from a chat' })
  unassign(@Body() dto: AssignLabelDto) {
    return this.service.unassign(dto.sessionId, dto.chatId, dto.labelId);
  }

  @Get('assignments')
  @ApiOperation({ summary: 'All chat→label assignments across sessions (merged inbox chips)' })
  allAssignments() {
    return this.service.allAssignments();
  }

  @Get('chat')
  @ApiOperation({ summary: 'List labels for a specific chat' })
  @ApiQuery({ name: 'sessionId', required: true })
  @ApiQuery({ name: 'chatId', required: true })
  forChat(@Query('sessionId') sessionId: string, @Query('chatId') chatId: string) {
    return this.service.labelsForChat(sessionId, chatId);
  }

  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Map of chat → labels for a whole session' })
  forSession(@Param('sessionId') sessionId: string) {
    return this.service.labelsForSession(sessionId);
  }

  @Get(':id/chats')
  @ApiOperation({ summary: 'List chats carrying a given label (for filtering)' })
  chatsForLabel(@Param('id') id: string) {
    return this.service.chatsForLabel(id);
  }
}
