import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  ChartLine,
  ChevronRight,
  CreditCard,
  FolderTree,
  Goal,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  TrendingUp,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { cn } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof BarChart3;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Theo dõi',
    items: [
      { to: '/dashboard', label: 'Tổng quan', icon: BarChart3 },
      { to: '/insights', label: 'Phân tích', icon: TrendingUp },
      { to: '/analytics', label: 'Xu hướng', icon: ChartLine },
    ],
  },
  {
    label: 'Quản lý',
    items: [
      { to: '/transactions', label: 'Giao dịch', icon: Receipt },
      { to: '/accounts', label: 'Tài khoản', icon: Wallet },
      { to: '/categories', label: 'Danh mục', icon: FolderTree },
      { to: '/budgets', label: 'Ngân sách', icon: CreditCard },
    ],
  },
  {
    label: 'Lập kế hoạch',
    items: [
      { to: '/goals', label: 'Mục tiêu', icon: Goal },
      { to: '/alerts', label: 'Cảnh báo', icon: Bell },
    ],
  },
  {
    label: 'Dữ liệu',
    items: [{ to: '/imports', label: 'Nhập / xuất CSV', icon: Upload }],
  },
];

/** Breadcrumb context for the sticky header; the page itself keeps its own h1. */
const PAGE_META: Record<string, { group: string; label: string }> = {
  '/dashboard': { group: 'Theo dõi', label: 'Tổng quan' },
  '/insights': { group: 'Theo dõi', label: 'Phân tích' },
  '/analytics': { group: 'Theo dõi', label: 'Xu hướng' },
  '/transactions': { group: 'Quản lý', label: 'Giao dịch' },
  '/transactions/new': { group: 'Quản lý', label: 'Thêm giao dịch' },
  '/transactions/transfer': { group: 'Quản lý', label: 'Chuyển tiền' },
  '/accounts': { group: 'Quản lý', label: 'Tài khoản' },
  '/categories': { group: 'Quản lý', label: 'Danh mục' },
  '/budgets': { group: 'Quản lý', label: 'Ngân sách' },
  '/goals': { group: 'Lập kế hoạch', label: 'Mục tiêu tiết kiệm' },
  '/alerts': { group: 'Lập kế hoạch', label: 'Cảnh báo' },
  '/imports': { group: 'Dữ liệu', label: 'Nhập / xuất CSV' },
  '/settings': { group: 'Tài khoản', label: 'Cài đặt' },
};

function pageMeta(pathname: string): { group: string; label: string } {
  const exact = PAGE_META[pathname];
  if (exact) return exact;
  if (/^\/transactions\/[^/]+\/edit$/.test(pathname)) {
    return { group: 'Quản lý', label: 'Sửa giao dịch' };
  }
  return { group: 'Smart Finance', label: 'Không tìm thấy trang' };
}

const SIDEBAR_KEY = 'sf.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
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
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1',
          collapsed && 'flex-col justify-center px-0',
        )}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-white">
          <ArrowLeftRight className="h-5 w-5" aria-hidden />
        </span>
        <div className={cn('min-w-0', collapsed && 'sr-only')}>
          <p className="truncate text-sm font-bold text-ink">Smart Finance</p>
          <p className="truncate text-xs text-ink-muted">Quản lý tài chính cá nhân</p>
        </div>
      </div>

      <nav aria-label="Điều hướng chính" className="mt-5 flex-1 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {collapsed ? (
              <div className="mx-2 mb-1 border-t border-line" aria-hidden />
            ) : (
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'relative flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition',
                      collapsed ? 'justify-center px-0' : 'px-3',
                      isActive
                        ? 'bg-brand-soft text-brand-hover'
                        : 'text-ink-secondary hover:bg-surface-muted hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <span
                          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand"
                          aria-hidden
                        />
                      ) : null}
                      <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                      <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-line pt-3">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          title={collapsed ? 'Cài đặt' : undefined}
          className={({ isActive }) =>
            cn(
              'relative flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition',
              collapsed ? 'justify-center px-0' : 'px-3',
              isActive
                ? 'bg-brand-soft text-brand-hover'
                : 'text-ink-secondary hover:bg-surface-muted hover:text-ink',
            )
          }
        >
          <Settings className="h-[18px] w-[18px] shrink-0" aria-hidden />
          <span className={cn('truncate', collapsed && 'sr-only')}>Cài đặt</span>
        </NavLink>

        <div
          className={cn(
            'mb-1 mt-2 flex items-center gap-3 px-3',
            collapsed && 'justify-center px-0',
          )}
        >
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-semibold text-ink-secondary"
            aria-hidden
          >
            {user?.displayName?.slice(0, 1).toUpperCase() ?? '?'}
          </span>
          <div className={cn('min-w-0', collapsed && 'sr-only')}>
            <p className="truncate text-sm font-medium text-ink">{user?.displayName}</p>
            <p className="truncate text-xs text-ink-muted">{user?.email}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          title={collapsed ? 'Đăng xuất' : undefined}
          className={cn(
            'flex w-full items-center gap-2 rounded-xl py-2 text-sm font-medium text-ink-secondary hover:bg-surface-muted disabled:opacity-60',
            collapsed ? 'justify-center px-0' : 'px-3',
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden />
          <span className={cn(collapsed && 'sr-only')}>
            {loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}
          </span>
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const location = useLocation();
  const meta = pageMeta(location.pathname);

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, String(next));
      } catch {
        // A blocked storage is not a reason to break navigation.
      }
      return next;
    });
  }

  // The mobile navigation behaves like a dialog: Escape closes it and the page
  // behind it does not scroll while it is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-app">
      <a href="#main-content" className="skip-link">
        Bỏ qua điều hướng
      </a>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden grid-rows-[minmax(0,1fr)_auto] border-r border-line bg-surface p-4 transition-[width] duration-200 lg:grid',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        <SidebarContent collapsed={collapsed} />
        <button
          type="button"
          onClick={toggleCollapsed}
          className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-line py-2 text-xs font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
          aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" aria-hidden />
              <span>Thu gọn</span>
            </>
          )}
        </button>
      </aside>

      <div
        className={cn('transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}
      >
        <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
          <div className="mx-auto flex h-14 w-full max-w-content items-center gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2 lg:hidden">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
                <ArrowLeftRight className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-sm font-bold">Smart Finance</span>
            </div>

            {/* Context line, not a landmark: the sidebar is the single
                navigation landmark, so screen-reader navigation stays simple. */}
            <div className="hidden min-w-0 items-center gap-1.5 text-sm lg:flex">
              <span className="truncate text-ink-muted">{meta.group}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />
              <span aria-current="page" className="truncate font-medium text-ink">
                {meta.label}
              </span>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <Link
                to="/alerts"
                className="icon-btn"
                aria-label="Cảnh báo chi tiêu"
                title="Cảnh báo chi tiêu"
              >
                <Bell className="h-[18px] w-[18px]" />
              </Link>
              <Link
                to="/settings"
                aria-label="Tài khoản và cài đặt"
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-surface-muted"
              >
                <span
                  className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-hover"
                  aria-hidden
                >
                  {user?.displayName?.slice(0, 1).toUpperCase() ?? '?'}
                </span>
                <span className="hidden max-w-[160px] truncate text-sm font-medium text-ink sm:block">
                  {user?.displayName ?? 'Tài khoản'}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="icon-btn lg:hidden"
                aria-label="Mở menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          className="mx-auto w-full max-w-content px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          <Outlet />
        </main>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
            role="presentation"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Điều hướng"
            className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-surface p-4 shadow-pop"
          >
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 icon-btn"
              aria-label="Đóng menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
