# Đầu tư ETF (chứng chỉ quỹ ETF niêm yết trên HOSE)

## Quyết định thiết kế: ETF là một `fund_type` mới, không phải `asset_type` mới

Một chứng chỉ quỹ ETF hoạt động y hệt một chứng chỉ quỹ mở trong app này: mua theo
đơn vị (units), định giá bằng `units × giá hiện tại`, bán từng phần, gán vào goal,
DCA hàng tháng, tính lãi/lỗ theo giá vốn. Toàn bộ bộ máy đó đã tồn tại và đã được
test kỹ quanh bảng `funds` + `investment_transactions(asset_type='fund')`:
sổ rút/bán (`lib/fundWithdrawal.ts`, `fund_sale_*` migrations), gán goal
(`/api/v1/fund-investments/*`), DCA, valuation (`lib/dashboardOverview.ts`).

Khác biệt thật sự của ETF chỉ có **hai**:

1. **Nguồn giá**. Quỹ mở lấy NAV từ Fmarket. ETF không có ở đó — đã kiểm chứng:
   feed Fmarket trả về 68 quỹ mở, **không quỹ ETF nào**. ETF khớp lệnh trên HOSE
   nên phải lấy **giá thị trường**.
2. **Cách gọi tên và cách hiển thị**: "giá thị trường / CCQ" chứ không phải "NAV",
   và người dùng muốn thấy nó tách riêng khỏi nhóm "Quỹ" trên thanh phân bổ.

Vì vậy: **KHÔNG** thêm `asset_type = 'etf'`. Thêm `fund_type = 'etf'` vào bảng
`funds`. Lưu ý `asset_type='stock'` đã có sẵn trong schema nhưng là loại *legacy*,
định giá tĩnh `units × unit_price`, không có giá tự động — không dùng lại nó.

## Nguồn giá: VNDirect dchart (đã kiểm chứng ngày 2026-09-18)

```
GET https://dchart-api.vndirect.com.vn/dchart/history?resolution=D&symbol=<MÃ>&from=<unix>&to=<unix>
→ { "t": [...], "o": [...], "h": [...], "l": [...], "c": [...], "s": "ok" }
```

Kết quả thử thật:

| Mã | Phiên cuối | `c` (nghìn đồng) | Giá thực |
|---|---|---|---|
| E1VFVN30 | 2026-09-18 | 35.61 | 35.610 ₫ |
| FUEVFVND | 2026-09-18 | 34.38 | 34.380 ₫ |
| FUESSVFL | 2026-09-18 | 29.38 | 29.380 ₫ |

Hai điểm quan trọng:

- **Giá trả về theo đơn vị nghìn đồng → phải nhân 1000.** Đây là cái bug nguy hiểm
  nhất của cả tính năng: sai ở đây thì toàn bộ tài sản lệch 1000 lần mà không có gì
  báo lỗi. Phải có unit test ghim tỷ lệ này, và một dải sanity (ví dụ từ chối giá
  ngoài khoảng 1.000 – 1.000.000 ₫/CCQ) trước khi ghi DB.
- **Một request cho mỗi mã**, khác Fmarket (một request cho tất cả). Đi qua
  `boundedFetchText` để dùng semaphore 6-đồng-thời và byte cap sẵn có.

Đã thử TCBS (`apipubaws.tcbs.com.vn`) — trả 403, bỏ.

`funds.nav` là `numeric(12,4)`, chứa 35610.0000 thoải mái. Cron `refresh-navs`
chạy 11:00 UTC = 18:00 giờ VN, tức là **sau khi HOSE đóng cửa (15:00)** — dùng lại
đúng khung giờ đó, không cần cron entry mới.

## Chia PR (theo luật repo: schema đi trước code, mỗi PR độc lập từ `main`)

### PR 1 — Migration: `fund_type` nhận thêm `'etf'`
Chỉ schema, không code app. Theo luật "schema ships before code": một PR vừa thêm
ràng buộc vừa đọc nó sẽ làm hỏng chính preview của nó.

- `supabase/migrations/<ts>_fund_type_admits_etf.sql`: drop + add lại
  `funds_fund_type_check` thành `('balanced','equity','debt','gold','etf')`.
