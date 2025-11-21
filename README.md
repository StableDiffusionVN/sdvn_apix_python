# aPix Image Workspace

## Tiếng Việt
### Giới thiệu
aPix Image Workspace là một ứng dụng Flask đơn giản giúp bạn tạo hình ảnh dựa trên prompt, cho phép upload tài liệu tham khảo và chọn tỷ lệ khung hình, độ phân giải.

### Cài đặt
1. Tạo môi trường ảo (ví dụ `python -m venv .venv`) và kích hoạt nó.
2. Cài đặt dependency:
   ```bash
   pip install -r requirements.txt
   ```

### Sử dụng
1. Đặt biến môi trường `GOOGLE_API_KEY` với API key của Google GenAI hoặc nhập trực tiếp trong giao diện.
2. Chạy Flask:
   ```bash
   python app.py
   ```
3. Mở trình duyệt tới `http://127.0.0.1:8888`, nhập prompt, chọn tùy chọn và nhấn Generate.  
4. Hình ảnh: `static/generated` lưu nội dung mới nhất, còn `/gallery` trả về URL cho phần lịch sử.

## English
### Overview
aPix Image Workspace is a lightweight Flask frontend to Google GenAI image generation. You can submit a prompt, optional reference files, and pick aspect ratio/resolution.

### Setup
1. Create & activate a virtual environment (e.g., `python -m venv .venv`).
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Basic usage
1. Supply a `GOOGLE_API_KEY` via environment variable or the UI form.
2. Launch the app:
   ```bash
   python app.py
   ```
3. Visit `http://127.0.0.1:8888`, fill in the prompt and optional settings, then click Generate.
4. Generated assets appear in `static/generated/`, and `/gallery` exposes the list of saved images.
