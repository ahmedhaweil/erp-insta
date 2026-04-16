import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JournalPostedEvent } from '@modules/accounting/events/journal-posted.event';
import { NotificationsService } from '@modules/notifications/services/notifications.service';
import { NotificationType } from '@modules/notifications/entities/notification.entity';

@Injectable()
export class AccountingListener {
  private readonly logger = new Logger(AccountingListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent('journal.posted')
  async handleJournalPosted(event: JournalPostedEvent) {
    this.logger.log(
      `Journal entry ${event.refNumber} posted - Amount: ${event.totalAmount} [Tenant: ${event.tenantId}]`,
    );

    // Notify the user who posted it
    await this.notificationsService.create(event.tenantId, {
      userId: event.userId,
      title: 'Journal Entry Posted',
      body: `Journal entry ${event.refNumber} has been posted successfully (Amount: ${event.totalAmount.toFixed(2)})`,
      type: NotificationType.SUCCESS,
      data: { entryId: event.entryId, refNumber: event.refNumber },
    });
  }
}
