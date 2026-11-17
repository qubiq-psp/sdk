import { Global, Module } from '@nestjs/common';
import { RequestLogController } from './request-log.controller';
import { RequestLogService } from './request-log.service';

/** Global: the SDK client (PspModule) records through it, the SSE stream reads it. */
@Global()
@Module({
  controllers: [RequestLogController],
  providers: [RequestLogService],
  exports: [RequestLogService],
})
export class RequestLogModule {}
