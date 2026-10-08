import { ArgumentsHost, ConflictException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  const run = (exception: unknown) => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/x', method: 'POST' }),
      }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
    return { status: (status.mock.calls[0] as unknown[])[0], body: json.mock.calls[0][0] };
  };
  const env = process.env.APP_ENV;
  afterEach(() => (process.env.APP_ENV = env));

  it('returns the http status, code and message', () => {
    const { status, body } = run(new NotFoundException('Invoice not found'));
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
  });

  it('exposes the approval request a blocked action waits on as structured fields', () => {
    const { body } = run(
      new ConflictException({ message: 'Approval required [approvalRequestId=r1]', approvalRequestId: 'r1', requestNumber: 'APR-1' }),
    );
    expect(body.error).toEqual(
      expect.objectContaining({ code: 'CONFLICT', approvalRequestId: 'r1', requestNumber: 'APR-1' }),
    );
  });

  it('hides internal error messages from clients in production', () => {
    process.env.APP_ENV = 'production';
    const { status, body } = run(new Error('relation "secret_table" does not exist'));
    expect(status).toBe(500);
    expect(body.error.message).toBe('Internal server error');
  });
});
