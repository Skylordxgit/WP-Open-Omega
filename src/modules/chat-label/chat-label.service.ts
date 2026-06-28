import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Label } from './entities/label.entity';
import { ChatLabel } from './entities/chat-label.entity';
import { CreateLabelDto, UpdateLabelDto } from './dto/label.dto';

/**
 * Persistent, DB-backed chat label system. Labels are a global reusable list;
 * assignments are scoped per (sessionId, chatId) so the same chatId on two
 * different sessions never shares labels. Distinct from the engine-backed
 * WhatsApp-Business LabelService (sessions/:id/labels).
 */
@Injectable()
export class ChatLabelService {
  constructor(
    @InjectRepository(Label, 'data')
    private readonly labelRepo: Repository<Label>,
    @InjectRepository(ChatLabel, 'data')
    private readonly chatLabelRepo: Repository<ChatLabel>,
  ) {}

  // ── Label CRUD ──────────────────────────────────────────────────────

  listLabels(): Promise<Label[]> {
    return this.labelRepo.find({ order: { createdAt: 'ASC' } });
  }

  createLabel(dto: CreateLabelDto): Promise<Label> {
    const label = this.labelRepo.create({ name: dto.name.trim(), color: dto.color || '#18b561' });
    return this.labelRepo.save(label);
  }

  async updateLabel(id: string, dto: UpdateLabelDto): Promise<Label> {
    const label = await this.labelRepo.findOne({ where: { id } });
    if (!label) throw new NotFoundException(`Label ${id} not found`);
    if (dto.name !== undefined) label.name = dto.name.trim();
    if (dto.color !== undefined) label.color = dto.color;
    return this.labelRepo.save(label);
  }

  async deleteLabel(id: string): Promise<{ success: true }> {
    const label = await this.labelRepo.findOne({ where: { id } });
    if (!label) throw new NotFoundException(`Label ${id} not found`);
    // Explicitly clear assignments (SQLite FK enforcement may be off).
    await this.chatLabelRepo.delete({ labelId: id });
    await this.labelRepo.remove(label);
    return { success: true };
  }

  // ── Assignment (scoped by sessionId + chatId) ───────────────────────

  async assign(sessionId: string, chatId: string, labelId: string): Promise<ChatLabel> {
    const label = await this.labelRepo.findOne({ where: { id: labelId } });
    if (!label) throw new NotFoundException(`Label ${labelId} not found`);

    const existing = await this.chatLabelRepo.findOne({ where: { sessionId, chatId, labelId } });
    if (existing) throw new ConflictException('Label already assigned to this chat');

    return this.chatLabelRepo.save(this.chatLabelRepo.create({ sessionId, chatId, labelId }));
  }

  async unassign(sessionId: string, chatId: string, labelId: string): Promise<{ success: true }> {
    await this.chatLabelRepo.delete({ sessionId, chatId, labelId });
    return { success: true };
  }

  /** Labels assigned to one chat on one session, in assignment order. */
  async labelsForChat(sessionId: string, chatId: string): Promise<Label[]> {
    const assignments = await this.chatLabelRepo.find({ where: { sessionId, chatId }, order: { createdAt: 'ASC' } });
    if (assignments.length === 0) return [];
    const labels = await this.labelRepo.find({ where: { id: In(assignments.map(a => a.labelId)) } });
    const byId = new Map(labels.map(l => [l.id, l]));
    return assignments.map(a => byId.get(a.labelId)).filter((l): l is Label => !!l);
  }

  /** `${sessionId}::${chatId}` → labels for a whole session (chip rendering in one call). */
  async labelsForSession(sessionId: string): Promise<Record<string, Label[]>> {
    const assignments = await this.chatLabelRepo.find({ where: { sessionId }, order: { createdAt: 'ASC' } });
    if (assignments.length === 0) return {};
    const labels = await this.labelRepo.find();
    const byId = new Map(labels.map(l => [l.id, l]));
    const result: Record<string, Label[]> = {};
    for (const a of assignments) {
      const label = byId.get(a.labelId);
      if (!label) continue;
      (result[`${a.sessionId}::${a.chatId}`] ??= []).push(label);
    }
    return result;
  }

  /** All assignments across every session, keyed `${sessionId}::${chatId}` (merged inbox chips). */
  async allAssignments(): Promise<Record<string, Label[]>> {
    const assignments = await this.chatLabelRepo.find({ order: { createdAt: 'ASC' } });
    if (assignments.length === 0) return {};
    const labels = await this.labelRepo.find();
    const byId = new Map(labels.map(l => [l.id, l]));
    const result: Record<string, Label[]> = {};
    for (const a of assignments) {
      const label = byId.get(a.labelId);
      if (!label) continue;
      (result[`${a.sessionId}::${a.chatId}`] ??= []).push(label);
    }
    return result;
  }

  /** Chats (sessionId+chatId) carrying a given label — used by the label filter. */
  async chatsForLabel(labelId: string): Promise<Array<{ sessionId: string; chatId: string }>> {
    const assignments = await this.chatLabelRepo.find({ where: { labelId } });
    return assignments.map(a => ({ sessionId: a.sessionId, chatId: a.chatId }));
  }
}
