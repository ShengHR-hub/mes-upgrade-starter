import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * AI 问答日志实体（契约 §4 / db/schema.sql 表 `ai_query_log`）。
 * 记录 Text-to-SQL 问数、RAG 问答、日报生成与根因分析的审计与消耗成本。
 */
@Entity('ai_query_log')
@Index('idx_aiq_user', ['userId', 'createdAt'])
export class AiQueryLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  kind!: string; // nl_query | rag | report | root_cause

  @Column({ type: 'text' })
  question!: string;

  @Column({ name: 'sql_generated', type: 'text', nullable: true })
  sqlGenerated!: string | null;

  @Column({ type: 'text', nullable: true })
  answer!: string | null;

  @Column({ name: 'tokens_in', type: 'int', default: 0 })
  tokensIn!: number;

  @Column({ name: 'tokens_out', type: 'int', default: 0 })
  tokensOut!: number;

  @Column({ name: 'latency_ms', type: 'int', default: 0 })
  latencyMs!: number;

  @Column({ type: 'varchar', length: 16, default: '成功' })
  status!: string; // 成功 | 失败 | 降级

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
