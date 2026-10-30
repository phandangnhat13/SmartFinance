import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { chatErrorMessage } from './ai-chat-shared';

const apiError = (status: number, body: Record<string, unknown> | null = null) =>
  new ApiError(status, body, `Yêu cầu thất bại (${status})`);

describe('chatErrorMessage', () => {
  it('keeps safe validation detail from the backend', () => {
    expect(
      chatErrorMessage(
        apiError(400, { code: 'VALIDATION_FAILED', message: 'Nội dung vượt quá giới hạn' }),
      ),
    ).toBe('Nội dung vượt quá giới hạn');
    expect(chatErrorMessage(apiError(422, { message: 'Tiền tệ không hợp lệ' }))).toBe(
      'Tiền tệ không hợp lệ',
    );
  });

  it('distinguishes an expired session from a permission problem', () => {
    expect(chatErrorMessage(apiError(401))).toBe(
      'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.',
    );
    expect(chatErrorMessage(apiError(403))).toBe(
      'Bạn không có quyền truy cập cuộc trò chuyện này.',
    );
  });

  it('explains a conversation that no longer exists', () => {
    expect(chatErrorMessage(apiError(404))).toBe(
      'Cuộc trò chuyện không còn tồn tại. Hãy bắt đầu cuộc trò chuyện mới.',
    );
  });

  it('keeps the retry hint for a rate limit', () => {
    expect(chatErrorMessage(new ApiError(429, null, 'too many', 25))).toBe(
      'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 25 giây.',
    );
  });

  it('separates a provider outage from other server failures', () => {
    for (const status of [502, 503, 504]) {
      expect(chatErrorMessage(apiError(status))).toBe(
        'Dịch vụ AI tạm thời không phản hồi. Vui lòng thử lại sau ít phút.',
      );
    }
    expect(chatErrorMessage(apiError(500))).toBe(
      'Trợ lý AI đang gặp sự cố. Vui lòng thử lại sau ít phút.',
    );
  });

  it('reports a connection failure instead of a server error', () => {
    expect(chatErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'Không kết nối được tới trợ lý AI. Kiểm tra kết nối mạng và thử lại.',
    );
  });
});
