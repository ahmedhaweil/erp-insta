import axios from 'axios';

/** Window event fired when an action returns 409 with error.approvalRequestId. */
export const APPROVAL_EVENT = 'erp:approval-required';
export interface ApprovalEventDetail {
  id: string;
  requestNumber?: string;
  message?: string;
}

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // An action blocked by the approval engine (409 with the request id): let
    // the layout show a toast linking to the approval request.
    const apiErr = error.response?.data?.error;
    if (error.response?.status === 409 && apiErr?.approvalRequestId && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(APPROVAL_EVENT, {
          detail: { id: apiErr.approvalRequestId, requestNumber: apiErr.requestNumber, message: apiErr.message },
        }),
      );
    }
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          const { data } = await axios.post(
            `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1'}/auth/refresh`,
            { refreshToken },
          );
          localStorage.setItem('accessToken', data.data.accessToken);
          localStorage.setItem('refreshToken', data.data.refreshToken);
          error.config.headers.Authorization = `Bearer ${data.data.accessToken}`;
          return api(error.config);
        } catch {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.location.href = '/ar/login';
        }
      }
    }
    return Promise.reject(error);
  },
);

export default api;
