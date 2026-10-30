import { ArrowLeftRight, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-brand-deep p-10 text-brand-soft lg:flex">
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface/10">
            <ArrowLeftRight className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-lg font-bold">Smart Finance</span>
        </div>
        <div>
          <p className="max-w-md text-3xl font-bold leading-tight">
            Hiểu rõ dòng tiền, ra quyết định tài chính tốt hơn.
          </p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-brand-soft/80">
            Quản lý tài khoản, ngân sách và mục tiêu tiết kiệm trong một nơi. Gợi ý danh mục bằng AI
            giúp bạn ghi chép nhanh hơn — bạn luôn là người quyết định.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            <li className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" aria-hidden /> Báo cáo thu chi theo tháng
            </li>
            <li className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" aria-hidden /> Phân loại giao dịch có kiểm duyệt
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Dữ liệu của riêng bạn
            </li>
          </ul>
        </div>
        <p className="text-xs text-brand-soft/70">Đồ án Smart Finance · MVP</p>
      </div>
      <div className="flex items-center justify-center bg-surface-muted px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white">
              <ArrowLeftRight className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-lg font-bold">Smart Finance</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
