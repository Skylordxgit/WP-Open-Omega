import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

/**
 * Assignment of a {@link Label} to a specific chat on a specific session. Scoped
 * by (sessionId, chatId) so the same chatId on two different sessions does NOT
 * share labels. The (sessionId, chatId, labelId) triple is unique.
 */
@Entity('chat_labels')
@Unique('UQ_chat_labels_session_chat_label', ['sessionId', 'chatId', 'labelId'])
@Index('IDX_chat_labels_session_chat', ['sessionId', 'chatId'])
@Index('IDX_chat_labels_label', ['labelId'])
export class ChatLabel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  sessionId: string;

  @Column({ type: 'varchar' })
  chatId: string;

  @Column({ type: 'uuid' })
  labelId: string;

  @CreateDateColumn()
  createdAt: Date;
}
