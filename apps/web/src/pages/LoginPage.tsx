import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorAlert, FieldError, PasswordInput } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/api';

const schema = z.object({
  email: z.string().trim().email('Email không hợp lệ'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (user) return <Navigate to="/dashboard" replace />;

  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <AuthLayout>
      <div className="card">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Đăng nhập</h1>
        <p className="mt-1 text-sm text-ink-muted">Tiếp tục quản lý tài chính của bạn.</p>

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
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
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
              autoComplete="current-password"
              placeholder="••••••••"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-error' : undefined}
              disabled={isSubmitting}
              {...register('password')}
            />
            <FieldError id="password-error" message={errors.password?.message} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-muted">
          Chưa có tài khoản?{' '}
          <Link
            to="/register"
            className="font-semibold text-brand-hover underline-offset-2 hover:underline"
          >
            Đăng ký
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
