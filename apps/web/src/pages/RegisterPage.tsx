import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorAlert, FieldError, PasswordInput } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/api';

const schema = z
  .object({
    displayName: z.string().trim().max(80, 'Tối đa 80 ký tự').optional(),
    email: z.string().trim().email('Email không hợp lệ'),
    password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự').max(72, 'Tối đa 72 ký tự'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Mật khẩu xác nhận không khớp',
  });

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const { user, register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: '', email: '', password: '', confirmPassword: '' },
  });

  if (user) return <Navigate to="/dashboard" replace />;

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await registerUser({
        email: values.email,
        password: values.password,
        displayName: values.displayName?.trim() || undefined,
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <AuthLayout>
      <div className="card">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Tạo tài khoản</h1>
        <p className="mt-1 text-sm text-ink-muted">Bắt đầu theo dõi dòng tiền trong vài phút.</p>

        {error ? (
          <div className="mt-4">
            <ErrorAlert message={error} />
          </div>
        ) : null}

        <form
          className="mt-5 space-y-4"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          aria-busy={isSubmitting}
        >
          <div>
            <label className="label" htmlFor="displayName">
              Tên hiển thị
            </label>
            <input
              id="displayName"
              autoComplete="name"
              className="input"
              placeholder="Nguyễn Văn An"
              aria-invalid={errors.displayName ? true : undefined}
              aria-describedby={errors.displayName ? 'displayName-error' : undefined}
              disabled={isSubmitting}
              {...register('displayName')}
            />
            <FieldError id="displayName-error" message={errors.displayName?.message} />
          </div>
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="input"
              placeholder="ban@example.com"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'email-error' : undefined}
              disabled={isSubmitting}
              {...register('email')}
            />
            <FieldError id="email-error" message={errors.email?.message} />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Mật khẩu
            </label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              placeholder="Ít nhất 8 ký tự"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-error' : undefined}
              disabled={isSubmitting}
              {...register('password')}
            />
            <FieldError id="password-error" message={errors.password?.message} />
          </div>
          <div>
            <label className="label" htmlFor="confirmPassword">
              Xác nhận mật khẩu
            </label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              placeholder="Nhập lại mật khẩu"
              aria-invalid={errors.confirmPassword ? true : undefined}
              aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
              disabled={isSubmitting}
              {...register('confirmPassword')}
            />
            <FieldError id="confirmPassword-error" message={errors.confirmPassword?.message} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Đang tạo tài khoản...' : 'Đăng ký'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-muted">
          Đã có tài khoản?{' '}
          <Link
            to="/login"
            className="font-semibold text-brand-hover underline-offset-2 hover:underline"
          >
            Đăng nhập
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
