# Belajar integrasi Stitch ke QuotaNode

Desain Stitch sudah diadaptasi menjadi HTML, CSS, dan JavaScript biasa. Flask tetap menyajikan halaman serta API SQLite yang sama. A7670E ditulis sebagai target integrasi; data demo bukan hasil pengukuran modem.

## 1. HTML: menempatkan data

Buka `templates/index.html`. Sidebar, header, empat kartu, grafik, riwayat, dan panduan ada di file ini. Bentuk visual mengikuti export Stitch, sedangkan angka statis export sudah dihapus.

```html
<p id="quota" class="quota-value is-unknown">Memuat…</p>
```

`id="quota"` dipakai JavaScript untuk menemukan tempat sisa kuota. `class` menentukan tampilannya. Isi awal diganti setelah API berhasil dibaca. Pertahankan ID saat mengubah susunan kartu.

Jinja seperti `{% if demo_mode %}` dijalankan oleh Flask sebelum halaman dikirim. `DEMO_MODE` memberi label data dummy. `SIMULATION` menandai simulator yang memakai database sementara. Keduanya memiliki tujuan berbeda.

**Latihan:** ubah kalimat pada `page-subtitle`, simpan, jalankan ulang server bila template masih tersimpan di memori, lalu reload browser.

## 2. CSS: menerapkan desain responsif

Buka `static/css/style.css`. Variabel di `:root` menyimpan warna utama:

```css
:root {
  --page-bg: #f8fafc;
  --accent: #2563eb;
}
```

Semua aset UI lokal: tidak ada Tailwind CDN, Google Fonts, atau build frontend tambahan. Font memakai Inter atau JetBrains Mono jika sudah tersedia di komputer, dengan font sistem sebagai cadangan.

Grid kartu menjadi dua kolom mulai 640 px dan empat kolom mulai 1280 px. Sidebar menetap mulai 1024 px; di bawahnya menjadi drawer. Riwayat memakai kartu di bawah 768 px dan tabel yang dapat digeser pada layar lebih lebar.

```css
@media (min-width:640px) {
  .dashboard-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
```

`minmax(0,1fr)` membagi ruang secara seimbang dan mengizinkan teks panjang membungkus di dalam kartu.

**Latihan:** buka DevTools browser dan pilih lebar 375, 768, 1024, lalu 1440 px. Perhatikan perubahan grid dan riwayat. Gunakan Tab, Shift+Tab, Enter, dan Escape untuk memeriksa navigasi.

## 3. JavaScript: mengambil data API

Buka `static/js/script.js`. Alurnya:

1. `refreshData()` melakukan GET ke `/api/node/latest` dan `/api/node/history`.
2. Respons divalidasi sebelum dipakai.
3. `renderDashboard()` mengisi kartu, sedangkan `renderHistory()` mengisi tabel, kartu mobile, dan grafik.
4. Polling mengulang setiap 10 detik. Tombol “Refresh tampilan” menjalankan pembacaan yang sama.

```js
document.getElementById("quota").textContent = value;
```

`textContent` menampilkan data sebagai teks. Jangan menggantinya dengan HTML mentah dari API. Refresh tidak melakukan POST, tidak menulis database, dan tidak mengirim AT Command/USSD.

Aturan yang harus dipertahankan:

- `quota: null` berarti belum diketahui; `quota: 0` tetap ditampilkan sebagai `0.0 GB`.
- Heartbeat dan hasil cek kuota adalah dua informasi berbeda.
- Cek gagal mempertahankan kuota dan waktu sukses terakhir.
- Timestamp API tetap UTC; browser memformatnya ke WIB.
- Ketika pengambilan data gagal, data lama tetap terlihat dengan pesan kegagalan. Waktu pembaruan tidak dipalsukan.

`initSidebar()` di bagian akhir mengurus drawer, fokus keyboard, Escape, backdrop, serta penutupan setelah memilih menu. Tanpa JavaScript, navigasi tampil sebagai tautan biasa.

**Latihan:** hentikan simulator setelah data terlihat, lalu klik Refresh. Pastikan pesan gagal muncul dan nilai sebelumnya tetap ada.

## 4. Flask dan SQLite: kontrak tetap

`app.py`, autentikasi pengirim, endpoint, serta skema database tidak diubah oleh integrasi desain. Browser membaca data lewat API; browser tidak membuka SQLite secara langsung.

Jalankan dari terminal VS Code pada folder `D:\Ariel 24_TA\QuotaNode_TA\iot-monitoring`:

```powershell
# Preview dengan data sintetis dan database sementara terpisah.
.\.venv\Scripts\python.exe -B simulator.py --scenario demo
```

Buka `http://127.0.0.1:5001/`. Skenario demo mengirim heartbeat, sukses, kuota nol, dan cek gagal. Ketik `heartbeat`, `success`, `zero`, atau `failed`, kemudian klik Refresh. Untuk kondisi kosong, jalankan ulang dengan `--scenario empty`. Simulator tidak mengirim heartbeat otomatis; status dapat menjadi Offline setelah 180 detik. Hentikan dengan `quit` atau Ctrl+C agar database sementara dibersihkan.

Untuk membaca database project yang sudah ada:

```powershell
.\.venv\Scripts\python.exe -B app.py
```

Buka `http://127.0.0.1:5000/`. Gunakan server simulasi untuk menguji kiriman data. Jangan mengirim data contoh ke database project.

## 5. Pengujian dan pemulihan tampilan

```powershell
.\.venv\Scripts\python.exe -B -m unittest test_app test_simulator
node --check static/js/script.js
node --test test_dashboard.cjs
git diff --check
```

Backup sebelum integrasi berada di `D:\Ariel 24_TA\QuotaNode_TA_backups\stitch-20261101-124629`. Folder `source` berisi salinan source saat itu dan snapshot SQLite konsisten; `manifest.json` mencatat hash awal. `changes.patch` mencatat perubahan Git yang sudah ada sebelum integrasi.

Untuk memulihkan tampilan, hentikan server, lalu salin kembali tiga file dari `source\iot-monitoring`: `templates\index.html`, `static\css\style.css`, dan `static\js\script.js`. Jalankan server lagi dan reload browser. Pertahankan database aktif agar data baru yang masuk setelah backup tetap tersimpan. Snapshot database dipulihkan hanya jika memang sedang melakukan pemulihan data tersendiri.

Export Stitch asli tetap berada di ZIP semula. Referensi hasil ekstraknya berada di `D:\Ariel 24_TA\stitch_quotanode_reference\20261101-124629`.
