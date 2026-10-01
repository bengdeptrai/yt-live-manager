# 🎥 YouTube Multi-Stream Manager (Google Drive -> YouTube Live)

Hệ thống quản lý và phát trực tiếp đa luồng YouTube song song từ video lưu trên Google Drive 24/7. Hỗ trợ chạy trên máy tính cá nhân (Windows Desktop App), Web Online đa thiết bị, hoặc Máy ảo (VPS Ubuntu/Debian / Docker).

---

## ✨ Tính năng nổi bật

- 🎬 **Thêm & Quản lý nhiều luồng Live song song**:
  - Đặt tên luồng hiển thị riêng biệt.
  - Nhập mã luồng YouTube Studio (Stream Key) + tùy chọn URL RTMP (`rtmp://a.rtmp.youtube.com/live2`).
  - Hỗ trợ mọi link Google Drive (tự động nhận diện File ID, tên file và dung lượng).
  - Tùy chọn **Loop video lặp lại liên tục** (tự động phát vòng lặp 24/7 không đứt luồng).
  - Tùy chỉnh **Thời lượng Live** (để `= 0` để live mãi mãi 24/7 hoặc đặt số phút/giờ tự động ngắt).
  - **Đặt lịch live**: Hẹn ngày giờ tự động bắt đầu live hoặc phát ngay lập tức.
  - Nút **Bắt đầu**, **Hủy / Dừng**, **Sửa**, **Xóa**, và **Xem Log FFmpeg thời gian thực**.
- 📥 **Thanh hoàn tất tải video Google Drive (0% ➔ 100%)**:
  - Tự động nhận diện và tải video về bộ đệm cục bộ với thanh tiến trình trực quan (`MB đã tải / Tổng MB`).
  - Tránh lỗi đứt mạng mid-stream khi lặp lại 24/7.
- ⚡ **Chuẩn hóa H.264 tương thích 100% YouTube Live**:
  - Tự động mã hóa video từ Facebook, TikTok, VP9, AV1, HEVC sang H.264 chuẩn YouTube, tránh lỗi ngắt kết nối `-10054`.
- 💻 **Ứng dụng Desktop Windows + Web Dashboard**:
  - Mở dạng cửa sổ phần mềm độc lập không viền (`Open-Desktop-App.vbs`).
- 🌍 **Link Web Online & Chia sẻ Độc lập Tài nguyên**:
  - Tích hợp Cloudflare Tunnel tạo link công khai truy cập từ xa trên điện thoại / máy tính khác qua Internet.
  - **Chế độ Tách biệt Tài nguyên**: Khi chia sẻ link cho người khác, người nhận có thể tải file chạy về máy của họ để sử dụng 100% CPU/RAM của chính máy họ, không làm tốn tài nguyên máy chủ.

---

## 🚀 Hướng dẫn Cài đặt & Chạy

### 1. Chạy trên Windows (Máy tính cá nhân / VPS Windows)

1. Yêu cầu cài đặt **Node.js** (v18 trở lên).
2. Tải mã nguồn về máy:
   ```bash
   git clone <URL_REPO_GITHUB>
   cd yt-live-manager
   ```
3. Cài đặt thư viện:
   ```bash
   npm install
   ```
4. Khởi chạy:
   - Nhấp đúp vào **`start-windows.bat`** (hoặc **`Open-Desktop-App.vbs`**).
   - Hoặc chạy lệnh trong terminal:
     ```bash
     node server.js --desktop
     ```
   - Trình duyệt hoặc App sẽ tự động mở tại `http://localhost:3000`.

---

### 2. Triển khai trên Máy ảo Linux (VPS Ubuntu / Debian 24/7)

Chỉ cần 1 lệnh duy nhất để tự động cài đặt Node.js, FFmpeg và PM2 giữ ứng dụng chạy ngầm 24/7:

```bash
chmod +x setup-vps-ubuntu.sh && ./setup-vps-ubuntu.sh
```

Sau khi hoàn tất, truy cập bảng điều khiển tại: `http://IP-MAY-AO:3000`.

---

### 3. Triển khai bằng Docker

```bash
docker compose up -d --build
```

---

## 📁 Cấu trúc thư mục

```
yt-live-manager/
├── server.js              # Backend Node.js Express & FFmpeg Multi-Process Manager
├── package.json           # Cấu hình dự án & dependencies
├── start-windows.bat      # Script khởi động 1-click trên Windows
├── Open-Desktop-App.vbs   # Launcher mở App dạng cửa sổ Desktop độc lập
├── setup-vps-ubuntu.sh    # Script tự động cài đặt trên VPS Ubuntu 24/7
├── Dockerfile             # Cấu hình Docker container
├── docker-compose.yml     # Docker Compose orchestration
├── public/
│   ├── index.html         # Giao diện Web Dashboard & Trình điều khiển đa luồng
│   └── manifest.json      # PWA App Manifest
└── .gitignore             # Bỏ qua node_modules, cache video và stream keys
```

---

## 🔒 Bảo mật

File cấu hình luồng và mã luồng YouTube (`data/streams.json`) cùng các video tải về (`data/videos/`) được lưu cục bộ và nằm trong danh sách `.gitignore`, đảm bảo không bao giờ bị lộ lên GitHub.
