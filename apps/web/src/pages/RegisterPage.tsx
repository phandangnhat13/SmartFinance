import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorAlert, FieldError } from '../components/ui';
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
        <h1 className="text-2xl font-bold text-slate-900">Tạo tài khoản</h1>
        <p className="mt-1 text-sm text-slate-500">Bắt đầu theo dõi dòng tiền trong vài phút.</p>

        {error ? (
          <div className="mt-4">
            <ErrorAlert message={error} />
          </div>
        ) : null}

        <form className="mt-5 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div>
            <label className="label" htmlFor="displayName">
              Tên hiển thị
            </label>
            <input
              id="displayName"
              className="input"
              placeholder="Nguyễn Văn An"
              {...register('displayName')}
            />
            <FieldError message={errors.displayName?.message} />
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
              {...register('email')}
            />
            <FieldError message={errors.email?.message} />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Mật khẩu
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              className="input"
              placeholder="Ít nhất 8 ký tự"
              {...register('password')}
            />
            <FieldError message={errors.password?.message} />
          </div>
          <div>
            <label className="label" htmlFor="confirmPassword">
              Xác nhận mật khẩu
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              className="input"
              {...register('confirmPassword')}
            />
            <FieldError message={errors.confirmPassword?.message} />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Đang tạo tài khoản...' : 'Đăng ký'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-500">
          Đã có tài khoản?{' '}
          <Link to="/login" className="font-semibold text-emerald-700 hover:underline">
            Đăng nhập
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
