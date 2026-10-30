import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@smart-finance/shared-types';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ErrorAlert, FieldError, Modal, PageHeader, PasswordInput } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, downloadFile, errorMessage } from '../lib/api';

const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Nhập tên hiển thị').max(80, 'Tối đa 80 ký tự'),
  timezone: z.string().trim().min(1, 'Chọn múi giờ').max(64),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/, 'Tiền tệ phải là 3 ký tự, ví dụ VND'),
  allowAiResearch: z.boolean(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

const deleteSchema = z.object({
  password: z.string().min(1, 'Nhập mật khẩu để xác nhận'),
});

type DeleteFormValues = z.infer<typeof deleteSchema>;

const TIMEZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'UTC',
  'Europe/London',
  'America/New_York',
];

const CURRENCIES = ['VND', 'USD', 'EUR', 'JPY', 'SGD'];

export function SettingsPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.displayName ?? '',
      timezone: user?.timezone ?? 'Asia/Ho_Chi_Minh',
      defaultCurrency: user?.defaultCurrency ?? 'VND',
      allowAiResearch: user?.allowAiResearch ?? false,
    },
  });

  const deleteForm = useForm<DeleteFormValues>({
    resolver: zodResolver(deleteSchema),
    defaultValues: { password: '' },
  });

  const saveProfile = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      api.patch<{ user: UserDto }>('/users/me', {
        ...values,
        defaultCurrency: values.defaultCurrency.toUpperCase(),
      }),
    onSuccess: async () => {
      await refresh();
      setProfileNotice('Đã lưu hồ sơ.');
    },
  });

  const deleteAccount = useMutation({
    mutationFn: (password: string) => api.delete('/users/me', { password }),
    onSuccess: async () => {
      queryClient.clear();
      await refresh();
      navigate('/login', { replace: true });
    },
  });

  async function onSubmitProfile(values: ProfileFormValues) {
    setProfileError(null);
    setProfileNotice(null);
    try {
      await saveProfile.mutateAsync(values);
    } catch (error) {
      setProfileError(errorMessage(error));
    }
  }

  async function handleExport() {
    if (exporting) return;
    setExportError(null);
    setExporting(true);
    try {
      await downloadFile('/users/me/export', 'smart-finance-data.json');
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  async function onSubmitDelete(values: DeleteFormValues) {
    setDeleteError(null);
    try {
      await deleteAccount.mutateAsync(values.password);
    } catch (error) {
      setDeleteError(errorMessage(error));
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Cài đặt"
        description="Thông tin hồ sơ, dữ liệu cá nhân và tuỳ chọn hiển thị."
      />

      <section className="card mb-6" aria-labelledby="profile-heading">
        <div className="card-header">
          <div className="min-w-0">
            <h2 id="profile-heading" className="card-title">
              Hồ sơ
            </h2>
            <p className="mt-1 break-words text-sm text-ink-muted">
              Email đăng nhập: {user?.email}
            </p>
          </div>
        </div>
        {profileError ? (
          <div className="mt-4">
            <ErrorAlert message={profileError} />
          </div>
        ) : null}
        {profileNotice ? (
          <p
            role="status"
            className="mt-4 rounded-xl border border-brand/30 bg-brand-soft p-3 text-sm text-brand-hover"
          >
            {profileNotice}
          </p>
        ) : null}
        <form
          className="mt-4 space-y-4"
          onSubmit={profileForm.handleSubmit(onSubmitProfile)}
          noValidate
          aria-busy={profileForm.formState.isSubmitting}
        >
          <div>
            <label className="label" htmlFor="displayName">
              Tên hiển thị
            </label>
            <input
              id="displayName"
              autoComplete="name"
              className="input"
              aria-invalid={profileForm.formState.errors.displayName ? true : undefined}
              aria-describedby={
                profileForm.formState.errors.displayName ? 'displayName-error' : undefined
              }
              {...profileForm.register('displayName')}
            />
            <FieldError
              id="displayName-error"
              message={profileForm.formState.errors.displayName?.message}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="timezone">
                Múi giờ
              </label>
              <select
                id="timezone"
                className="input"
                aria-invalid={profileForm.formState.errors.timezone ? true : undefined}
                aria-describedby={
                  profileForm.formState.errors.timezone ? 'timezone-error' : undefined
                }
                {...profileForm.register('timezone')}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <FieldError
                id="timezone-error"
                message={profileForm.formState.errors.timezone?.message}
              />
            </div>
            <div>
              <label className="label" htmlFor="defaultCurrency">
                Tiền tệ mặc định
              </label>
              <select
                id="defaultCurrency"
                className="input"
                aria-invalid={profileForm.formState.errors.defaultCurrency ? true : undefined}
                aria-describedby={
                  profileForm.formState.errors.defaultCurrency ? 'defaultCurrency-error' : undefined
                }
                {...profileForm.register('defaultCurrency')}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
              <FieldError
                id="defaultCurrency-error"
                message={profileForm.formState.errors.defaultCurrency?.message}
              />
            </div>
          </div>
          <label
            htmlFor="allowAiResearch"
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-muted p-4 transition focus-within:ring-2 focus-within:ring-brand/50"
          >
            <input
              id="allowAiResearch"
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-line-strong"
              {...profileForm.register('allowAiResearch')}
            />
            <span className="text-sm text-ink-secondary">
              <span className="font-medium text-ink">
                Cho phép dùng phản hồi AI đã ẩn danh để cải thiện mô hình
              </span>
              <span className="mt-1 block">
                Khi bật, mô tả giao dịch bạn đã chấp nhận hoặc sửa danh mục có thể được xuất để huấn
                luyện. Email, số điện thoại và số tài khoản được loại bỏ trước khi xuất. Mặc định
                tắt.
              </span>
            </span>
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              className="btn-primary"
              disabled={profileForm.formState.isSubmitting}
            >
              {profileForm.formState.isSubmitting ? 'Đang lưu...' : 'Lưu hồ sơ'}
            </button>
          </div>
        </form>
      </section>

      <section className="card mb-6" aria-labelledby="data-heading">
        <div className="card-header">
          <div className="min-w-0">
            <h2 id="data-heading" className="card-title">
              Dữ liệu của bạn
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Tải xuống toàn bộ tài khoản, giao dịch, ngân sách và mục tiêu dưới dạng JSON.
            </p>
          </div>
        </div>
        {exportError ? (
          <div className="mt-4">
            <ErrorAlert message={exportError} />
          </div>
        ) : null}
        <button
          type="button"
          className="btn-secondary mt-4"
          onClick={() => void handleExport()}
          disabled={exporting}
        >
          <Download className="h-4 w-4" aria-hidden />
          {exporting ? 'Đang xuất...' : 'Xuất dữ liệu JSON'}
        </button>
      </section>

      <section className="card border-danger-border" aria-labelledby="danger-heading">
        <h2
          id="danger-heading"
          className="flex items-center gap-2 text-base font-semibold text-danger-strong"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden /> Vùng nguy hiểm
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Xoá tài khoản sẽ xoá vĩnh viễn mọi giao dịch, ngân sách và mục tiêu. Không thể hoàn tác.
        </p>
        <button
          type="button"
          className="btn-danger mt-4"
          onClick={() => {
            setDeleteError(null);
            deleteForm.reset({ password: '' });
            setDeleteOpen(true);
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden /> Xoá tài khoản
        </button>
      </section>

      <Modal
        open={deleteOpen}
        title="Xác nhận xoá tài khoản"
        onClose={() => {
          if (deleteAccount.isPending) return;
          setDeleteOpen(false);
          setDeleteError(null);
        }}
      >
        <form className="space-y-4" onSubmit={deleteForm.handleSubmit(onSubmitDelete)} noValidate>
          {deleteError ? <ErrorAlert message={deleteError} /> : null}
          <p className="text-sm text-ink-secondary">
            Hành động này không thể hoàn tác. Nhập mật khẩu hiện tại để xác nhận.
          </p>
          <div>
            <label className="label" htmlFor="deletePassword">
              Mật khẩu
            </label>
            <PasswordInput
              id="deletePassword"
              autoComplete="current-password"
              aria-invalid={deleteForm.formState.errors.password ? true : undefined}
              aria-describedby={
                deleteForm.formState.errors.password ? 'deletePassword-error' : undefined
              }
              {...deleteForm.register('password')}
            />
            <FieldError
              id="deletePassword-error"
              message={deleteForm.formState.errors.password?.message}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteError(null);
              }}
              disabled={deleteAccount.isPending}
            >
              Huỷ
            </button>
            <button type="submit" className="btn-danger" disabled={deleteAccount.isPending}>
              {deleteAccount.isPending ? 'Đang xoá...' : 'Xoá vĩnh viễn'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
