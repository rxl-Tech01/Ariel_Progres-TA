# QuotaNode — Dashboard Monitoring IoT

Prototype website untuk Tugas Akhir:

**Rancang Bangun Sistem Monitoring Ketersediaan Paket Data pada Node IoT Menggunakan Modul SIM7000 Berbasis AT Command dan USSD.**

Tahap saat ini mempelajari komunikasi frontend dengan backend melalui HTTP API. Flask menampilkan dashboard dan menyediakan data dummy. Belum ada database, pembacaan AT Command/USSD, atau koneksi SIM7000.

## Teknologi

- HTML, CSS, JavaScript, dan Bootstrap 5 untuk dashboard.
- Python 3.9 atau lebih baru dan Flask 3.1 untuk backend.
- `unittest` bawaan Python untuk pengujian backend.

Tidak memerlukan Node.js atau npm untuk menjalankan aplikasi. Bootstrap dimuat melalui CDN, sehingga tampilan lengkap membutuhkan koneksi internet.

## Struktur proyek

```text
iot-monitoring/
├── app.py
├── requirements.txt
├── test_app.py
├── README.md
├── assets/
├── templates/
│   └── index.html
└── static/
    ├── css/
    │   └── style.css
    └── js/
        └── script.js
```

| File / folder | Fungsi |
| --- | --- |
| `app.py` | Membuat aplikasi Flask, menampilkan halaman utama, dan menyediakan endpoint data node. |
| `requirements.txt` | Daftar dependensi Python: `Flask>=3.1,<4`. |
| `test_app.py` | Menguji halaman utama, respons API, dan akses file CSS/JavaScript. |
| `templates/index.html` | Struktur dashboard yang dirender oleh Flask. |
| `static/css/style.css` | Penyesuaian tampilan dashboard dan pesan error. |
| `static/js/script.js` | Pengambilan API, validasi data, render dashboard, dan riwayat sementara. |
| `assets/` | Folder cadangan dari prototype awal; belum digunakan. File yang ingin dilayani Flask sebaiknya ditempatkan di `static/`. |

## Instalasi dan menjalankan

Contoh berikut menggunakan PowerShell pada Windows.

1. Buka terminal pada folder proyek:

   ```powershell
   cd "D:\Ariel 24_TA\QuotaNode_TA\iot-monitoring"
   ```

   Sesuaikan path jika lokasi proyek berbeda.

2. Buat virtual environment agar dependensi terpisah dari instalasi Python global:

   ```powershell
   python -m venv .venv
   ```

3. Instal dependensi:

   ```powershell
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

   Perintah ini sudah menginstal Flask. Alternatif instalasi Flask secara langsung:

   ```powershell
   .\.venv\Scripts\python.exe -m pip install "Flask>=3.1,<4"
   ```

4. Jalankan server:

   ```powershell
   .\.venv\Scripts\python.exe app.py
   ```

5. Buka dashboard melalui **http://127.0.0.1:5000/**.

   Respons JSON dapat dilihat di **http://127.0.0.1:5000/api/node/latest**.

Hentikan server dengan `Ctrl+C` pada terminal tempat server berjalan. Untuk menjalankan kembali, cukup ulangi langkah 4; instalasi tidak perlu diulang setiap kali.

Jika perintah `python` tidak tersedia tetapi Python Launcher terpasang, gunakan `py -m venv .venv` pada langkah 2. Pemanggilan interpreter `.venv` secara langsung tidak membutuhkan aktivasi PowerShell.

Buka website melalui Flask, bukan dengan membuka `templates/index.html` melalui `file:///`. Aplikasi menggunakan server pengembangan lokal di `127.0.0.1` dengan debug nonaktif; bukan konfigurasi deployment produksi.

## Endpoint API

### `GET /`

Menampilkan `templates/index.html`. Flask menyediakan CSS dan JavaScript melalui direktori `static/`, dengan alamat yang dibentuk oleh `url_for()` pada template.

### `GET /api/node/latest`

Mengembalikan respons JSON dummy berikut:

```json
{
  "nodeId": "NODE-001",
  "status": "Online",
  "provider": "by.U",
  "quota": 8.4,
  "signal": -75,
  "expiredDate": "24 Oktober 2026"
}
```

| Field | Makna |
| --- | --- |
| `nodeId` | Nama atau ID node. |
| `status` | `Online` atau `Offline`. |
| `provider` | Nama operator SIM. |
| `quota` | Sisa kuota berupa angka dalam GB, tidak negatif. |
| `signal` | Nilai sinyal berupa angka dalam dBm; frontend juga mendukung `null` jika tidak tersedia. |
| `expiredDate` | Teks tanggal masa aktif paket. |

Data berada dalam fungsi `latest_node()` di `app.py`. Nilainya tetap sama pada setiap request sampai kode dummy diubah. Jika mengubah data saat server berjalan, hentikan dan jalankan ulang server karena debug/reload otomatis tidak aktif.

## Alur frontend dan backend

