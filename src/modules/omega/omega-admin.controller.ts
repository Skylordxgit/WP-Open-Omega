import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipApiKeyAuth } from '../auth/decorators/auth.decorators';
import { RequireOmegaRoles } from './decorators/omega-auth.decorators';
import {
  AssignOmegaSessionDto,
  CreateOmegaClientDto,
  CreateOmegaPlanDto,
  CreateOmegaUserDto,
  UpdateOmegaClientDto,
  UpdateOmegaPlanDto,
  UpdateOmegaUserDto,
} from './dto';
import { OmegaUserRole } from './entities';
import { OmegaAuthGuard } from './guards/omega-auth.guard';
import { OmegaRolesGuard } from './guards/omega-roles.guard';
import { OmegaAdminService } from './omega-admin.service';

@ApiTags('omega-admin')
@Controller('omega')
@SkipApiKeyAuth()
@UseGuards(OmegaAuthGuard, OmegaRolesGuard)
export class OmegaAdminController {
  constructor(private readonly omegaAdminService: OmegaAdminService) {}

  @Get('admin/dashboard')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  getDashboard() {
    return this.omegaAdminService.getDashboardSummary();
  }

  @Get('admin/usage')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  getUsage() {
    return this.omegaAdminService.getUsageOverview();
  }

  @Get('admin/settings')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  getSettings() {
    return this.omegaAdminService.getSettings();
  }

  @Get('clients')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  listClients() {
    return this.omegaAdminService.listClients();
  }

  @Post('clients')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  createClient(@Body() dto: CreateOmegaClientDto) {
    return this.omegaAdminService.createClient(dto);
  }

  @Get('clients/:id')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  getClient(@Param('id') id: string) {
    return this.omegaAdminService.getClientById(id);
  }

  @Patch('clients/:id')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  updateClient(@Param('id') id: string, @Body() dto: UpdateOmegaClientDto) {
    return this.omegaAdminService.updateClient(id, dto);
  }

  @Get('plans')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  listPlans() {
    return this.omegaAdminService.listPlans();
  }

  @Post('plans')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN)
  createPlan(@Body() dto: CreateOmegaPlanDto) {
    return this.omegaAdminService.createPlan(dto);
  }

  @Patch('plans/:id')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN)
  updatePlan(@Param('id') id: string, @Body() dto: UpdateOmegaPlanDto) {
    return this.omegaAdminService.updatePlan(id, dto);
  }

  @Get('sessions')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  listSessions() {
    return this.omegaAdminService.listSessions();
  }

  @Post('sessions/assign')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  assignSession(@Body() dto: AssignOmegaSessionDto) {
    return this.omegaAdminService.assignSession(dto);
  }

  @Post('sessions/mock-sync')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  syncMockSessions() {
    return this.omegaAdminService.syncMockSessions();
  }

  @Get('users')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN, OmegaUserRole.SUPPORT_ADMIN)
  listUsers() {
    return this.omegaAdminService.listUsers();
  }

  @Post('users')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN)
  createUser(@Body() dto: CreateOmegaUserDto) {
    return this.omegaAdminService.createUser(dto);
  }

  @Patch('users/:id')
  @RequireOmegaRoles(OmegaUserRole.SUPER_ADMIN)
  updateUser(@Param('id') id: string, @Body() dto: UpdateOmegaUserDto) {
    return this.omegaAdminService.updateUser(id, dto);
  }
}
