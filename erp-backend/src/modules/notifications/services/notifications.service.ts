import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { CreateNotificationDto } from '../dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  async create(
    tenantId: string,
    dto: CreateNotificationDto,
  ): Promise<Notification> {
    const notification = this.notificationRepo.create({
      ...dto,
      tenantId,
    });
    return this.notificationRepo.save(notification);
  }

  async findByUser(
    tenantId: string,
    userId: string,
  ): Promise<Notification[]> {
    return this.notificationRepo.find({
      where: { tenantId, userId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async markAsRead(
    tenantId: string,
    id: string,
    userId?: string,
  ): Promise<Notification> {
    const where: Record<string, string> = { id, tenantId };
    // Users may only mark their own notifications
    if (userId) where.userId = userId;
    const notification = await this.notificationRepo.findOne({ where });
    if (!notification) throw new NotFoundException('Notification not found');

    notification.isRead = true;
    notification.readAt = new Date();
    return this.notificationRepo.save(notification);
  }

  countUnread(tenantId: string, userId: string): Promise<number> {
    return this.notificationRepo.count({ where: { tenantId, userId, isRead: false } });
  }

  async markAllRead(
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await this.notificationRepo.update(
      { tenantId, userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );
  }
}
