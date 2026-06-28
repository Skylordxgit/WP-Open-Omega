import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * A reusable chat label (e.g. "VIP", "Customer"). Labels are global — the list
 * is shared across sessions — while assignment is scoped per session+chat via
 * the {@link ChatLabel} join row.
 */
@Entity('labels')
export class Label {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  /** Hex color (e.g. #18b561). */
  @Column({ type: 'varchar', length: 9, default: '#18b561' })
  color: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
