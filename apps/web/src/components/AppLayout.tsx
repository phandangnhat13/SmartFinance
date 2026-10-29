import {
  ArrowLeftRight,
  BarChart3,
  CreditCard,
  FolderTree,
  Goal,
  LogOut,
  Menu,
  Receipt,
  Settings,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { cn } from './ui';

const navigation = [
  { to: '/dashboard', label: 'Tổng quan', icon: BarChart3 },
  { to: '/transactions', label: 'Giao dịch', icon: Receipt },
  { to: '/accounts', label: 'Tài khoản', icon: Wallet },
  { to: '/categories', label: 'Danh mục', icon: FolderTree },
  { to: '/budgets', label: 'Ngân sách', icon: CreditCard },
  { to: '/goals', label: 'Mục tiêu', icon: Goal },
  { to: '/imports', label: 'Nhập / xuất CSV', icon: Upload },
  { to: '/settings', label: 'Cài đặt', icon: Settings },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-white">
          <ArrowLeftRight className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-900">Smart Finance</p>
          <p className="text-xs text-slate-500">Quản lý tài chính cá nhân</p>
        </div>
      </div>

      <nav className="mt-6 flex-1 space-y-1">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )
            }
          >
            <item.icon className="h-4 w-4" aria-hidden />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-200 pt-4">
        <div className="mb-3 flex items-center gap-3 px-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
            {user?.displayName?.slice(0, 1).toUpperCase() ?? '?'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">{user?.displayName}</p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          {loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white p-4 lg:block">
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-600 text-white">
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-sm font-bold">Smart Finance</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          aria-label="Mở menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
            role="presentation"
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white p-4 shadow-xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Đóng menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:pl-72 lg:pr-8">
        <Outlet />
      </main>
    </div>
  );
}
