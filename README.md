# Smart Finance

Ứng dụng web quản lý tài chính cá nhân: ghi chép thu/chi, ngân sách, mục tiêu tiết kiệm,
báo cáo trực quan, nhập/xuất CSV và **phân loại giao dịch bằng AI** (đề xuất, người dùng xác nhận).

---

## 1. Tính năng

**Tài khoản & giao dịch**

- Đăng ký/đăng nhập bằng email + mật khẩu; phiên JWT lưu trong cookie **HttpOnly**.
- Nhiều tài khoản (tiền mặt, ngân hàng, ví điện tử) với số dư ban đầu và số dư hiện tại.
- Ghi chép giao dịch thu/chi, danh mục mặc định (system) + danh mục tùy chỉnh.
- Chuyển khoản nội bộ giữa hai tài khoản được lưu thành **hai bút toán liên kết**, không tính vào thu nhập/chi tiêu.
- Lọc theo loại, khoảng thời gian, tài khoản, danh mục, từ khóa; phân trang.

**Ngân sách & mục tiêu**

- Ngân sách theo tháng (tổng hoặc theo danh mục), ngưỡng cảnh báo tùy chỉnh (ví dụ 80%, 100%).
- Cảnh báo chỉ ghi nhận một lần cho mỗi ngưỡng trong tháng.
- Mục tiêu tiết kiệm với số tiền mục tiêu, hạn chót và các lần đóng góp.

**Báo cáo**

- Tổng thu/chi/số dư theo khoảng thời gian và người dùng.
- Phân bố chi tiêu theo danh mục, xu hướng theo ngày/tuần/tháng.
- So sánh với kỳ trước tương đương.

**Nhập / xuất CSV**

- Tải file mẫu, upload CSV, **xem trước** từng dòng (hợp lệ/không hợp lệ/trùng lặp) trước khi xác nhận.
- Chống trùng bằng SHA-256 trên nội dung nghiệp vụ của giao dịch.
- Xuất CSV có chống **CSV formula injection** (ô bắt đầu bằng `= + - @` được escape).

**AI phân loại giao dịch**

- Mô hình TF-IDF (char n-gram) + Logistic Regression, taxonomy 11 danh mục dùng chung giữa API và UI.
- Dataset tổng hợp chia theo template group; so sánh **3 phương pháp** (keyword baseline,
  TF-IDF + LR, TF-IDF + calibrated LinearSVC) trên tập test held-out.
- Ngưỡng tin cậy **0.50** chọn trên validation; gợi ý dưới ngưỡng trả `low_confidence`.
- Gợi ý danh mục kèm độ tin cậy; giao diện cho phép **Chấp nhận** hoặc **Sửa** và ghi lại phản hồi.
- Thu thập phản hồi chỉ khi người dùng bật `allowAiResearch`; xuất JSONL đã khử định danh.
- API gateway trong NestJS có timeout, cache model info và **fallback** khi AI service không sẵn sàng.

---

## 2. Kiến trúc

```text
┌──────────────┐     /api/v1 (cookie HttpOnly)     ┌──────────────┐
│  React SPA   │ ────────────────────────────────▶ │  NestJS API  │
│ Vite + TS    │ ◀──────────────────────────────── │  (REST)      │
└──────────────┘                                   └──────┬───────┘
                                                          │ Prisma
                                                   ┌──────▼───────┐
                                                   │ PostgreSQL 16│
                                                   └──────────────┘
                                                          │ HTTP (timeout + fallback)
                                                   ┌──────▼───────┐
                                                   │   FastAPI    │
                                                   │ TF-IDF + LR  │
                                                   └──────────────┘
```

| Thành phần              | Công nghệ                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/web`              | React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, Recharts |
| `apps/api`              | NestJS 11, Prisma 6, PostgreSQL 16, class-validator, Swagger, JWT cookie, helmet, throttling           |
| `apps/ai-service`       | Python 3.13, FastAPI, scikit-learn, joblib                                                             |
| `packages/shared-types` | Kiểu dữ liệu và taxonomy dùng chung (build CJS + ESM)                                                  |
| Hạ tầng                 | Docker Compose, GitHub Actions, ESLint, Prettier, Jest/Supertest, Vitest, Pytest                       |

---

## 3. Cấu trúc repository

```text
apps/
  api/              NestJS API, Prisma client, e2e tests
  web/              React SPA
  ai-service/       FastAPI classifier, dataset, model artifacts
packages/
  shared-types/     DTO types + AI taxonomy dùng chung