- Test SQL trong `supabase/tests`: insert `fund_type='etf'` phải thành công,
  `'nonsense'` phải bị từ chối.
- `npm run test:db`.

### PR 2 — Nguồn giá HOSE + cron
- `lib/hose-price.ts`, viết theo đúng hợp đồng của `lib/fmarket-nav.ts`:
  - `normalizeSymbol()` (A-Z0-9), `fetchHosePrice(symbol)` → VND/CCQ hoặc `null`;
  - cache TTL ~60s + gộp request đang bay (chống stampede), như `fmarket-nav`;
  - `isEtfSymbolPriceable()` **fail open** khi upstream lỗi (chặn save là sai),
    cron **fail closed** (giá không xác minh được thì không ghi).
  - từ chối `s !== 'ok'`, mảng rỗng, giá ≤ 0, và giá ngoài dải sanity.
- `app/api/cron/refresh-navs/route.ts`: đọc thêm `fund_type`, tách hai nhánh —
  `etf` → HOSE, còn lại → Fmarket. Giữ nguyên `{ updated, failed }`, một nguồn
  chết không được kéo theo nguồn kia.
- `lib/fundPayload.ts`: thêm `'etf'` vào `FUND_TYPES`; `unpriceableFundCodeError`
  chọn nguồn kiểm tra theo `fund_type`.
- TDD: test ở `lib/__tests__/hose-price.test.ts` với `fetch` mock — payload thật
  rút gọn, ghim ×1000, các trường hợp hỏng. Test cron ở route test hiện có.

### PR 3 — Giao diện và cách gọi tên

**Giữ "CCQ".** Một đơn vị ETF *đúng là* một chứng chỉ quỹ — tên đầy đủ trên HOSE là
"Chứng chỉ quỹ ETF VFMVN DIAMOND". Không có từ nào chuẩn hơn, và đổi sang "cổ phiếu"
thì mới là sai.

**"NAV" mới là chỗ sai.** Một quỹ ETF có *hai* con số khác nhau cùng tồn tại: NAV/CCQ
do công ty quản lý quỹ công bố, và **thị giá** khớp trên sàn. Hai số này lệch nhau
(premium/discount), và cái app lưu là thị giá. Gọi nó là NAV không phải chuyện chữ
nghĩa — là gắn nhãn của một con số lên một con số khác.

| | Quỹ mở | ETF |
|---|---|---|
| Giá | NAV | **Thị giá** (Market price) |
| Số lượng | CCQ | CCQ (giữ nguyên) |
| Mã | Mã quỹ | **Mã CK** (niêm yết trên HOSE) |
| Số lẻ | 30,4567 CCQ | luôn số nguyên, lô 100 |

**Phạm vi — không đổi cả 41 chuỗi NAV.** Nguyên tắc: chỗ nào đã biết chắc loại quỹ thì
đặt nhãn theo loại; chỗ nào một bảng trộn cả hai thì dùng nhãn trung tính.

- *Biết chắc loại* (form thêm/sửa quỹ, màn chi tiết một holding, sheet mua/bán):
  "Thị giá" / "Market price" khi `fund_type='etf'`, "NAV" khi không.
- *Bảng trộn* (thư viện quỹ, danh sách holding trong goal): đổi tiêu đề cột `funds.colNav`
  và `dashboard.colNavAtPurchase` sang nhãn đúng cho cả hai — **"Giá/CCQ"** /
  "Price/unit" — vì tiêu đề cột không thể đổi theo từng dòng.
- *Không đụng*: planning, import Excel, landing — chưa có ETF ở đó.

**Định dạng số lượng**: ETF hiển thị CCQ dạng số nguyên, không 4 chữ số thập phân.

**Còn lại:**
- Thư viện quỹ: thêm lựa chọn loại "ETF" trong form thêm/sửa.
- Thanh phân bổ tài sản tách lát riêng, nhãn **"ETF"** — không gộp vào lát "Cổ phiếu"
  (lát đó là `asset_type='stock'` legacy) cũng không để chung lát "Quỹ". `fundType`
  **đã có sẵn** trên fund item ([contracts.ts:16](features/dashboard/contracts.ts:16)),
  nên chỉ sửa hàm thuần `computeAllocationTotals` trong
  `features/dashboard/overviewData.ts` + hai component `NetWorthCard` /
  `DesktopNetWorthPanel`. Không đụng API.