1. Browser meminta halaman `/` dari Flask.
2. JavaScript menjalankan `refreshData()` ketika halaman dimuat.
3. `getNodeData()` memanggil `fetch("/api/node/latest", { cache: "no-store" })`.
4. Flask mengembalikan JSON. Frontend memeriksa `response.ok`, lalu membaca JSON dengan `response.json()`.
5. Frontend menambahkan `lastUpdate` menggunakan waktu lokal browser dan memvalidasi data.
6. Dashboard diperbarui, pembacaan ditambahkan ke riwayat, lalu tabel dirender kembali.

`fetch()` bekerja secara asynchronous: kode menggunakan `await` untuk menunggu respons tanpa melakukan reload halaman. URL relatif memakai host dan port yang sama dengan halaman Flask sehingga tidak membutuhkan konfigurasi CORS tambahan.

### Pembagian fungsi JavaScript

| Fungsi | Tanggung jawab |
| --- | --- |
| `getNodeData()` | Meminta data API dan menambahkan waktu penerimaan. |
| `validateNodeData()` | Memeriksa field wajib, status, serta tipe nilai kuota dan sinyal. |
| `renderDashboard()` | Memperbarui kartu dan indikator. |
| `addHistory()` | Menambahkan salinan data terbaru, maksimal 10 pembacaan. |
| `renderHistory()` | Menampilkan riwayat ke tabel. |
| `refreshData()` | Mengatur pengambilan, validasi, render, dan penanganan error. |
| `quotaStatus()` | Menentukan label dan warna status kuota. |

## Perilaku dashboard

- **Refresh Data** memanggil API kembali, bukan membuat angka acak di JavaScript.
- **Last Update** adalah waktu browser setelah menerima respons, bukan waktu pembacaan SIM7000. Formatnya `HH:MM:SS`; dua request pada detik yang sama dapat menampilkan waktu identik.
- Status perangkat memakai badge hijau untuk Online dan merah untuk Offline.
- Sinyal ditampilkan sebagai angka dBm, label, dan indikator bar. Ketika Offline atau sinyal `null`, dashboard menampilkan “Tidak tersedia”. Batas bar masih pendekatan prototype, bukan hasil kalibrasi SIM7000.
- Riwayat menampilkan maksimal 10 pembacaan terbaru dan hilang saat halaman dimuat ulang.
- Tombol dinonaktifkan selama request dan diaktifkan kembali setelah selesai.
- Jika jaringan, respons HTTP, atau format data bermasalah, pesan error tampil. Data sebelumnya tidak dihapus dan riwayat tidak ditambah.
- Jika request pertama gagal, dashboard tetap menampilkan placeholder. Kegagalan API tidak otomatis berarti node Offline.

### Status kuota

| Sisa kuota | Label | Warna |
| --- | --- | --- |
| Lebih dari 2 GB | Aman | Hijau |
| 1 sampai 2 GB, termasuk kedua batas | Peringatan | Kuning |
| Kurang dari 1 GB | Kritis | Merah |

Untuk mencoba badge, ubah `quota` pada backend menjadi `2`, `1`, atau `0.8`, jalankan ulang server, lalu tekan Refresh Data.

## Pengujian

Jalankan dari folder proyek setelah dependensi terinstal:

```powershell
.\.venv\Scripts\python.exe -B -m unittest -v test_app
```

Tes memakai test client Flask; server tidak perlu dijalankan terpisah. Pengujian mencakup halaman utama, isi JSON dummy, serta respons file CSS dan JavaScript. Jika contoh data backend sengaja diubah, sesuaikan nilai harapan pada tes API.

Pemeriksaan manual:

1. Buka dashboard dan pastikan data API terlihat pada kartu.
2. Tunggu beberapa detik, lalu tekan Refresh Data; periksa Last Update dan baris riwayat baru.
3. Tekan Refresh berulang kali; pastikan riwayat tidak melebihi 10 baris.
4. Hentikan server tanpa menutup halaman, lalu tekan Refresh untuk melihat pesan error dan memastikan data terakhir tetap tampil.
5. Jalankan server kembali, lalu tekan Refresh untuk memulihkan pembacaan.
6. Periksa tampilan pada layar sempit dan navigasi tombol menggunakan keyboard.

Belum ada konfigurasi lint atau typecheck khusus pada proyek.

## Masalah umum

- **`ModuleNotFoundError: No module named 'flask'`**: instal `requirements.txt` menggunakan interpreter `.venv`, lalu jalankan aplikasi dengan interpreter yang sama.
- **Dashboard tidak dapat dibuka**: pastikan proses Flask masih berjalan dan alamat memakai port `5000`.
- **Port 5000 sedang digunakan**: hentikan proses server proyek sebelumnya sebelum menjalankan instance baru.
- **Tampilan Bootstrap tidak termuat**: periksa koneksi internet atau akses browser ke CDN.
- **Kuota tidak berubah setelah Refresh**: normal; backend saat ini mengembalikan data dummy tetap.

## Batas tahap saat ini

Belum ada database, penyimpanan riwayat permanen, komunikasi SIM7000, AT Command, USSD, autentikasi, atau pemantauan perangkat asli. Prototype ini khusus untuk memahami alur dashboard, HTTP API, dan backend Flask.
