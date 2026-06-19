import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  OmegaAuthSession,
  OmegaCampaign,
  OmegaCampaignRecipient,
  OmegaClient,
  OmegaContact,
  OmegaContactGroup,
  OmegaMessage,
  OmegaPlan,
  OmegaSubscription,
  OmegaUsageLog,
  OmegaUser,
  OmegaWhatsappSession,
} from './entities';
import { OmegaAuthController } from './omega-auth.controller';
import { OmegaAdminController } from './omega-admin.controller';
import { OmegaAdminService } from './omega-admin.service';
import { OmegaAuthService } from './omega-auth.service';
import { OmegaAuthGuard } from './guards/omega-auth.guard';
import { OmegaRolesGuard } from './guards/omega-roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        OmegaUser,
        OmegaClient,
        OmegaPlan,
        OmegaWhatsappSession,
        OmegaContact,
        OmegaContactGroup,
        OmegaCampaign,
        OmegaCampaignRecipient,
        OmegaMessage,
        OmegaUsageLog,
        OmegaSubscription,
        OmegaAuthSession,
      ],
      'main',
    ),
  ],
  controllers: [OmegaAuthController, OmegaAdminController],
  providers: [OmegaAuthService, OmegaAdminService, OmegaAuthGuard, OmegaRolesGuard],
})
export class OmegaModule {}
