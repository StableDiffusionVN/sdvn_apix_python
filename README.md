# aPix Image Workspace

## Tiếng Việt
### Giới thiệu
aPix Image Workspace là một giao diện Flask nhẹ giúp bạn tạo hình ảnh bằng API Model Gemini Image 3 Pro (Nano Banana Pro). Bạn có thể gửi prompt, upload tài liệu tham khảo và điều chỉnh tỷ lệ khung hình/độ phân giải.

![Preview](./preview.jpeg)

### Người tạo
- Người tạo: [Phạm Hưng](https://www.facebook.com/phamhungd/)
- Group: [SDVN - Cộng đồng AI Art](https://www.facebook.com/groups/stablediffusion.vn/)
- Website: [sdvn.vn](https://www.sdvn.vn)
- Donate: [sdvn.vn/donate](https://stablediffusion.vn/donate/)

### Khởi chạy nhanh bằng `run_app`
1. Nháy đúp vào `run_app.command` trên macOS, `run_app.sh` trên Linux, hoặc `run_app.bat` trên Windows để tự động tìm Python, tạo `.venv`, cài `requirements.txt` và khởi động `app.py`.
2. Mở `http://127.0.0.1:8888`, nhập prompt/tùy chọn rồi nhấn Generate.
3. Hình ảnh mới nằm trong `static/generated/`; `/gallery` thể hiện lịch sử.

### Sử dụng
1. Đặt biến môi trường `GOOGLE_API_KEY` với API key của Google GenAI hoặc nhập trực tiếp trong giao diện.
2. Mở trình duyệt tới `http://127.0.0.1:8888`, nhập prompt, chọn tùy chọn và nhấn Generate.  
3. Hình ảnh: `static/generated` lưu nội dung mới nhất, còn `/gallery` trả về URL cho phần lịch sử.
