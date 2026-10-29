import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
      <p className="text-5xl font-bold text-emerald-700">404</p>
      <h1 className="text-xl font-semibold text-slate-900">Không tìm thấy trang</h1>
      <p className="max-w-md text-sm text-slate-500">
        Đường dẫn bạn truy cập không tồn tại hoặc đã bị thay đổi.
      </p>
      <Link to="/dashboard" className="btn-primary">
        Về tổng quan
      </Link>
    </div>
  );
}
