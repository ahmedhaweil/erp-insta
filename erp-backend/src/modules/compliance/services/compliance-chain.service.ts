import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComplianceChain } from '../entities/compliance-chain.entity';

/**
 * Sequential chains (ZATCA ICV/PIH, ETA e-receipt previousUUID). The row is
 * locked FOR UPDATE so concurrent submissions of the same tenant/device are
 * serialized by the request transaction.
 */
@Injectable()
export class ComplianceChainService {
  constructor(
    @InjectRepository(ComplianceChain)
    private readonly chainRepo: Repository<ComplianceChain>,
  ) {}

  async lock(tenantId: string, chainKey: string): Promise<ComplianceChain> {
    await this.chainRepo
      .createQueryBuilder()
      .insert()
      .into(ComplianceChain)
      .values({ tenantId, chainKey, counter: 0, lastHash: null })
      .orIgnore()
      .execute();
    return this.chainRepo
      .createQueryBuilder('c')
      .setLock('pessimistic_write')
      .where('c.tenant_id = :tenantId AND c.chain_key = :chainKey', { tenantId, chainKey })
      .getOneOrFail();
  }

  /** Current state without locking (previews). */
  async peek(tenantId: string, chainKey: string): Promise<{ counter: number; lastHash: string | null }> {
    const row = await this.chainRepo.findOne({ where: { tenantId, chainKey } });
    return { counter: row?.counter || 0, lastHash: row?.lastHash ?? null };
  }

  save(chain: ComplianceChain): Promise<ComplianceChain> {
    return this.chainRepo.save(chain);
  }
}
