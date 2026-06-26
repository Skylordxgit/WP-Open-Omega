import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import type { DashboardAnalytics } from './dashboard.service';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('analytics')
  @ApiOperation({ summary: 'Messaging analytics for a single day (defaults to today, server timezone)' })
  @ApiQuery({ name: 'date', required: false, description: 'Day to analyze, YYYY-MM-DD (server timezone). Defaults to today.' })
  getAnalytics(@Query('date') date?: string): Promise<DashboardAnalytics> {
    return this.dashboardService.getAnalytics(date);
  }
}
