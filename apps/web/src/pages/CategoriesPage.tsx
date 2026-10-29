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
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setType(tab.value)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium ${
                type === tab.value
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Hiện danh mục đã lưu trữ
        </label>
      </div>

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
        />
      ) : (
        <div className="card overflow-hidden p-0">
          <ul className="divide-y divide-slate-100">
            {categories.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="truncate font-medium text-slate-800">{category.name}</span>
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
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      aria-label={`Sửa ${category.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => archiveMutation.mutate(category)}
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      aria-label={
                        category.isArchived
                          ? `Khôi phục ${category.name}`
                          : `Lưu trữ ${category.name}`
                      }
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
