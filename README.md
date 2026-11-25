# Museum Companion · Bảo tàng Đà Nẵng

[Web trên điện thoại](https://thaihoa121179-ux.github.io/baotangdanang/)

Mở **Quét**, cấp quyền camera, đưa hiện vật vào ô giữa màn hình và bấm **Quét ngay**. Bạn cũng có thể chọn ảnh trong màn hình quét và bấm cùng nút đó. Mỗi lần bấm gửi một ảnh JPEG có cạnh dài tối đa 768 px. Gemini chỉ trả về ID và độ tin cậy. Web tra tên, mô tả, audio, transcript và nội dung chatbot trong danh mục. Kết quả được gắn nhãn **AI nhận diện** khi có ít nhất một ID hợp lệ đạt 0,5. Web chọn kết quả đầu tiên để mở ngay hai nút nghe và giới thiệu. Bấm một thẻ khác để đổi hiện vật.

Dùng **Đổi camera** để chuyển camera trước hoặc sau. **Chọn ảnh** mở ảnh của bạn để nhận diện bằng Gemini. Chọn **Khu trưng bày** để xác định nhóm gợi ý thủ công. Khi chưa chắc chắn hoặc lỗi kết nối, web gợi ý tối đa ba mục trong khu đã chọn. Các mục có điểm nhận diện dưới ngưỡng trong khu được ưu tiên nếu có.

## Chạy thử

Dùng máy chủ tĩnh từ thư mục repo.

```sh
python -m http.server 8000
```

Mở `http://localhost:8000/filehtml.html` trên máy tính. Bản GitHub Pages dùng `index.html`. Camera trên điện thoại cần mở qua HTTPS và cấp quyền camera cho trình duyệt. Có thể mở riêng file HTML để dùng bộ ảnh và audio đã nhúng. Để thử nhận diện, mở qua localhost hoặc HTTPS.

## Cấu hình Gemini

### Proxy Cloudflare Worker

1. Tạo một API key cho dự án demo trên [Google AI Studio](https://aistudio.google.com/apikey). Giới hạn key vào **Generative Language API** và dùng dự án có hạn mức phù hợp. Kiểm tra [tài liệu Gemini API](https://ai.google.dev/gemini-api/docs/models) hoặc gọi `GET /v1beta/models` trên `generativelanguage.googleapis.com` bằng key của dự án để xác minh model hỗ trợ `generateContent`.
2. Trong [docs/wrangler.toml](docs/wrangler.toml), đặt `CATALOG_URL` thành URL HTTPS công khai của `data/artifacts.json` và `ALLOWED_ORIGINS` thành origin của web, ví dụ `https://thaihoa121179-ux.github.io`. Nếu kiểm tra từ localhost, thêm `http://localhost:8000` vào danh sách phân cách bằng dấu phẩy. Khai báo secret và triển khai từ thư mục gốc của repo.

   ```sh
   npx wrangler login
   npx wrangler secret put GEMINI_API_KEY --config docs/wrangler.toml
   npx wrangler deploy --config docs/wrangler.toml
   ```

3. Trên điện thoại, mở **Quét → biểu tượng bánh răng → Cài đặt nhận diện và nhật ký**, dán URL HTTPS của Worker và lưu. Để áp dụng URL mặc định cho mọi thiết bị, đặt `CONFIG.PROXY_ENDPOINT` trong [js/recognize.js](js/recognize.js), chạy lại lệnh đồng bộ bên dưới và xuất bản. Mặc định URL để trống cho đến khi có Worker.
4. Model mặc định là `gemini-3.5-flash-lite`, một model Flash-Lite nhận ảnh. Đổi `CONFIG.MODEL` ở đầu module nếu dự án dùng model khác. Tùy chọn `GEMINI_MODEL` trong cấu hình Worker ghi đè model ở phía proxy. Đồng bộ HTML sau khi đổi cấu hình trình duyệt.

Worker dùng Prompt A và danh mục ở phía máy chủ. Trình duyệt chỉ gửi ảnh tới URL proxy. Worker giới hạn dung lượng ảnh, origin trình duyệt và số lượt mỗi IP. Origin là kiểm tra CORS, vì vậy hãy đặt hạn mức dự án và giới hạn chi phí phù hợp cho endpoint công khai.

### Thử tạm bằng key trong trình duyệt

Trong cùng phần cài đặt, để trống URL proxy, nhập key thử và lưu trên thiết bị đang dùng. Khi có URL proxy, web ưu tiên proxy. Key thử lưu trong localStorage của origin hiện tại và người có quyền truy cập trình duyệt có thể xem được. Dùng key riêng, giới hạn theo tên miền hoặc HTTP referrer nếu cấu hình của dự án hỗ trợ, giới hạn vào Generative Language API và đặt hạn mức thấp. Xóa key trong cài đặt và thu hồi key thử khi dùng xong. Key của bản công khai đặt trong secret của Worker.

## Cập nhật danh mục

Thêm hoặc sửa mục trong [data/artifacts.json](data/artifacts.json). Trường bắt buộc gồm `id` duy nhất (chữ thường ASCII, số, dấu gạch nối), `name`, `era`, `shortDesc`, `visualDesc`, `floor`, `frame` (1 hoặc 2), `audio`, `transcript`. Mục minh họa có thể để `era` và `floor` là `null`. `audio.vi` và `audio.en` có thể là tên bản ghi đã nhúng, đường dẫn `audio/ten-tep.mp3` cùng web hoặc `null` để đọc transcript bằng giọng của thiết bị. Có thể thêm `en`, `photoKey` có sẵn, `fullDesc` và `followUps` để bổ sung nội dung trình bày. Sửa dòng `TODO` của gốm Chu Đậu thành mô tả sát ảnh thực tế trước khi đo kết quả.

Trên web, luồng nhận diện đọc JSON hiện hành. Để cập nhật cả bản HTML mở riêng và các khu vực dùng dữ liệu nhúng, chạy lệnh đồng bộ, rồi xuất bản HTML và JSON cùng nhau.

```sh
node scripts/sync-demo.mjs
# Nếu bản đang quản lý dùng index.html
node scripts/sync-demo.mjs index.html
```

## Nhật ký nhận diện

Mở **Quét → biểu tượng bánh răng → Cài đặt nhận diện và nhật ký → Xuất log JSON**. Web ghi thời điểm, thời gian xử lý, nguồn ảnh, khung, trạng thái và các cặp ID/độ tin cậy hợp lệ vào console và giữ tối đa 500 lượt gần nhất trong localStorage. Để tính tỷ lệ chính xác, đối chiếu mỗi lượt với danh sách ID thật được ghi riêng cho ảnh thử. Trường `success` chỉ cho biết có kết quả qua ngưỡng, còn `confidence` là điểm Gemini tự báo.
