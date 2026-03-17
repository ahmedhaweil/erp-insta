import api from '@/lib/api';
import type { Notification, ApiResponse } from '@/types';

export const notificationsService = {
  getMyNotifications: () =>
    api.get<ApiResponse<Notification[]>>('/notifications/my').then((r) => r.data.data),

  markAsRead: (id: string) =>
    api.patch(`/notifications/${id}/read`).then((r) => r.data),

  markAllRead: () =>
    api.patch('/notifications/read-all').then((r) => r.data),
};
