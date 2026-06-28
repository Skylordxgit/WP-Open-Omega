import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactResolverService } from './contact-resolver.service';
import { SavedContact } from '../contact/entities/saved-contact.entity';

/**
 * Standalone module exposing the shared ContactResolverService. Deliberately
 * depends only on the SavedContact repository (no SessionModule) so both
 * SessionModule and DashboardModule can import it without a circular graph.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SavedContact], 'data')],
  providers: [ContactResolverService],
  exports: [ContactResolverService],
})
export class ContactResolverModule {}
