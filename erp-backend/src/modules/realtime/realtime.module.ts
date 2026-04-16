import { Module } from '@nestjs/common';
import { EventsGateway } from './gateways/events.gateway';

@Module({
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class RealtimeModule {}