prisma/
  schema.prisma     Mô hình dữ liệu
  migrations/       Migration SQL
  seed.ts           System categories + demo data (opt-in)
deploy/             entrypoint API, cấu hình nginx
docs/               Tài liệu dự án
```

---

## 4. Chạy nhanh bằng Docker Compose

Yêu cầu: Docker Desktop (Compose v2).

```bash
cp .env.example .env
# Sinh JWT secret rồi dán vào .env:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker compose up --build
```

| Dịch vụ    | URL                                                      |
| ---------- | -------------------------------------------------------- |
| Web        | http://localhost:5173                                    |
| API        | http://localhost:3000/api/v1                             |
| Swagger    | http://localhost:3000/api/docs                           |
| AI service | http://localhost:8000/docs                               |
| PostgreSQL | `localhost:5432` (user/password mặc định `smartfinance`) |

Tạo dữ liệu demo (tùy chọn, có thể chạy lại an toàn):

```bash
docker compose --profile tools run --rm seed
```

Tài khoản demo được tạo khi `SEED_DEMO=true`: `demo@smartfinance.local` / `Demo1234!`
(có thể đổi bằng `DEMO_EMAIL` / `DEMO_PASSWORD`). **Không bật seed demo trên môi trường công khai.**

Dừng và xóa toàn bộ dữ liệu Docker (thao tác phá hủy, chỉ dùng khi bạn chắc chắn):

```bash
docker compose down -v
```

---

## 5. Phát triển cục bộ (không Docker)

Yêu cầu: Node.js ≥ 20, npm ≥ 9, PostgreSQL ≥ 16, Python 3.12+.

```bash
npm install                     # cài workspace + build shared-types
cp .env.example .env            # sửa DATABASE_URL trỏ tới PostgreSQL của bạn

npx prisma generate             # tạo Prisma Client (cần làm sau khi cài dependency)
npx prisma migrate deploy       # hoặc: npx prisma migrate dev khi phát triển schema
npm run prisma:seed             # tạo 11 system categories (không tạo demo data)
```

Chạy song song API và web:

```bash
npm run dev                     # API :3000, web :5173 (Vite proxy /api → :3000)
```

Chạy AI service:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate — macOS/Linux: source .venv/bin/activate
pip install -r apps/ai-service/requirements.txt
python -m uvicorn app.main:app --app-dir apps/ai-service --reload --port 8000
```

Nếu AI service chưa chạy, API vẫn hoạt động: endpoint gợi ý trả `model_not_ready` và UI
cho phép chọn danh mục thủ công.

### Biến môi trường

Xem [.env.example](.env.example). Các biến quan trọng:

