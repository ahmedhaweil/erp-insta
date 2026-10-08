/** Non-2xx answer from an ETA endpoint. */
export class EtaApiError extends Error {
  constructor(
    readonly status: number,
    readonly data: any,
  ) {
    super(EtaApiError.describe(status, data));
  }

  /** 4xx other than auth/throttling: the request itself is wrong. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500 && ![401, 403, 408, 429].includes(this.status);
  }

  private static describe(status: number, data: any): string {
    const detail =
      data?.error?.message ||
      data?.error_description ||
      (typeof data?.error === 'string' ? data.error : '') ||
      data?.message ||
      (typeof data === 'string' ? data.slice(0, 200) : '');
    return `ETA responded with HTTP ${status}${detail ? `: ${detail}` : ''}`;
  }
}
