import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryDto, CategoryType } from '@smart-finance/shared-types';
import { Archive, ArchiveRestore, Lock, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Badge,
  EmptyState,
  ErrorAlert,
  FieldError,
  Modal,
  PageHeader,
  Spinner,
  TabBar,
} from '../components/ui';
import { api, errorMessage } from '../lib/api';

const schema = z.object({
  name: z.string().trim().min(1, 'Nhập tên danh mục').max(60, 'Tối đa 60 ký tự'),
});

type FormValues = z.infer<typeof schema>;

const TABS: { value: CategoryType; label: string }[] = [
  { value: 'EXPENSE', label: 'Chi tiêu' },
  { value: 'INCOME', label: 'Thu nhập' },
];

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const [type, setType] = useState<CategoryType>('EXPENSE');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryDto | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['categories', type, includeArchived],
    queryFn: () =>
      api.get<{ items: CategoryDto[] }>(
        `/categories?type=${type}&includeArchived=${includeArchived}`,
      ),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['categories'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (name: string) => {
      if (editing) return api.patch(`/categories/${editing.id}`, { name });
      return api.post('/categories', { name, type });
    },
    onSuccess: async () => {
      await invalidate();
      setFormOpen(false);
      setEditing(null);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (category: CategoryDto) =>
      api.patch(`/categories/${category.id}`, { isArchived: !category.isArchived }),
    onSuccess: invalidate,
    onError: (error) => setActionError(errorMessage(error)),
  });

  function openCreate() {
    setEditing(null);
    setFormError(null);
    reset({ name: '' });
    setFormOpen(true);
  }

  function openEdit(category: CategoryDto) {
    setEditing(category);
    setFormError(null);
    reset({ name: category.name });
    setFormOpen(true);
  }

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      await saveMutation.mutateAsync(values.name.trim());
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  const categories = categoriesQuery.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Danh mục"
        description="Danh mục hệ thống dùng chung với mô hình AI. Bạn có thể thêm danh mục riêng."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden /> Thêm danh mục
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <TabBar
          label="Loại danh mục"
          tabs={TABS}
          value={type}
          onChange={setType}
          idBase="category-tabs"
          panelId="category-tabpanel"
        />
        <label className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            className="h-4 w-4 rounded border-line-strong accent-brand"
          />
          Hiện danh mục đã lưu trữ
        </label>
      </div>

      <div
        id="category-tabpanel"
        role="tabpanel"
        aria-labelledby={`category-tabs-tab-${type}`}
        tabIndex={0}
        className="focus-visible:outline-none"
      >
        {actionError ? (
          <div className="mb-4">
            <ErrorAlert message={actionError} />
          </div>
        ) : null}

        {categoriesQuery.isLoading ? (
          <Spinner label="Đang tải danh mục..." />
        ) : categoriesQuery.error ? (
          <ErrorAlert
            message={errorMessage(categoriesQuery.error)}
            onRetry={() => void categoriesQuery.refetch()}
          />
        ) : categories.length === 0 ? (
          <EmptyState
            title="Chưa có danh mục"
            description="Thêm danh mục riêng cho loại giao dịch này."
            action={
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden /> Thêm danh mục
              </button>
            }
          />
        ) : (
          <div className="card overflow-hidden p-0">
            <ul className="divide-y divide-line">
              {categories.map((category) => (
                <li
                  key={category.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-medium text-ink">{category.name}</span>
                    {category.isSystem ? (
                      <Badge tone="slate">
                        <Lock className="mr-1 h-3 w-3" aria-hidden /> Hệ thống
                      </Badge>
                    ) : (
                      <Badge tone="emerald">Riêng</Badge>
                    )}
                    {category.isArchived ? <Badge tone="amber">Đã lưu trữ</Badge> : null}
                  </div>
                  {!category.isSystem ? (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(category)}
                        className="icon-btn"
                        aria-label={`Sửa ${category.name}`}
                        title="Sửa"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => archiveMutation.mutate(category)}
                        className="icon-btn"
                        aria-label={
                          category.isArchived
                            ? `Khôi phục ${category.name}`
                            : `Lưu trữ ${category.name}`
                        }
                        title={category.isArchived ? 'Khôi phục' : 'Lưu trữ'}
                      >
                        {category.isArchived ? (
                          <ArchiveRestore className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Modal
        open={formOpen}
        title={
          editing ? 'Sửa danh mục' : `Thêm danh mục ${type === 'INCOME' ? 'thu nhập' : 'chi tiêu'}`
        }
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      >
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          {formError ? <ErrorAlert message={formError} /> : null}
          <div>
            <label className="label" htmlFor="categoryName">
              Tên danh mục
            </label>
            <input
              id="categoryName"
              className="input"
              placeholder="Cà phê & đồ uống"
              {...register('name')}
            />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
              Huỷ
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