| Biến                              | Mô tả                                                        |
| --------------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`                    | Chuỗi kết nối PostgreSQL của ứng dụng                        |
| `TEST_DATABASE_URL`               | Database riêng cho e2e (bị truncate giữa các test)           |
| `JWT_SECRET`                      | Bắt buộc, tối thiểu 32 ký tự                                 |
| `JWT_EXPIRES_IN`                  | Thời hạn phiên, mặc định `7d`                                |
| `WEB_ORIGIN`                      | Origin được phép gọi API / gửi cookie (CSRF)                 |
| `COOKIE_SECURE`                   | `true` khi chạy sau HTTPS (bắt buộc ở `NODE_ENV=production`) |
| `AI_SERVICE_URL`, `AI_TIMEOUT_MS` | Địa chỉ và timeout của AI service                            |
| `SEED_DEMO`                       | `true` để tạo dữ liệu demo (mặc định tắt)                    |

Không commit `.env`, API key hoặc dữ liệu cá nhân.

---

## 6. Scripts

| Lệnh                                            | Ý nghĩa                                               |
| ----------------------------------------------- | ----------------------------------------------------- |
| `npm run dev`                                   | API + web ở chế độ watch                              |
| `npm run dev:ai`                                | AI service với uvicorn `--reload`                     |
| `npm run build`                                 | Build shared-types → API → web                        |
| `npm run lint` / `npm run format`               | ESLint flat config / Prettier                         |
| `npm run typecheck`                             | `tsc --noEmit` cho tất cả workspace                   |
| `npm test`                                      | Unit test API (Jest) + web (Vitest)                   |
| `npm run test:e2e`                              | E2E API với PostgreSQL thật (cần `TEST_DATABASE_URL`) |
| `npm run test:e2e -w @smart-finance/web`        | E2E trình duyệt Playwright (DB `smart_finance_e2e`)   |
| `npm run prisma:migrate` / `prisma:deploy`      | Migration ở môi trường dev / triển khai               |
| `npm run prisma:seed`                           | System categories (+ demo nếu `SEED_DEMO=true`)       |
| `npm run prisma:studio`                         | Prisma Studio                                         |
| `npm run feedback:export -w @smart-finance/api` | Xuất feedback AI đã khử định danh (có `--dry-run`)    |
| `npm run imports:purge -w @smart-finance/api`   | Dọn preview CSV cũ (có `--dry-run`, `--days N`)       |
| `npm run audit:policy`                          | Audit theo mức rủi ro + allowlist có thời hạn         |

Script AI (chạy trong `apps/ai-service`):

| Lệnh                                 | Ý nghĩa                                                |
| ------------------------------------ | ------------------------------------------------------ |
| `python scripts/generate_dataset.py` | Sinh lại dataset tổng hợp (tất định theo seed)         |
| `python scripts/validate_dataset.py` | Kiểm tra trùng/rò rỉ/độ phủ nhãn trước khi train       |
| `python scripts/evaluate_models.py`  | So sánh 3 phương pháp, chọn ngưỡng trên validation     |
| `python scripts/stability.py`        | Độ ổn định theo split (train+validation, nhiều seed)   |
| `python scripts/nested_cv.py`        | Nested CV trên train only (không đọc validation/test)  |
| `python scripts/train.py`            | Huấn luyện artifact phục vụ từ `models/selection.json` |

### Kiểm thử

```bash
npm run typecheck && npm run lint
npm test                       # API unit (40) + web unit (11)
npm run test:e2e               # API e2e (20), cần database test đã migrate
npm run test:e2e -w @smart-finance/web   # Trình duyệt (14); tự tạo DB + server riêng
cd apps/ai-service && pytest   # AI service (33)
```

Playwright cần PostgreSQL đang chạy và `npx playwright install chromium` một lần. Suite tự tạo
database `smart_finance_e2e`, chạy API cổng 3100, web 5174 và AI stub 8011; không dùng database
phát triển hay server dev đang chạy. Screenshot/trace được giữ khi test fail.

Xem chi tiết phạm vi, dữ liệu test và tiêu chí chấp nhận tại [docs/TEST_PLAN.md](docs/TEST_PLAN.md).

---

## 7. AI service

- Dữ liệu tổng hợp `synthetic-v2` chia **theo template group**: 992 train / 200 validation /
  200 test held-out / 440 paraphrase. Không có cụm mô tả nào xuất hiện ở hai split.
- Kiểm tra dữ liệu: `python apps/ai-service/scripts/validate_dataset.py` (trùng, rò rỉ group,
  độ phủ nhãn, sai type).
- Đánh giá 3 phương pháp: `python apps/ai-service/scripts/evaluate_models.py` — chọn `C` và
  ngưỡng trên **validation**, chấm test một lần, ghi confusion matrix PNG/JSON và metadata.
- Huấn luyện artifact phục vụ: `python apps/ai-service/scripts/train.py`
  (ghi `models/model.joblib`, `models/metrics.json`, đọc `models/selection.json`).

Kết quả test held-out (200 dòng):

| Phương pháp                      |   Accuracy |   Macro F1 | Weighted F1 |
| -------------------------------- | ---------: | ---------: | ----------: |
| Keyword baseline                 |     0.3700 |     0.3202 |      0.3321 |
| **TF-IDF + Logistic Regression** | **0.7000** | **0.7151** |  **0.7005** |
| TF-IDF + calibrated LinearSVC    |     0.6800 |     0.6937 |      0.6781 |

- Ngưỡng **0.50**: test coverage 47.0% (94/200), selective accuracy 83.0%.
- Calibration LR: ECE 0.1216 / Brier 0.2090 (validation); 0.2233 / 0.2510 (test) — confidence dùng
  để xếp hạng gợi ý tốt hơn là đọc như xác suất.
- Stability (train+validation, 5-fold, seed 42/7/2026): LR **accuracy** 0.5971 ± 0.0384; macro F1
  0.5844 ± 0.0305; weighted F1 0.5915 ± 0.0398. Đây là conditional variance vì validation đã tham
  gia chọn C/threshold.
- Nested CV chỉ trên train (5 outer × 3 inner): LR 0.5799 ± 0.0538 accuracy, SVC 0.5926 ± 0.0598.
  Bootstrap theo template group cho test LR accuracy [0.5449, 0.8450]; hiệu LR−SVC
  +0.0199 [−0.0250, +0.0750] nên **không kết luận LR vượt SVC**.
- Test split đã được quan sát trong các vòng trước; vẫn không dùng để chọn mô hình/ngưỡng nhưng
  không còn là holdout một lần. Artifact serving được giữ nguyên.
- Kết quả AI **chỉ là đề xuất**; giao dịch chỉ lưu danh mục sau khi người dùng xác nhận.
- Đây là số liệu trên dữ liệu tổng hợp, **không phải** ước lượng độ chính xác trên người dùng thật.

Chi tiết: [docs/AI_EVALUATION_REPORT.md](docs/AI_EVALUATION_REPORT.md),
[docs/AI_MODEL_CARD.md](docs/AI_MODEL_CARD.md),
[docs/AI_DATASET_GUIDELINES.md](docs/AI_DATASET_GUIDELINES.md).

### Feedback và quyền riêng tư

- Người dùng bật **Cho phép dùng phản hồi AI để nghiên cứu** trong Cài đặt (mặc định tắt).
- `npm run feedback:export -w @smart-finance/api -- --dry-run` xem trước; bỏ `--dry-run` để ghi
  `exports/ai-feedback-<timestamp>.jsonl` + metadata. File đã khử email/số điện thoại/số dài,
  không chứa `userId`, email hay `predictionId`.
- Không tự động train lại từ feedback; quy trình rà soát thủ công mô tả tại
  [docs/AI_FEEDBACK_PIPELINE.md](docs/AI_FEEDBACK_PIPELINE.md).

---

## 8. Định dạng CSV

Tải mẫu tại `GET /api/v1/imports/template.csv`. Cột:

```csv
account,type,amount,occurredAt,description,category,note,currency
"Tiền mặt",EXPENSE,65000,2026-10-25,Highlands Coffee,Ăn uống,,VND
```

- `type`: `INCOME` hoặc `EXPENSE` (chuyển khoản không nhập qua CSV).
- `occurredAt`: `YYYY-MM-DD` hoặc ISO datetime.
- `account` và `category` được khớp theo tên (không phân biệt hoa thường); dòng không khớp bị đánh dấu lỗi.
- Dòng trùng (cùng tài khoản, loại, số tiền, thời điểm, mô tả) bị bỏ qua khi commit.

---

## 9. Bảo mật

- Mật khẩu băm bằng bcrypt (cost 12); không log mật khẩu, token hay mô tả giao dịch.
- JWT trong cookie `HttpOnly`, `SameSite=Lax`; kiểm tra `Origin` cho các request ghi (CSRF).
- Mọi truy vấn đều lọc theo `userId` lấy từ token — không tin `userId` từ client.
- Validation whitelist + `forbidNonWhitelisted`, giới hạn kích thước body/upload, helmet, rate limiting.
- Lỗi trả về theo envelope thống nhất, không lộ stack trace.
- CSV export escape công thức; file upload chỉ chấp nhận `.csv`.
- Phản hồi AI chỉ được xuất khi người dùng bật `allowAiResearch`; mô tả được khử email/số điện
  thoại/số dài, không xuất `userId`, email hay `predictionId`. Người dùng có thể xóa prediction
  của chính mình (`DELETE /api/v1/ai/predictions/:id`).
- AI service không có xác thực riêng: chỉ nên chạy trong mạng nội bộ hoặc sau reverse proxy.
  Compose bind cổng 8000 vào `127.0.0.1`; không publish ra Internet khi triển khai thật.
- Cookie và JWT dùng chung TTL (`JWT_EXPIRES_IN`); logout xoá cookie và `/auth/me` trả 401. JWT đã
  phát hành vẫn hợp lệ tới `exp` (stateless) — cần denylist/refresh token nếu yêu cầu thu hồi ngay.
- Preview CSV cũ được dọn bằng `npm run imports:purge -w @smart-finance/api` (mặc định 30 ngày,
  `--dry-run` trước); biến `IMPORT_PREVIEW_RETENTION_DAYS` trong `.env.example`.

`npm audit` hiện 15 mục toàn cây, 3 mục trên đường production (2 moderate `react-router`, 1 high
`zod` đã allowlist có thời hạn). Hai override tương thích đã hạ `js-yaml` và `deepmerge-ts`; không
nâng major. CI chạy `npm run audit:policy`: high/critical production chưa allowlist sẽ fail, entry
hết hạn cũng fail. Lý do và đường ảnh hưởng ghi tại
[docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) và [docs/DECISIONS.md](docs/DECISIONS.md).