- Chuỗi i18n ở **cả** `messages/vi.json` và `en.json`. Grep `e2e/` trước khi đổi
  chuỗi cũ — có selector bám vào.

TDD: test đơn vị cho `computeAllocationTotals` và cho hàm chọn nhãn theo `fund_type`;
component test cho thanh phân bổ. **Không** thêm E2E mới.

### PR 4 — Ô "tiền thực nhận" khi bán ETF (theo đúng kiểu bank)

App **không** tự tính phí và thuế. Người dùng nhập số tiền môi giới thực sự trả
về, y như ô "tiền thực nhận" của sổ tiết kiệm — vì chỉ sổ xác nhận lệnh của công
ty chứng khoán mới biết con số thật (phí bậc thang, thuế 0,1%, lô lẻ bán giá khác).

Mô hình dữ liệu đã sẵn sàng, không cần migration: một dòng rút mang **ba** con số
độc lập — `amount_vnd` (tiền về), `units_withdrawn` (số CCQ bán) và
`principal_withdrawn` (giá vốn rời khỏi holding). Bank đã dùng đúng bộ ba này
(`lib/bankWithdrawal.ts`: `interest = received − principal`).

**Chiều mua: không cần làm gì.** Form mua đã nhận `amount` (tiền thực chi) và
`units` riêng biệt — nhập units tường minh thì `amount_vnd` không bị suy ra từ
`units × giá` nữa, nên phí mua đã nằm trong giá vốn sẵn. Chỉ nên thêm chữ gợi ý.

**Chiều bán — sửa `SellWithdrawSheet`:**

- Hiện tại với quỹ, ô số tiền làm **hai việc một lúc**: vừa là tiền thu về, vừa là
  mẫu số suy ra số CCQ bán (`unitsWithdrawn = numAmount / navPerUnit`). Nên nếu
  người dùng gõ thấp xuống cho khớp tiền thực nhận thì **số CCQ bán cũng tụt theo**
  — bán 100 CCQ mà chỉ ghi nhận ~99. Đây là lý do phải tách ô, không phải chuyện
  thẩm mỹ.
- Với `fund_type='etf'`: hiện thêm ô `received` (state đã có, đang bank-only),
  prefill bằng số tiền gộp, người dùng sửa xuống. Khi post:
  - `units_withdrawn` — vẫn suy ra từ ô số tiền **gộp** (số CCQ thật đã bán),
  - `principal_withdrawn` — `fundCostBasis()` theo units, giữ nguyên,
  - `amount_vnd` — `Math.round(numReceived)`, tiền về sau phí và thuế.
  - Lãi/lỗ hiển thị = `received − principal`, giống bank.
- Trigger `#587` đo lệnh bán theo `units_withdrawn` và `principal_withdrawn`,
  **không** theo `amount_vnd` (đã kiểm:
  `20260803000005_fund_sale_measured_against_every_claim.sql`), nên hạ `amount_vnd`
  xuống mức thực nhận là an toàn, không đụng ràng buộc nào.
- `SellItem` cần mang thêm `fundType` để sheet biết đây là ETF —
  `dashboardModel.buildFundSellItem` đọc nó từ fund item (đã có sẵn).

TDD: logic tách ô là hàm thuần (`previewEtfSale` cạnh `previewBankWithdrawal`),
test ở `lib/__tests__`; ca quan trọng nhất là "hạ tiền nhận không được làm giảm số
CCQ bán". Thêm một component test cho sheet. Không thêm E2E.

## Rủi ro
- `dchart-api.vndirect.com.vn` là endpoint không chính thức, có thể đổi/chặn.
  Giảm thiểu: `nav_auto_sync` vẫn là opt-in, người dùng luôn sửa giá tay được;
  cron fail closed nên hỏng nguồn = giá cũ, không phải giá rác.
- Sai hệ số ×1000 (xem trên) — ghim bằng test + dải sanity.
- Lô chẵn 100 CCQ trên HOSE: chỉ là hướng dẫn nhập liệu, không nên thành ràng buộc
  cứng (lô lẻ vẫn bán được).
