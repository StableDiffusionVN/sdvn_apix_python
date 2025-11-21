# aPix Image Workspace

## Tiếng Việt
### Giới thiệu
aPix Image Workspace là một giao diện Flask nhẹ giúp bạn tạo hình ảnh bằng API Model Gemini Image 3 Pro (Nano Banana Pro). Bạn có thể gửi prompt, upload tài liệu tham khảo và điều chỉnh tỷ lệ khung hình/độ phân giải.

![Preview](./preview.jpeg)
Ảnh preview được lưu ngay tại `preview.jpeg` nếu bạn cần xem offline hoặc nhúng lại trong tài liệu khác.

### Cài đặt
1. Tạo môi trường ảo (ví dụ `python -m venv .venv`) và kích hoạt nó.
2. Cài đặt dependency:
   ```bash
   pip install -r requirements.txt
   ```

### Khởi chạy nhanh bằng `run_app`
1. Đặt `GOOGLE_API_KEY` qua biến môi trường hoặc giao diện.
2. Nháy đúp vào `run_app.command` trên macOS, `run_app.sh` trên Linux, hoặc `run_app.bat` trên Windows để tự động tìm Python, tạo `.venv`, cài `requirements.txt` và khởi động `app.py`.
3. Mở `http://127.0.0.1:8888`, nhập prompt/tùy chọn rồi nhấn Generate.
4. Hình ảnh mới nằm trong `static/generated/`; `/gallery` thể hiện lịch sử.

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
aPix Image Workspace is a lightweight Flask frontend for Google GenAI image generation powered by the Gemini Image 3 Pro (Nano Banana Pro) model. Submit a prompt, include reference files if needed, and choose aspect ratio/resolution.

![Preview](./preview.jpeg)
The preview screenshot is also stored as `preview.jpeg` in the repo for offline use or documentation embeds.

### Setup
1. Create & activate a virtual environment (e.g., `python -m venv .venv`).
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. macOS/Linux users can run `./run_app.sh`; Windows users can use `run_app.bat` (or `run_app.command`) to auto-detect Python, create the `.venv`, install deps, and launch the Flask server on port 8888.

### Quick start via `run_app`
1. Export `GOOGLE_API_KEY` via your environment or the UI form.
2. Double-click `run_app.command` on macOS, `run_app.sh` on Linux, or `run_app.bat` on Windows; each script auto-detects Python, creates `.venv`, installs `requirements.txt`, activates the virtualenv, and launches `app.py`.
3. Open `http://127.0.0.1:8888`, submit prompts/options, and click Generate.
4. New images appear under `static/generated/`, and `/gallery` exposes the history.
