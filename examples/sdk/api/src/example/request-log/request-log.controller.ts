// Example plumbing: the request log of the contract — `GET /api/request-log`, one entry, clear.
import { Controller, Delete, Get, HttpCode, Inject, Param, Query } from '@nestjs/common';
import { RequestLogService } from './request-log.service';
import type { RequestLogEntry, RequestLogPage } from './request-log.types';

@Controller('api/request-log')
export class RequestLogController {
  constructor(@Inject(RequestLogService) private readonly requestLog: RequestLogService) {}

  @Get()
  list(@Query() query: Record<string, unknown>): RequestLogPage {
    return this.requestLog.list(query);
  }

  @Get(':entryId')
  get(@Param('entryId') entryId: string): RequestLogEntry {
    return this.requestLog.get(entryId);
  }

  @Delete()
  @HttpCode(204)
  clear(): void {
    this.requestLog.clear();
  }
}
