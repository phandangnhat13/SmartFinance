import type { AiAssistantType } from '@smart-finance/shared-types';

/**
 * Central catalogue of contextual help.
 *
 * Every formula and rule below was checked against the API service that
 * produces the number (`source` records where). If a behaviour could not be
 * verified, it is left out rather than guessed. Pages should import entries
 * from here instead of writing their own wording, so the tooltip (Level A)
 * and the panel (Level B) never disagree.
 */
export interface Explanation {
  id: string;
  title: string;
  /** One or two sentences, also used as the Level A tooltip. */
  summary: string;
  what?: string;
  why?: string;
  /** Only present when the calculation was verified in the backend. */
  formula?: string;
  howToRead?: string;
  limitations?: string[];
  assistantType: AiAssistantType;
  /** Prefilled into the global AI composer; never sent automatically. */
  aiPrompt: string;
  /** Internal provenance, never rendered. */
  source: string;
}

const ANALYTICS = 'ANALYTICS' as const;
const SAVINGS = 'SAVINGS' as const;

/* --------------------------------- dashboard -------------------------------- */

export const dashboardIncome: Explanation = {
  id: 'dashboard.income',
  title: 'Thu nhập',
  summary: 'Tổng tiền của các giao dịch loại Thu nhập trong khoảng ngày đang chọn.',
  what: 'Là tổng số tiền của những giao dịch bạn ghi là Thu nhập. Giao dịch chuyển tiền giữa các tài khoản của bạn không được tính.',
  why: 'Đây là phần tiền đi vào trong kỳ. So sánh với chi tiêu để biết tháng này bạn giữ lại được bao nhiêu.',
  formula:
    'Thu nhập = tổng amount của các giao dịch type = INCOME\n(chỉ giao dịch INCOME; TRANSFER không được tính)',
  howToRead:
    'Con số càng lớn so với chi tiêu thì phần chênh lệch còn lại càng nhiều. Nhấn vào đây để hỏi AI vì sao thu nhập thay đổi.',
  limitations: [
    'Chỉ tính giao dịch đã ghi trong ứng dụng, không phải thu nhập thực tế ngoài đời.',
    'Không quy đổi ngoại tệ: mỗi con số lấy từ dữ liệu đã ghi, không có tỷ giá.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích chỉ số Thu nhập trên Dashboard của tôi: nó được tính thế nào và tôi nên hiểu con số này ra sao?',
  source: 'apps/api/src/modules/analytics/analytics.service.ts:117-146',
};

export const dashboardExpense: Explanation = {
  id: 'dashboard.expense',
  title: 'Chi tiêu',
  summary: 'Tổng tiền của các giao dịch loại Chi tiêu trong khoảng ngày đang chọn.',
  what: 'Là tổng số tiền của những giao dịch bạn ghi là Chi tiêu. Chuyển tiền nội bộ không bị coi là chi tiêu.',
  why: 'Cho biết bạn đã dùng bao nhiêu tiền trong kỳ. Đây là con số cần so với thu nhập và hạn mức ngân sách.',
  formula:
    'Chi tiêu = tổng amount của các giao dịch type = EXPENSE\n(chỉ giao dịch EXPENSE; TRANSFER không được tính)',
  howToRead:
    'Nếu chi tiêu gần hoặc vượt thu nhập, dòng tiền ròng sẽ thấp hoặc âm. Xem thêm phần Ngân sách và Điểm cần chú ý.',
  limitations: [
    'Khoản chi chưa được ghi vào ứng dụng sẽ không xuất hiện ở đây.',
    'Không tự động tách tiền mặt và tài khoản; tất cả giao dịch Chi tiêu đều được cộng chung.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích chỉ số Chi tiêu trên Dashboard của tôi: cách tính và những điểm tôi nên chú ý.',
  source: 'apps/api/src/modules/analytics/analytics.service.ts:117-146',
};

export const dashboardNetCashFlow: Explanation = {
  id: 'dashboard.netCashFlow',
  title: 'Dòng tiền ròng',
  summary: 'Thu nhập trừ chi tiêu trong kỳ. Số dương là còn lại, số âm là chi nhiều hơn thu.',
  what: 'Là phần chênh lệch giữa tổng thu nhập và tổng chi tiêu của kỳ đang xem.',
  why: 'Đây là thước đo nhanh nhất cho biết bạn đang giữ lại được tiền hay đang tiêu vượt thu nhập.',
  formula: 'Dòng tiền ròng = Thu nhập − Chi tiêu',
  howToRead:
    'Số dương: bạn còn lại tiền sau chi tiêu. Số âm: chi tiêu lớn hơn thu nhập trong kỳ; nên xem lại các khoản chi lớn.',
  limitations: [
    'Không phải số dư tài khoản: chuyển tiền nội bộ và số dư đầu kỳ không nằm trong phép tính này.',
    'Chỉ phản ánh giao dịch đã ghi, không dự báo các khoản sắp phải trả.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích Dòng tiền ròng trên Dashboard của tôi: cách tính và ý nghĩa khi con số dương hoặc âm.',
  source: 'apps/api/src/modules/analytics/analytics.service.ts:144',
};

export const dashboardTrendChart: Explanation = {
  id: 'dashboard.trendChart',
  title: 'Biểu đồ thu chi 6 tháng',
  summary: 'Thu nhập và chi tiêu của sáu tháng gần nhất, mỗi cột là một tháng.',
  what: 'Biểu đồ gộp giao dịch Thu nhập và Chi tiêu theo tháng trong khoảng sáu tháng gần nhất.',
  why: 'Giúp nhận ra xu hướng đều đặn hay tháng bất thường, thay vì chỉ nhìn một tháng.',
  formula:
    'Mỗi tháng = tổng INCOME và tổng EXPENSE trong tháng đó\nTháng không có giao dịch được hiển thị bằng 0',
  howToRead:
    'So sánh chiều cao hai thanh trong cùng tháng: thanh chi cao hơn thu nghĩa là tháng đó âm dòng tiền. Nhìn chuỗi nhiều tháng để phân biệt biến động thật với một tháng đột biến.',
  limitations: [
    'Tháng có giao dịch nhưng tổng bằng 0 và tháng hoàn toàn không có giao dịch đều hiện là 0 trên biểu đồ này.',
    'Biểu đồ dùng dữ liệu của endpoint xu hướng cũ, không lọc theo loại tiền tệ.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích biểu đồ Thu nhập và chi tiêu 6 tháng trên Dashboard của tôi và cho tôi biết xu hướng đáng chú ý.',
  source: 'apps/api/src/modules/analytics/analytics.service.ts:70-99,150-180',
};

export const dashboardHighlights: Explanation = {
  id: 'dashboard.highlights',
  title: 'Điểm cần chú ý',
  summary:
    'Tối đa ba điểm được tính từ dữ liệu thật: cảnh báo đang mở, ngân sách vượt mức và thay đổi chi tiêu so với kỳ trước.',
  what: 'Danh sách ngắn những điều hệ thống phát hiện là đáng chú ý trong tháng: cảnh báo chi tiêu đang mở (ưu tiên mức độ Cao), ngân sách đã vượt hoặc sắp chạm hạn mức, và mức tăng chi tiêu so với kỳ trước.',
  why: 'Giúp bạn biết nên xem phần nào trước, thay vì tự dò toàn bộ số liệu.',
  howToRead:
    'Mỗi dòng ghi rõ nguồn: “Cảnh báo”, “Ngân sách” hoặc “So sánh kỳ trước”. Nhấn “Xem chi tiết” để mở màn hình tương ứng; nhấn “Hỏi AI” để hỏi thêm về đúng điểm đó.',
  limitations: [
    'Chỉ hiển thị tối đa ba điểm, ưu tiên cảnh báo rồi đến ngân sách rồi đến so sánh kỳ.',
    'Không có điểm nào là suy đoán: nếu không có dữ liệu bất thường, hệ thống nói rõ là chưa có dấu hiệu.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích các điểm cần chú ý trên Dashboard của tôi và tôi nên xử lý điểm nào trước?',
  source: 'apps/web/src/pages/DashboardPage.tsx (dựng từ alerts, budgets, comparison)',
};

/* --------------------------------- analytics -------------------------------- */

export const analyticsIncome: Explanation = {
  id: 'analytics.income',
  title: 'Thu nhập trong kỳ',
  summary: 'Tổng giao dịch Thu nhập đúng loại tiền tệ đang chọn, không gồm chuyển tiền nội bộ.',
  what: 'Tổng tiền của các giao dịch loại Thu nhập trong kỳ phân tích và đúng loại tiền tệ đang chọn.',
  why: 'Là mẫu số của tỷ lệ tiết kiệm và là phần tiền đi vào để so với chi tiêu.',
  formula:
    'Thu nhập = tổng amount của giao dịch type = INCOME, currency = loại tiền đang chọn\n(TRANSFER bị loại trừ)',
  howToRead:
    'So sánh với “Kỳ trước” ngay dưới con số. Phần trăm thay đổi chỉ hiện khi kỳ trước có thu nhập; nếu kỳ trước bằng 0, hệ thống để trống thay vì chia cho 0.',
  limitations: [
    'Không quy đổi tỷ giá: giao dịch khác loại tiền tệ không được cộng vào.',
    'Kỳ đang diễn ra chỉ gồm giao dịch đã ghi đến hiện tại, chưa được quy đổi theo tỷ lệ thời gian.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích chỉ số Thu nhập trong kỳ ở trang Phân tích của tôi: cách tính và vì sao nó thay đổi so với kỳ trước.',
  source: 'apps/api/src/modules/analytics-trends/analytics-trends.service.ts:296-333',
};

export const analyticsExpense: Explanation = {
  id: 'analytics.expense',
  title: 'Chi tiêu trong kỳ',
  summary: 'Tổng giao dịch Chi tiêu đúng loại tiền tệ đang chọn, không gồm chuyển tiền nội bộ.',
  what: 'Tổng tiền của các giao dịch loại Chi tiêu trong kỳ và đúng loại tiền tệ đang chọn.',
  why: 'Là chỉ số chính để biết tiền đã đi đâu và để so sánh với ngân sách.',
  formula:
    'Chi tiêu = tổng amount của giao dịch type = EXPENSE, currency = loại tiền đang chọn\n(TRANSFER bị loại trừ)',
  howToRead:
    'Xem “Kỳ trước” và phần trăm thay đổi. Nếu chi tiêu tăng nhưng thu nhập không tăng tương ứng, tỷ lệ tiết kiệm sẽ giảm.',
  limitations: [
    'Không quy đổi tỷ giá giữa các loại tiền.',
    'Chuyển tiền giữa tài khoản của bạn không phải chi tiêu, nên không xuất hiện ở đây.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích chỉ số Chi tiêu trong kỳ ở trang Phân tích của tôi: cách tính và vì sao nó thay đổi so với kỳ trước.',
  source: 'apps/api/src/modules/analytics-trends/analytics-trends.service.ts:296-333',
};

export const analyticsNetCashFlow: Explanation = {
  id: 'analytics.netCashFlow',
  title: 'Dòng tiền ròng trong kỳ',
  summary: 'Thu nhập trừ chi tiêu trong kỳ. Số âm nghĩa là chi nhiều hơn thu.',
  what: 'Chênh lệch giữa tổng thu nhập và tổng chi tiêu của kỳ phân tích.',
  why: 'Là tử số của tỷ lệ tiết kiệm, cho biết kỳ này bạn để ra được bao nhiêu tiền.',
  formula: 'Dòng tiền ròng = Thu nhập − Chi tiêu',
  howToRead:
    'Nhìn dấu và độ lớn con số. Số dương càng lớn thì phần để dành càng nhiều; số âm cần xem lại các danh mục chi lớn.',
  limitations: [
    'Không phải số dư tài khoản; không gồm chuyển tiền nội bộ hay số dư đầu kỳ.',
    'Kỳ đang diễn ra chưa kết thúc nên con số có thể còn thay đổi.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích Dòng tiền ròng trong kỳ ở trang Phân tích của tôi và nguyên nhân chính khiến nó tăng hoặc giảm.',
  source: 'apps/api/src/modules/analytics-trends/analytics-trends.service.ts:296-333',
};

export const analyticsSavingsRate: Explanation = {
  id: 'analytics.savingsRate',
  title: 'Tỷ lệ tiết kiệm',
  summary: 'Phần trăm thu nhập còn lại sau chi tiêu. Không tính khi kỳ không có thu nhập.',
  what: 'Cho biết trong mỗi 100 đồng thu nhập, bạn còn lại bao nhiêu sau khi trừ chi tiêu.',
  why: 'Là chỉ số dễ so sánh giữa các tháng có quy mô thu nhập khác nhau.',
  formula:
    'Tỷ lệ tiết kiệm = (Thu nhập − Chi tiêu) / Thu nhập × 100\nHiển thị “—” khi Thu nhập ≤ 0',
  howToRead:
    'Tỷ lệ dương nghĩa là còn để dành; âm nghĩa là chi vượt thu. “Điểm %” trên card là chênh lệch so với kỳ trước, không phải phần trăm thay đổi.',
  limitations: [
    'Không tính khi kỳ không có thu nhập, thay vì coi là 0%.',
    'Chỉ dựa trên giao dịch đã ghi và không quy đổi tỷ giá.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích Tỷ lệ tiết kiệm của tôi ở trang Phân tích: cách tính, ý nghĩa và cách cải thiện.',
  source: 'apps/api/src/modules/analytics-trends/analytics-trends.service.ts:296-352',
};

export const analyticsTransactionCount: Explanation = {
  id: 'analytics.transactionCount',
  title: 'Số giao dịch',
  summary: 'Số giao dịch Thu nhập và Chi tiêu trong kỳ; chuyển tiền nội bộ không được đếm.',
  what: 'Đếm các giao dịch loại Thu nhập hoặc Chi tiêu trong kỳ phân tích.',
  why: 'Giúp nhận biết mức độ đầy đủ của dữ liệu: rất ít giao dịch có thể làm các chỉ số khác khó đại diện.',
  formula:
    'Số giao dịch = số bản ghi type = INCOME hoặc EXPENSE trong kỳ\n(TRANSFER không được đếm)',
  howToRead:
    'Nếu số giao dịch thấp bất thường, hãy kiểm tra bạn đã ghi đủ giao dịch chưa trước khi kết luận về xu hướng chi tiêu.',
  limitations: ['Chỉ đếm giao dịch đã ghi; không phải số lần giao dịch thực tế ngoài đời.'],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích chỉ số Số giao dịch ở trang Phân tích của tôi và mức độ đầy đủ của dữ liệu.',
  source: 'apps/api/src/modules/analytics-trends/analytics-trends.service.ts:296-333',
};

export const analyticsPeriodComparison: Explanation = {
  id: 'analytics.periodComparison',
  title: 'So sánh với kỳ trước',
  summary: 'Chênh lệch thu nhập, chi tiêu và tỷ lệ tiết kiệm so với kỳ liền trước cùng độ dài.',
  what: 'So sánh kỳ đang xem với kỳ liền trước: tháng trước một tháng, quý trước một quý, năm trước một năm; với khoảng ngày tự chọn, kỳ trước là khoảng dài bằng vậy kết thúc ngay trước ngày bắt đầu.',
  why: 'Con số tuyệt đối khó đánh giá nếu không có mốc so sánh; so với kỳ trước cho thấy xu hướng tăng hay giảm.',
  formula:
    'Thay đổi % = (Giá trị kỳ này − Giá trị kỳ trước) / Giá trị kỳ trước × 100\nĐể trống nếu kỳ trước bằng 0\nĐiểm % tỷ lệ tiết kiệm = tỷ lệ kỳ này − tỷ lệ kỳ trước',
  howToRead:
    'Phần trăm dương là tăng, âm là giảm. Với chi tiêu, tăng là điều cần chú ý; với thu nhập và dòng tiền ròng, tăng thường là tích cực.',
  limitations: [
    'Kỳ trước bằng 0 thì không có phần trăm thay đổi (tránh chia cho 0).',
    'Kỳ đang diễn ra chưa trọn vẹn nên so sánh với kỳ trước đã kết thúc có thể chưa công bằng.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích phần So sánh với kỳ trước ở trang Phân tích của tôi và những thay đổi đáng chú ý.',
  source:
    'apps/api/src/modules/analytics-trends/analytics-period.ts:75-214; analytics-trends.service.ts:335-352,539-595',
};

export const analyticsHealthScore: Explanation = {
  id: 'analytics.healthScore',
  title: 'Điểm sức khỏe tài chính',
  summary:
    'Điểm 0–100 tổng hợp từ dòng tiền, ngân sách, mục tiêu tiết kiệm, độ ổn định và rủi ro dự báo.',
  what: 'Chỉ số tổng hợp đánh giá tình hình tài chính hiện tại theo năm nhóm: dòng tiền (25%), ngân sách (20%), tiết kiệm (20%), độ ổn định (20%) và rủi ro dự báo (15%).',
  why: 'Một con số dễ theo dõi qua các tháng, nhưng luôn nên đọc kèm điểm từng nhóm vì nhóm thiếu dữ liệu sẽ không được tính.',
  formula:
    'Điểm = Σ(điểm nhóm × trọng số) / Σ(trọng số của các nhóm có dữ liệu)\nChỉ công bố khi có ≥ 3 nhóm và ≥ 60% tổng trọng số\nXếp loại: ≥85 Xuất sắc, ≥70 Tốt, ≥50 Trung bình, <50 Cần chú ý',
  howToRead:
    'Xem nhóm nào kéo điểm xuống ở phần chi tiết. Điểm thiếu dữ liệu (—) nghĩa là chưa đủ thông tin để kết luận, không phải điểm 0.',
  limitations: [
    'Không phải lời khuyên đầu tư hay điểm tín dụng.',
    'Các tháng không có giao dịch bị loại khỏi phần dòng tiền thay vì bị coi là tháng chi 0.',
    'Lịch sử điểm chỉ tính lại dòng tiền và ngân sách, không có điểm tổng hợp cho từng tháng trong quá khứ.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích Điểm sức khỏe tài chính của tôi: các nhóm điểm, trọng số và nhóm nào đang kéo điểm xuống.',
  source:
    'apps/api/src/modules/analytics-financial-health/financial-health-engine.ts:33-58,175-181,690-729',
};

export const analyticsTrends: Explanation = {
  id: 'analytics.trends',
  title: 'Xu hướng thu chi',
  summary: 'Diễn biến thu nhập và chi tiêu theo tháng trong khoảng đã chọn.',
  what: 'Chuỗi số liệu theo tháng, kèm trung bình tháng có phát sinh và mức biến động.',
  why: 'Cho thấy xu hướng dài hơn một tháng và giúp phát hiện tháng bất thường.',
  formula:
    'Trung bình tháng = tổng ÷ số tháng có phát sinh (không chia cho tháng trống)\nĐộ biến động = độ lệch chuẩn / trung bình × 100',
  howToRead:
    'Đường đi lên đều là xu hướng ổn định; đỉnh nhọn là tháng bất thường. Tháng không có giao dịch được đánh dấu riêng thay vì bị coi là tháng chi 0.',
  limitations: [
    'Chỉ dùng giao dịch Thu nhập và Chi tiêu, đúng loại tiền tệ đang chọn.',
    'Chuỗi 6 tháng gần nhất trên trang Tổng quan được tính từ dữ liệu sức khỏe tài chính, không gọi thêm endpoint xu hướng.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích biểu đồ Xu hướng thu chi của tôi và những điểm bất thường theo tháng.',
  source: 'apps/api/src/modules/analytics-trends/analytics-trends.service.ts:116-198,480-516',
};

export const analyticsCategories: Explanation = {
  id: 'analytics.categories',
  title: 'Phân tích theo danh mục',
  summary: 'Tỷ trọng, trung bình tháng và thay đổi của từng danh mục trong kỳ.',
  what: 'Tổng hợp theo danh mục các giao dịch cùng loại đang xem (thu nhập hoặc chi tiêu), kèm tỷ trọng trên tổng, mức trung bình mỗi tháng và so sánh với kỳ trước.',
  why: 'Giúp biết danh mục nào chiếm nhiều nhất và danh mục nào đang tăng nhanh.',
  formula:
    'Tỷ trọng = số tiền của danh mục / tổng của loại đang xem × 100 (0 nếu tổng ≤ 0)\nTrung bình tháng = số tiền danh mục / số tháng từ đầu kỳ đến hôm nay\nThay đổi % = (kỳ này − kỳ trước) / kỳ trước × 100',
  howToRead:
    'Danh mục có tỷ trọng lớn là nơi cắt giảm hiệu quả nhất. Danh mục mới xuất hiện hoặc tăng ≥25% so với kỳ trước được đánh dấu đáng chú ý.',
  limitations: [
    'Chỉ tính giao dịch đúng loại đang xem và đúng loại tiền tệ đang chọn.',
    'Danh mục đã lưu trữ vẫn được tính vào số liệu lịch sử nếu giao dịch cũ thuộc danh mục đó.',
    'Giao dịch không có danh mục được gom vào “Chưa phân loại”.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích phân tích chi tiêu theo danh mục của tôi: danh mục nào chiếm nhiều và danh mục nào đang tăng.',
  source:
    'apps/api/src/modules/analytics-category-budget/category-budget-analytics.service.ts:78-128,353-359',
};

export const analyticsBudgetAnalysis: Explanation = {
  id: 'analytics.budgetAnalysis',
  title: 'Phân tích ngân sách',
  summary: 'Mức sử dụng hạn mức, nhịp chi so với thời gian và dự kiến cạn hạn mức.',
  what: 'So sánh số đã chi với hạn mức của tháng, đồng thời tính mức chi kỳ vọng theo số ngày đã trôi qua.',
  why: 'Biết bạn đang chi nhanh hay chậm so với hạn mức, từ đó điều chỉnh trước khi vượt.',
  formula:
    'Mức sử dụng = đã chi / hạn mức × 100\nChi kỳ vọng = hạn mức × số ngày đã qua / tổng số ngày\nChênh nhịp = đã chi − chi kỳ vọng (dương = chi nhanh hơn nhịp)\nDự kiến cạn = ngày hôm nay + làm tròn lên((hạn mức − đã chi) / chi trung bình mỗi ngày)',
  howToRead:
    '“Vượt nhịp” nghĩa là nếu giữ tốc độ này, bạn sẽ chạm hạn mức trước cuối kỳ. “Trong nhịp” nghĩa là tốc độ chi đang phù hợp với thời gian còn lại.',
  limitations: [
    'Dự kiến cạn hạn mức là ước tính từ tốc độ chi hiện tại, không phải dự báo chắc chắn.',
    'Chỉ tính giao dịch Chi tiêu đúng loại tiền tệ đang chọn; hạn mức không có cột tiền tệ riêng.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích nhịp ngân sách của tôi: mức sử dụng, chi kỳ vọng và dự kiến cạn hạn mức.',
  source: 'apps/api/src/modules/analytics-category-budget/budget-analytics.ts:53-169',
};

export const analyticsForecast: Explanation = {
  id: 'analytics.forecast',
  title: 'Dự báo tài chính',
  summary:
    'Ước tính thu nhập, chi tiêu và số dư từ các tháng đã hoàn tất; là ước tính, không phải số liệu thực tế.',
  what: 'Dự báo dựa trên lịch sử các tháng đã kết thúc. Hệ thống chọn mô hình có sai số thấp nhất trên dữ liệu quá khứ và hiển thị kèm khoảng tốt nhất – xấu nhất.',
  why: 'Giúp chuẩn bị trước cho tháng tới thay vì chỉ nhìn lại quá khứ.',
  formula:
    'Cần ≥ 3 tháng đã hoàn tất có giao dịch\nMô hình: trung bình lịch sử, trung bình có trọng số hoặc xu hướng tuyến tính\nDự báo ròng = tổng thu nhập dự báo − tổng chi tiêu dự báo\nSố dư dự kiến = số dư hiện tại + thu nhập còn lại − chi tiêu còn lại',
  howToRead:
    'Dự báo tháng hiện tại chỉ tính phần còn lại của tháng. Độ tin cậy cao khi có nhiều tháng dữ liệu, sai số quá khứ thấp và dữ liệu liên tục.',
  limitations: [
    'Không tính khoản thu/chi chưa từng xuất hiện trong lịch sử, lãi suất hay lạm phát.',
    'Tháng hiện tại bị loại khỏi lịch sử huấn luyện vì chưa kết thúc.',
    'Dự báo không làm thay đổi bất kỳ giao dịch hay ngân sách nào.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích dự báo tài chính của tôi: mô hình được dùng, độ tin cậy và những rủi ro cần lưu ý.',
  source:
    'apps/api/src/modules/analytics-forecast/forecast-engine.ts:18-306; analytics-forecast.service.ts:239-477',
};

/* ---------------------------------- budgets --------------------------------- */

export const budgetsUtilization: Explanation = {
  id: 'budgets.utilization',
  title: 'Mức sử dụng ngân sách',
  summary: 'Phần trăm hạn mức đã dùng. Chạm 100% nghĩa là đã dùng hết hạn mức.',
  what: 'Tỷ lệ phần trăm giữa số tiền đã chi và hạn mức của ngân sách trong kỳ.',
  why: 'Là chỉ số chính để biết ngân sách còn an toàn hay đã bị vượt.',
  formula:
    'Mức sử dụng = đã chi / hạn mức × 100\nTrạng thái: Vượt hạn mức khi ≥ 100%; Sắp chạm khi đạt mốc cảnh báo; còn lại Trong mức',
  howToRead:
    'Dưới mốc cảnh báo là an toàn; từ mốc cảnh báo đến dưới 100% là cần tiết chế; từ 100% trở lên là đã vượt.',
  limitations: [
    'Đã chi chỉ gồm giao dịch Chi tiêu trong tháng của ngân sách; chuyển tiền không được tính.',
    'Nếu hạn mức bằng 0, tỷ lệ được hiển thị là 0% thay vì chia cho 0.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích mức sử dụng ngân sách của tôi: cách tính và ý nghĩa của từng trạng thái.',
  source: 'apps/api/src/modules/budgets/budgets.service.ts:84-116; common/utils/money.ts:28-31',
};

export const budgetsSpent: Explanation = {
  id: 'budgets.spent',
  title: 'Đã chi trong ngân sách',
  summary: 'Tổng chi tiêu thuộc phạm vi ngân sách trong tháng của ngân sách đó.',
  what: 'Với ngân sách theo danh mục, đây là tổng chi tiêu của danh mục đó; với ngân sách tổng, đây là tổng mọi khoản chi tiêu trong tháng.',
  why: 'Là con số được so trực tiếp với hạn mức để tính tiến độ.',
  formula:
    'Đã chi = tổng giao dịch EXPENSE trong kỳ ngân sách\n(có lọc theo danh mục nếu ngân sách theo danh mục)',
  howToRead:
    'So sánh với hạn mức và số còn lại. Nếu đã chi tăng nhanh vào đầu tháng, xem thêm phần nhịp ngân sách ở trang Phân tích.',
  limitations: [
    'Chỉ tính giao dịch Chi tiêu; chuyển tiền nội bộ không được tính.',
    'Không lọc theo loại tiền tệ, khác với phần ngân sách ở trang Phân tích.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích số Đã chi của ngân sách tháng này và vì sao nó tăng nhanh.',
  source: 'apps/api/src/modules/budgets/budgets.service.ts:84-99',
};

export const budgetsRemaining: Explanation = {
  id: 'budgets.remaining',
  title: 'Còn lại trong ngân sách',
  summary: 'Hạn mức trừ số đã chi. Số âm nghĩa là đã chi quá hạn mức.',
  what: 'Số tiền còn được phép chi theo ngân sách trong kỳ.',
  why: 'Cho biết bạn còn bao nhiêu dư địa trước khi chạm hạn mức.',
  formula: 'Còn lại = Hạn mức − Đã chi\n(âm khi đã chi vượt hạn mức)',
  howToRead:
    'Số dương là còn dư địa; số âm là mức vượt. Số còn lại không tự chia đều cho những ngày còn lại; muốn xem nhịp chi, dùng phần nhịp ngân sách.',
  limitations: ['Chỉ phản ánh giao dịch đã ghi, không trừ các khoản sắp phải trả.'],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích số Còn lại của ngân sách tháng này và tôi nên điều chỉnh chi tiêu thế nào.',
  source: 'apps/api/src/modules/budgets/budgets.service.ts:99',
};

export const budgetsWarningThresholds: Explanation = {
  id: 'budgets.warningThresholds',
  title: 'Mốc cảnh báo ngân sách',
  summary:
    'Các mốc phần trăm mà khi mức sử dụng chạm tới, ngân sách chuyển sang trạng thái cảnh báo sớm.',
  what: 'Danh sách các mốc phần trăm bạn đặt cho ngân sách. Khi mức sử dụng đạt hoặc vượt một mốc, trạng thái chuyển từ mức an toàn sang cảnh báo sớm.',
  why: 'Giúp bạn nhận cảnh báo sớm trước khi thực sự vượt hạn mức.',
  formula:
    'Sắp chạm khi mức sử dụng ≥ một mốc cảnh báo (và < 100%)\nVượt hạn mức khi mức sử dụng ≥ 100%\nMốc mặc định: 80% và 100%',
  howToRead:
    'Ví dụ mốc 80%: khi đã chi từ 80% hạn mức, ngân sách hiện “Sắp chạm”. Mốc càng thấp, cảnh báo càng sớm.',
  limitations: [
    'Mốc 100% không tạo thêm trạng thái riêng; từ 100% trở lên luôn là Vượt hạn mức.',
    'Trạng thái được tính tại thời điểm tải dữ liệu, không phải thông báo đẩy tức thời.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích mốc cảnh báo ngân sách của tôi: cách hoạt động và nên đặt mốc bao nhiêu.',
  source: 'apps/api/src/modules/budgets/budgets.service.ts:55,101-116',
};

/* ---------------------------------- insights -------------------------------- */

export const insightsMetricChange: Explanation = {
  id: 'insights.metricChange',
  title: 'Thay đổi theo tháng trước',
  summary: 'So sánh tháng đang xem với tháng dương lịch liền trước, tính bằng phần trăm.',
  what: 'Phần trăm thay đổi của thu nhập, chi tiêu hoặc tỷ lệ tiết kiệm so với tháng trước.',
  why: 'Giúp nhận ra tháng này khác tháng trước ở đâu.',
  formula:
    'Thay đổi % = (tháng này − tháng trước) / tháng trước × 100\nĐể trống nếu tháng trước bằng 0',
  howToRead:
    'Với chi tiêu, tăng là điều cần chú ý; với thu nhập và tiết kiệm, tăng thường là tích cực. Tỷ lệ tiết kiệm được so bằng “điểm %”, không phải phần trăm thay đổi.',
  limitations: [
    'Tháng trước bằng 0 thì không thể tính phần trăm; hệ thống để trống.',
    'Tháng đang xem có thể chưa kết thúc nên so sánh có thể chưa công bằng.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích các thay đổi so với tháng trước ở trang Insights của tôi và nguyên nhân chính.',
  source: 'apps/api/src/modules/insights/insights.service.ts:59-100,317-321',
};

export const insightsReferencePeriod: Explanation = {
  id: 'insights.referencePeriod',
  title: 'Kỳ tham chiếu',
  summary: 'Một tháng dương lịch, đúng một loại tiền tệ; tháng hiện tại chỉ gồm giao dịch đã ghi.',
  what: 'Trang Insights phân tích theo từng tháng dương lịch. Tháng hiện tại được gắn nhãn “đang diễn ra”; các tháng trước là “đã hoàn tất”.',
  why: 'Cùng một khung thời gian giúp so sánh giữa các tháng có ý nghĩa.',
  formula:
    'Tháng = từ ngày 1 đến hết ngày cuối tháng theo múi giờ của bạn\nTháng hiện tại nếu ngày kết thúc tháng còn ở tương lai',
  howToRead:
    'Đừng so tháng chưa kết thúc với tháng đã kết thúc mà quên rằng tháng này chưa ghi hết giao dịch. Hệ thống không tự chia đều số liệu theo số ngày.',
  limitations: [
    'Không quy đổi ngoại tệ; chỉ giao dịch đúng loại tiền tệ đang chọn.',
    'Không tự động ẩn tháng tương lai; chỉ có dữ liệu đã ghi mới được tính.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích kỳ tham chiếu và trạng thái tháng hiện tại ở trang Insights của tôi.',
  source: 'apps/api/src/modules/insights/insights.service.ts:265-355; common/utils/period.ts:69-94',
};

export const insightsCategories: Explanation = {
  id: 'insights.categories',
  title: 'Chi tiêu theo danh mục',
  summary: 'Tỷ trọng từng danh mục trong tháng và mức thay đổi so với tháng trước.',
  what: 'So sánh chi tiêu từng danh mục giữa tháng đang xem và tháng trước, kèm tỷ trọng trên tổng chi.',
  why: 'Giúp phát hiện danh mục tăng bất thường hoặc danh mục mới xuất hiện.',
  formula:
    'Tỷ trọng = chi danh mục / tổng chi × 100\nDanh mục đáng chú ý khi tháng trước > 0 và tăng ≥ 25%\nDanh mục mới khi tháng trước = 0 và tháng này > 0',
  howToRead:
    'Danh mục mới hoặc tăng mạnh là nơi nên xem lại trước. Danh mục giảm mạnh cũng đáng kiểm tra xem có giao dịch bị bỏ sót không.',
  limitations: [
    'Chỉ tính giao dịch Chi tiêu đúng loại tiền tệ đang chọn.',
    'Ngưỡng “đáng chú ý” là quy tắc của hệ thống, không phải lời khuyên tài chính.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích chi tiêu theo danh mục ở trang Insights của tôi: danh mục nào tăng và vì sao đáng chú ý.',
  source: 'apps/api/src/modules/insights/insights.service.ts:171-248',
};

/* ----------------------------------- goals ---------------------------------- */

export const goalsProgress: Explanation = {
  id: 'goals.progress',
  title: 'Tiến độ mục tiêu',
  summary: 'Số đã góp chia cho số tiền mục tiêu; số còn lại không bao giờ âm.',
  what: 'Phần trăm hoàn thành mục tiêu tiết kiệm, dựa trên tổng các khoản đã góp.',
  why: 'Giúp biết mục tiêu đang gần hay xa đích.',
  formula: 'Tiến độ = đã góp / số tiền mục tiêu × 100\nCòn lại = max(mục tiêu − đã góp, 0)',
  howToRead:
    'Khi tiến độ đạt 100%, mục tiêu chuyển sang Hoàn thành và không nhận thêm khoản góp vượt mức. Mục tiêu quá hạn vẫn giữ trạng thái gốc nhưng được hiển thị là Quá hạn.',
  limitations: [
    'Chỉ cộng các khoản góp đã ghi cho đúng mục tiêu.',
    'Số tiền mục tiêu không được sửa xuống thấp hơn số đã góp.',
  ],
  assistantType: SAVINGS,
  aiPrompt:
    'Giải thích tiến độ mục tiêu tiết kiệm của tôi: cách tính và ý nghĩa khi mục tiêu quá hạn.',
  source: 'apps/api/src/modules/goals/goal.mapper.ts:15-98; goals.service.ts:341-364',
};

export const goalsContributionPace: Explanation = {
  id: 'goals.contributionPace',
  title: 'Nhịp góp và khả năng tiết kiệm',
  summary: 'Ước tính khả năng tiết kiệm từ thu chi sáu tháng đã kết thúc, chừa 20% an toàn.',
  what: 'Khả năng tiết kiệm được tính từ số dư trung bình của sáu tháng đã hoàn tất gần nhất, giữ lại 20% làm khoản đệm an toàn.',
  why: 'Là cơ sở để gợi ý mỗi tháng nên góp bao nhiêu mà vẫn khả thi.',
  formula:
    'Khả năng tiết kiệm = (thu nhập trung bình − chi tiêu trung bình) × 80%\nChỉ lấy trung bình các tháng có phát sinh, không tính tháng trống',
  howToRead:
    'Nếu khả năng tiết kiệm thấp hơn số cần góp mỗi tháng, mục tiêu có thể bị đánh dấu “Có nguy cơ” hoặc “Không khả thi”.',
  limitations: [
    'Là ước tính từ quá khứ, không tính nghĩa vụ sắp tới, lãi suất hay lạm phát.',
    'Tháng chỉ có giao dịch chuyển tiền được coi là tháng trống.',
    'Hệ thống không cho bạn tự chọn thứ tự ưu tiên giữa các mục tiêu.',
  ],
  assistantType: SAVINGS,
  aiPrompt:
    'Giải thích nhịp góp và khả năng tiết kiệm của tôi: cách tính và vì sao hệ thống đề xuất mức góp đó.',
  source:
    'apps/api/src/modules/insights/savings-recommendation.ts:18-111; savings-recommendation.service.ts:119-181',
};

export const goalsExpectedCompletion: Explanation = {
  id: 'goals.expectedCompletion',
  title: 'Ngày hoàn thành dự kiến',
  summary: 'Ước tính từ số tiền còn lại và mức góp hiện tại; không phải cam kết.',
  what: 'Ngày mục tiêu có thể hoàn thành nếu giữ nguyên mức góp hiện tại.',
  why: 'Giúp so sánh kế hoạch với hạn chót bạn đặt ra.',
  formula:
    'Số tháng cần = làm tròn lên(số còn lại / mức góp mỗi tháng)\nNgày hoàn thành = hôm nay + số tháng cần\nNếu đã đủ tiền: hoàn thành ngay hôm nay',
  howToRead:
    'Nếu ngày dự kiến muộn hơn hạn chót, mục tiêu đang chậm. Tăng mức góp hoặc dời hạn chót để thu hẹp khoảng cách.',
  limitations: [
    'Chỉ là ước tính nếu bạn góp đều mỗi tháng; không tự động nhắc hay trừ tiền.',
    'Mục tiêu không có hạn chót vẫn có ngày dự kiến nếu biết mức góp.',
  ],
  assistantType: SAVINGS,
  aiPrompt: 'Giải thích ngày hoàn thành dự kiến của mục tiêu tiết kiệm và cách rút ngắn thời gian.',
  source: 'apps/api/src/modules/goals/goal.mapper.ts:31-81; savings/savings-progress.ts:261-263',
};

export const goalsSimulation: Explanation = {
  id: 'goals.simulation',
  // The panel title is prefixed into the trigger's accessible name; it avoids
  // the word "mô phỏng" so existing controls keep their unique accessible name.
  title: 'Kế hoạch thử nghiệm',
  summary: 'Thử các kịch bản góp tiền mà không thay đổi dữ liệu thật.',
  what: 'Cho phép thử đổi mức góp, đổi hạn chót, đổi số tiền mục tiêu hoặc chia ngân sách cho nhiều mục tiêu, rồi xem kết quả dự kiến.',
  why: 'Giúp chọn kế hoạch khả thi trước khi thực sự điều chỉnh mục tiêu.',
  formula:
    'Số tháng cần = làm tròn lên(số còn lại / mức góp)\nChênh lệch ngày hoàn thành = số tháng mô phỏng − số tháng hiện tại\nKhả thi nếu đạt hạn chót và mức góp không vượt khả năng tiết kiệm',
  howToRead:
    'So sánh cột hiện tại và mô phỏng: ngày hoàn thành sớm hơn nhưng mức góp vượt khả năng thì kế hoạch không khả thi.',
  limitations: [
    'Mô phỏng chỉ đọc dữ liệu, không tạo khoản góp hay sửa mục tiêu; bạn phải bấm áp dụng riêng.',
    'Không tính lãi suất, lạm phát hay thay đổi thu nhập trong tương lai.',
  ],
  assistantType: SAVINGS,
  aiPrompt: 'Giải thích kết quả mô phỏng kế hoạch tiết kiệm của tôi và kịch bản nào khả thi nhất.',
  source: 'apps/api/src/modules/savings/savings-plan.ts:47-95,202-218,285-293',
};

/* ----------------------------------- alerts --------------------------------- */

export const alertsType: Explanation = {
  id: 'alerts.type',
  title: 'Loại cảnh báo',
  summary:
    'Cảnh báo được tạo bởi ba quy tắc: giao dịch lớn, chi tiêu danh mục tăng đột biến, hoặc giao dịch trùng lặp.',
  what: 'Ứng dụng chỉ tạo ba loại cảnh báo chi tiêu: Giao dịch lớn, Tăng đột biến theo danh mục và Có thể trùng lặp.',
  why: 'Mỗi loại có cách phát hiện và mức độ khác nhau; biết loại giúp hiểu vì sao cảnh báo xuất hiện.',
  howToRead:
    'Giao dịch lớn so với thói quen chi tiêu của chính bạn; tăng đột biến so với các tháng trước; trùng lặp chỉ là gợi ý kiểm tra, không khẳng định bạn ghi sai.',
  limitations: [
    'Cảnh báo dựa trên giao dịch bạn đã ghi, không phải toàn bộ giao dịch ngân hàng.',
    'Không có tính năng giao dịch định kỳ trong hệ thống, nên cảnh báo không dựa trên lịch định kỳ.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích các loại cảnh báo chi tiêu trong ứng dụng và khi nào chúng xuất hiện.',
  source: 'apps/api/src/modules/alerts/detectors/*; scan-windows.ts:65-85',
};

export const alertsDetection: Explanation = {
  id: 'alerts.detection',
  title: 'Vì sao có cảnh báo này',
  summary: 'Giải thích được tạo từ dữ liệu phát hiện thực tế, không phải suy đoán thêm.',
  what: 'Mỗi cảnh báo lưu lại lý do phát hiện và các số liệu đi kèm như trung vị, tỷ lệ hoặc khoảng thời gian.',
  why: 'Giúp bạn kiểm chứng cảnh báo thay vì tin ngay vào một thông báo chung.',
  howToRead:
    'Đọc phần “Vì sao có cảnh báo này” và các số liệu chi tiết. Nếu thấy dữ liệu chưa đúng, bạn có thể đánh dấu cảnh báo là “Bình thường”.',
  limitations: [
    'Cảnh báo mang tính gợi ý, không kết luận về hành vi chi tiêu.',
    'Cảnh báo đã đóng sẽ không được tạo lại với cùng nội dung, kể cả khi quét lại.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích lý do một cảnh báo chi tiêu cụ thể xuất hiện và tôi nên kiểm tra gì.',
  source: 'apps/api/src/modules/alerts/scan-windows.ts; alert-scan.service.ts:249-273',
};

export const alertsEvidence: Explanation = {
  id: 'alerts.evidence',
  title: 'Bằng chứng của cảnh báo',
  summary: 'Các con số đã dẫn tới cảnh báo: trung vị, tỷ lệ, số giao dịch và khoảng thời gian.',
  what: 'Bằng chứng là dữ liệu thật được dùng khi phát hiện: số giao dịch lịch sử, trung vị, độ lệch, tỷ lệ so với mức thường ngày và khoảng thời gian so sánh.',
  why: 'Giúp bạn tự đánh giá cảnh báo có hợp lý không.',
  howToRead:
    'Tỷ lệ càng cao so với mức thường ngày thì mức bất thường càng lớn. Với giao dịch lớn, điểm z càng cao càng khác thói quen chi tiêu.',
  limitations: [
    'Giao dịch lớn cần ít nhất 8 giao dịch chi tiêu trước đó mới đủ dữ liệu so sánh.',
    'Tăng đột biến chỉ xét giao dịch Chi tiêu đúng loại tiền tệ mặc định và có danh mục.',
    'Trùng lặp xét cùng tài khoản, cùng loại, cùng số tiền, trong vòng 24 giờ.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích các bằng chứng trong một cảnh báo chi tiêu và cách tôi nên kiểm chứng.',
  source:
    'apps/api/src/modules/alerts/detectors/large-transaction.detector.ts:130-160; category-spike.detector.ts:126-180; possible-duplicate.detector.ts:26-121',
};

export const alertsSeverity: Explanation = {
  id: 'alerts.severity',
  title: 'Mức độ cảnh báo',
  summary: 'Mức độ phản ánh độ lớn bất thường so với ngưỡng; cảnh báo trùng lặp luôn ở mức Thấp.',
  what: 'Mức độ Thấp, Trung bình hoặc Cao cho biết cảnh báo lệch khỏi thói quen bao xa.',
  why: 'Giúp ưu tiên xem cảnh báo nào trước.',
  formula:
    'Giao dịch lớn: Cao khi điểm z ≥ 5; Trung bình khi z ≥ 3,5\nTăng đột biến: Cao khi tỷ lệ ≥ 2 lần trung vị; Trung bình khi ≥ 1,5 lần\nTrùng lặp: luôn Thấp',
  howToRead:
    'Ưu tiên cảnh báo Cao. Mức độ Trung bình nên xem qua; mức Thấp (trùng lặp) chỉ cần kiểm tra xem có ghi hai lần không.',
  limitations: [
    'Mức độ do quy tắc cố định quyết định, không điều chỉnh theo hoàn cảnh cá nhân.',
    'Giao dịch lớn có thể dùng quy tắc tỷ lệ khi dữ liệu quá ít biến động; khi đó điểm z có thể không có.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích mức độ cảnh báo chi tiêu và thứ tự tôi nên xử lý.',
  source:
    'apps/api/src/modules/alerts/detectors/large-transaction.detector.ts:130-160; category-spike.detector.ts:147-180; possible-duplicate.detector.ts:57-121',
};

/* -------------------------------- transactions ------------------------------- */

export const transactionsTypes: Explanation = {
  id: 'transactions.types',
  title: 'Loại giao dịch',
  summary:
    'Thu nhập là tiền vào, Chi tiêu là tiền ra; Chuyển tiền chỉ là dịch chuyển giữa các tài khoản của bạn.',
  what: 'Ứng dụng có ba loại: Thu nhập, Chi tiêu và Chuyển tiền. Chuyển tiền nội bộ không làm thay đổi tổng tài sản nên không được tính vào thu nhập hay chi tiêu.',
  why: 'Chọn đúng loại quyết định giao dịch có được tính vào phân tích thu chi hay không.',
  howToRead:
    'Nếu tiền chỉ đi từ tài khoản này sang tài khoản khác của bạn, hãy dùng Chuyển tiền nội bộ; nếu là tiền thực sự vào hoặc ra, dùng Thu nhập hoặc Chi tiêu.',
  limitations: [
    'Chuyển tiền chỉ hỗ trợ hai tài khoản cùng loại tiền tệ.',
    'Không có tính năng giao dịch định kỳ; mọi giao dịch đều được ghi thủ công.',
  ],
  assistantType: ANALYTICS,
  aiPrompt: 'Giải thích sự khác nhau giữa Thu nhập, Chi tiêu và Chuyển tiền nội bộ trong ứng dụng.',
  source: 'apps/api/src/modules/transactions/transactions.service.ts:89-195; schema.prisma:26-30',
};

export const transactionsCategory: Explanation = {
  id: 'transactions.category',
  title: 'Danh mục giao dịch',
  summary: 'Mỗi giao dịch Thu nhập hoặc Chi tiêu phải thuộc một danh mục cùng loại.',
  what: 'Danh mục giúp phân tích tiền đi đâu hoặc đến từ đâu. Danh mục Thu nhập chỉ dùng cho giao dịch Thu nhập; danh mục Chi tiêu chỉ dùng cho giao dịch Chi tiêu.',
  why: 'Thiếu danh mục hoặc chọn sai loại sẽ làm báo cáo theo danh mục không chính xác.',
  howToRead:
    'Nếu một khoản chi chưa có danh mục phù hợp, tạo danh mục mới trước khi ghi giao dịch. Danh mục đã lưu trữ không thể chọn cho giao dịch mới.',
  limitations: [
    'Danh mục hệ thống không thể sửa như danh mục của bạn.',
    'Tên danh mục phải khác nhau trong cùng một loại.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích cách chọn danh mục cho giao dịch và vì sao danh mục quan trọng với báo cáo.',
  source:
    'apps/api/src/modules/transactions/transactions.service.ts:89-103; categories.service.ts:41-59',
};

export const transactionsTransfer: Explanation = {
  id: 'transactions.transfer',
  title: 'Chuyển tiền nội bộ',
  summary:
    'Một giao dịch chuyển tiền tạo hai bút toán đối ứng và không được tính là thu nhập hay chi tiêu.',
  what: 'Khi chuyển tiền giữa hai tài khoản của bạn, hệ thống tạo một cặp giao dịch: một khoản chuyển đi ở tài khoản nguồn và một khoản nhận vào ở tài khoản đích.',
  why: 'Việc này giữ số dư từng tài khoản đúng mà không làm sai tổng thu nhập hay chi tiêu.',
  howToRead:
    'Bạn sẽ thấy nhãn “Chuyển đi” hoặc “Nhận vào”. Hai bản ghi này luôn đi cùng nhau; sửa một bên không được phép, xoá một bên sẽ xoá cả cặp.',
  limitations: [
    'Chỉ hỗ trợ cùng loại tiền tệ giữa hai tài khoản.',
    'Chuyển tiền không được tính vào phân tích thu chi, cảnh báo chi tiêu hay ngân sách.',
    'Không thể sửa giao dịch chuyển tiền; hãy xoá và tạo lại nếu cần.',
  ],
  assistantType: ANALYTICS,
  aiPrompt:
    'Giải thích cách hoạt động của Chuyển tiền nội bộ và vì sao nó không xuất hiện trong báo cáo thu chi.',
  source: 'apps/api/src/modules/transactions/transactions.service.ts:142-251',
};
