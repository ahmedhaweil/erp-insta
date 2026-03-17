import api from '@/lib/api';
import type { LoginRequest, LoginResponse, TwoFaResponse } from '@/types';

export const authService = {
  login: (data: LoginRequest) =>
    api.post<{ data: LoginResponse | TwoFaResponse }>('/auth/login', data).then((r) => r.data.data),

  verify2fa: (tempToken: string, code: string) =>
    api.post<{ data: LoginResponse }>('/auth/2fa/verify', { tempToken, code }).then((r) => r.data.data),

  refresh: (refreshToken: string) =>
    api.post<{ data: LoginResponse }>('/auth/refresh', { refreshToken }).then((r) => r.data.data),

  logout: () => api.post('/auth/logout'),
};
