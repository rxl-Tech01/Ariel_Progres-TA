# QuotaNode — Dashboard Monitoring IoT

Prototipe Tugas Akhir monitoring paket data seluler dengan target integrasi A7670E. Phase 1 menyediakan Flask, SQLite, API satu node, dan dashboard. Saat ini hardware belum terhubung ke aplikasi: angka dan status pada dashboard merupakan data dummy atau data uji, bukan hasil pengukuran modem. Integrasi AT Command/USSD masih tanggung jawab pengirim; keberhasilan transport heartbeat bukan keberhasilan cek kuota.

Dashboard memakai `DEMO_MODE=True` sebagai penanda tahap prototipe. Banner, kartu, grafik, dan riwayat diberi label demo; status Online pada data uji tidak ditampilkan sebagai bukti koneksi hardware. Refresh hanya membaca API dan tidak mengirim perintah ke modem. Flag ini tidak membuat data baru atau mengubah database. `SIMULATION` tetap khusus untuk server simulasi dengan database sementara terpisah. Ubah `DEMO_MODE` menjadi `False` hanya setelah integrasi hardware dan sumber pengukuran telah diverifikasi.

## Integrasi desain Stitch — 1 November 2026

Dashboard memakai tema terang dengan sidebar responsif. Layout export Stitch diadaptasi ke Jinja dan CSS lokal; tidak memerlukan Tailwind CDN, Google Fonts, atau build frontend. Empat kartu utama, grafik, riwayat, refresh 10 detik, format WIB, serta penanganan data kosong/error memakai API yang sudah ada. Refresh tampilan hanya membaca data dan tidak mengirim AT Command/USSD.

Panel yang belum memiliki data backend (suhu, tegangan, uptime, log AT, konfigurasi, total kapasitas paket), CSV, dan pagination disembunyikan. Operator berasal dari API, bukan teks by.U yang dipasang tetap. Target modem ditulis A7670E sebagai rencana integrasi. Kontrak endpoint, autentikasi, `app.py`, dan skema SQLite dipertahankan.

Sidebar menetap mulai 1024 px; di bawahnya menjadi drawer dengan Escape, backdrop, dan navigasi keyboard. Grid kartu memakai 1/2/4 kolom pada lebar <640 / 640–1279 / ≥1280 px. Riwayat menjadi kartu di bawah 768 px. Aset UI lokal dan font sistem tetap bekerja tanpa internet.

Panduan bertahap HTML → CSS → JavaScript → Flask, cara menjalankan simulator, serta rollback tampilan tersedia di `BELAJAR.md`. Backup source sebelum integrasi dan snapshot SQLite konsisten: `D:\Ariel 24_TA\QuotaNode_TA_backups\stitch-20261101-124629`. Referensi Stitch terpisah: `D:\Ariel 24_TA\stitch_quotanode_reference\20261101-124629`. Gunakan simulator untuk mencoba skenario data tanpa menulis database project.

## Teknologi dan struktur

Python 3.9+, Flask 3.1 (`requirements.txt`), SQLite dan unittest bawaan Python. Ruff sebagai dependensi pengembangan (`requirements-dev.txt`), memakai aturan lint default E4/E7/E9/F di `ruff.toml` agar tidak mewarisi konfigurasi luar proyek. Tampilan memakai HTML, CSS, JavaScript, font sistem, dan ikon SVG lokal; tidak membutuhkan Bootstrap/CDN atau koneksi internet untuk aset UI.

- `app.py`: API, validasi, autentikasi, penyimpanan, migrasi.
- `test_app.py`: pengujian dengan database sementara, bukan database operasional.
- `simulator.py`: server dan pengirim HTTP sintetis dengan database sementara terpisah.
- `test_simulator.py`, `test_dashboard.cjs`: pengujian isolasi simulasi dan penyajian waktu/status dashboard.
- `templates/index.html`, `static/js/script.js`, `static/css/style.css`: dashboard.
- `monitoring.sqlite3`: database lokal yang dibuat pada POST valid pertama.

## Instalasi dan menjalankan

PowerShell, dari `D:\Ariel 24_TA\QuotaNode_TA\iot-monitoring`:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:NODE_ID = 'NODE-001'
$env:NODE_API_TOKEN = .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
.\.venv\Scripts\python.exe app.py
```

`NODE_ID` opsional, default `NODE-001`; gunakan ID tidak kosong. Token di atas dibuat lokal, bukan token contoh tetap. Simpan token secara aman untuk pengirim; jangan taruh di HTML, JavaScript, URL, log, atau repository. Environment berlaku pada proses yang diluncurkan dari terminal tersebut. Untuk restart dengan token sama, gunakan secret tersimpan, bukan membuat ulang tanpa memperbarui pengirim.

Server pengembangan hanya mendengarkan `127.0.0.1:5000`, debug nonaktif. Buka **http://127.0.0.1:5000/**, bukan file HTML langsung. Hentikan dengan `Ctrl+C`. Jika `python` tidak tersedia gunakan `py` saat membuat venv. Deployment bukan cakupan phase 1; jangan mengirim Bearer token melalui HTTP jaringan tanpa TLS.

## Kontrak API phase 1

### `GET /` dan `GET /api/node/latest`

Publik, tanpa token, hanya membaca. GET tidak membuat database, memigrasi skema, atau menambah pembacaan. API memakai `Cache-Control: no-store`. Database kosong/tidak ada mengembalikan HTTP 200 dengan `hasData: false`, `status: "Unknown"`, field pengukuran/waktu `null`, `quota_check_status: "unknown"`, serta `nodeId` konfigurasi dan `server_time` UTC. Database gagal dibaca menghasilkan 503, bukan data dummy.

Contoh bentuk respons setelah cek sukses:

```json
{
  "nodeId": "NODE-001",
  "hasData": true,
  "status": "Online",
  "provider": "by.U",
  "quota": 0,
  "signal": -75,
  "expiredDate": null,
  "received_at": "2026-10-09T00:00:00.000000Z",
  "heartbeat_at": "2026-10-09T00:00:00.000000Z",
  "quota_checked_at": "2026-10-09T00:00:00.000000Z",
  "quota_check_status": "success",
  "server_time": "2026-10-09T00:00:30.000000Z"
}
```

- `quota`: GB, angka >= 0; **0 adalah nilai diketahui**, bukan kosong. `null` berarti belum diketahui.
- `expiredDate`: teks masa aktif 1–128 karakter atau `null` jika tidak diketahui; belum dinormalisasi menjadi tanggal ISO.
- `provider`: teks 1–128 karakter atau `null`. `signal`: angka dBm terbatas atau `null`.
- `received_at`: waktu UTC server menerima update terakhir, bukan waktu refresh browser.
- `heartbeat_at`: waktu UTC update phase 1 terakhir yang diterima. Setiap POST valid adalah heartbeat.
- `quota_checked_at`: waktu penerimaan server untuk cek kuota sukses terakhir, bukan waktu heartbeat atau waktu pengukuran perangkat. Tidak berubah saat cek gagal/heartbeat saja.
- `quota_check_status`: `unknown`, `success`, atau `failed`, status percobaan cek terakhir yang dilaporkan. Heartbeat saja mempertahankannya.
- `status`: dihitung ulang saat request: `Online` jika umur heartbeat 0–180 detik inklusif, selain itu `Offline`. Sebelum ada data: `Unknown`. Data legacy tanpa heartbeat diketahui: `Offline`.
- `server_time`: waktu evaluasi respons UTC. Jam server harus benar.

Hanya baris terbaru milik `NODE_ID` yang dibaca; data node lain tidak menjadi fallback.

### `GET /api/node/history?limit=10`

Publik dan read-only, hanya `NODE_ID` konfigurasi; parameter node dari browser tidak mengubah scope. `limit` berupa digit ASCII bernilai 1–100, default 10; kosong, berulang, pecahan, negatif, atau di luar batas menghasilkan 400. Respons `{nodeId, readings, server_time}` memakai `Cache-Control: no-store`; database kosong/tidak ada menghasilkan `readings: []`, gagal dibaca menghasilkan 503.

`readings` berisi snapshot SQLite menurut ID penerimaan menurun (terbaru dahulu), termasuk timestamp UTC server dan kuota nullable. Field sama seperti latest, tetapi `status` diganti `status_at_observation` yang tersimpan saat penerimaan; `server_time` hanya di tingkat respons. Status historis tidak dihitung ulang menjadi status live. Status legacy merupakan catatan lama, bukan bukti heartbeat valid. GET tidak membuat database, memigrasi, atau menambah snapshot. Reload browser tetap membaca riwayat tersimpan.

### `POST /api/node/update`

Wajib `Authorization: Bearer <NODE_API_TOKEN>` dan `Content-Type: application/json`. Token dibaca dari environment server, dibandingkan dengan `hmac.compare_digest`. Konfigurasi token hilang/kosong: 503 (fail closed); kredensial salah/hilang: 401. Browser tidak memerlukan atau menyimpan token.

Payload terkecil, heartbeat saja:

```json
{"nodeId": "NODE-001"}
```

Cek kuota sukses:

```json
{"nodeId": "NODE-001", "quotaCheck": "success", "quota": 0, "expiredDate": null, "provider": "by.U", "signal": -75}
```

Cek kuota gagal:

```json
{"nodeId": "NODE-001", "quotaCheck": "failed"}
```

- `nodeId` wajib tepat sama konfigurasi server.
- `provider` dan `signal` opsional di semua update: tidak dikirim mempertahankan nilai lama, `null` menghapus nilai menjadi tidak diketahui.
- `quotaCheck` opsional; jika hadir hanya `success` atau `failed`.
- `success` wajib menyertakan `quota` angka terbatas >= 0 dan `expiredDate` teks atau `null`. Mengganti nilai, masa aktif, dan waktu sukses sebagai satu transaksi.
- Tanpa `quotaCheck` atau dengan `failed`, `quota`/`expiredDate` dilarang. Nilai kuota, masa aktif, dan waktu sukses lama tetap tersimpan, termasuk nol.
- Field lain ditolak, termasuk `status` dan timestamp kiriman. Kontrak enam field prototype lama diganti kontrak ini.
- Tipe salah, boolean sebagai angka, NaN/Infinity, JSON rusak, atau node salah: 400. Media type salah: 415. Payload >16 KiB: 413. Kegagalan database: 503; tidak melaporkan sukses atau menimpa data lama.
- Sukses: HTTP 200 dengan bentuk respons yang sama seperti GET. POST append snapshot dalam transaksi SQLite; baca state lama dan simpan state baru di bawah write lock.

Contoh mengirim heartbeat dari terminal yang mempunyai token sama:

```powershell
$headers = @{ Authorization = "Bearer $env:NODE_API_TOKEN" }
$body = @{ nodeId = 'NODE-001' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5000/api/node/update' -Headers $headers -ContentType 'application/json' -Body $body
```

Usulan pengirim: heartbeat setiap **60 detik**. Cek kuota memiliki jadwal sendiri; laporkan `failed` jika percobaan gagal. Jangan mengirim ulang nilai cache sebagai cek sukses baru.

## SQLite dan migrasi

Database berada di sebelah `app.py`. POST valid pertama membuat/memigrasi skema secara transaksional (`BEGIN IMMEDIATE`). Migrasi skema prototype mempertahankan semua ID, baris, nilai, dan `received_at` persis, termasuk node lain. Kolom kuota/masa aktif kini nullable. Kegagalan migrasi atau INSERT membatalkan seluruh transaksi.

Legacy tidak membuktikan kapan kuota terakhir berhasil dicek atau heartbeat valid diterima: `quota_checked_at` dan `heartbeat_at` tetap `null`, status cek `unknown`. GET legacy bisa membaca nilai lama tanpa migrasi. Heartbeat pertama tidak mengarang waktu cek sukses; hanya laporan `success` baru mengisinya. Simpan backup database sebelum mengganti versi aplikasi operasional. Migrasi otomatis hanya mencakup skema prototype `readings` yang ada, bukan skema arbitrer.

## Perilaku dashboard

Tema terang mengikuti desain Stitch, dengan sidebar navy dan aksen biru. CSS Grid/Flexbox menyusun empat kartu utama. Pada lebar di bawah 768 px, riwayat berubah menjadi kartu dengan detail yang dapat dibuka; pada layar lebih lebar, tabel dapat digeser di dalam panel. Semua field observasi tetap tersedia pada kedua tampilan. Polling riwayat yang sama mempertahankan DOM/fokus, dan detail terbuka dipertahankan saat data berubah. Label simulasi tetap terlihat, sedangkan penjelasan panjang ada di “Cara membaca dashboard”. Panduan pemula beserta latihan tersedia di [BELAJAR.md](BELAJAR.md).

Data dimuat saat awal, lalu polling setiap 10 detik; tombol refresh manual tetap tersedia. Polling berarti browser membaca API, sedangkan heartbeat berarti perangkat mengirim POST. Polling tidak memperbarui heartbeat. Satu siklus membaca latest lalu history; siklus yang masih berjalan tidak ditumpuk, dengan timeout total 9 detik. Timer tab latar belakang dapat ditunda browser. Timestamp API/database tetap UTC; dashboard memformatnya dalam WIB (`Asia/Jakarta`), termasuk ketika zona waktu komputer berbeda. Umur pembacaan dihitung dari waktu cek sukses terakhir terhadap `server_time`, bukan jam komputer, dan berlaku saat pembaruan layar. Waktu cek tersebut masih waktu penerimaan server, bukan waktu ukur perangkat. Masa aktif tetap teks operator, tidak dipaksa menjadi tanggal. Kosong dan nilai belum diketahui tampil eksplisit, nol tampil `0.0 GB`. Status cek diterjemahkan menjadi Berhasil/Gagal/Belum diketahui; perangkat menjadi Terhubung/Tidak terhubung. Offline dan cek gagal bisa ditampilkan bersamaan. Online tidak menjamin kuota baru. Tidak ada batas usia kuota buatan karena interval cek kuota belum disepakati.

Jika API gagal, data sebelumnya tetap tampil dengan pesan error; tidak menyimpulkan node Offline dari kegagalan HTTP. Badge kuota: >2 GB Aman, 1–2 GB Peringatan, <1 GB Kritis, null Belum diketahui. Bar sinyal masih pendekatan prototype.

Tabel menampilkan 10 observasi terbaru dari API history SQLite, bukan snapshot lokal; polling tidak menambah duplikat. Status tabel berlaku saat observasi, bukan status live kartu perangkat. Kuota historis dapat mempertahankan hasil sukses sebelumnya. Latest dan history dibaca dalam dua request, sehingga update yang masuk di antaranya dapat membuat tabel sedikit lebih baru. Akses keyboard, label tabel, dan live region pesan tetap tersedia.

Kolom status cek terakhir dan waktu cek sukses menunjukkan konteks setiap nilai kuota. Heartbeat mempertahankan status cek sebelumnya; baris berlabel Berhasil tidak otomatis berarti cek baru terjadi pada baris tersebut.

## Simulasi tanpa modem

Dari folder `iot-monitoring`, gunakan venv dan dependensi yang sama:

```powershell
.\.venv\Scripts\python.exe -B simulator.py
```

Buka **http://127.0.0.1:5001/**. Halaman selalu berlabel **SIMULASI — bukan hasil pengukuran perangkat**, memakai node `SIM-NODE-001`. Awalnya kosong. Ketik perintah berikut di terminal simulator, tekan Enter, lalu klik **Refresh Data** atau tunggu polling:

| Perintah | Hasil |
| --- | --- |
| `heartbeat` | Perangkat terhubung; kuota tetap belum diketahui jika belum pernah sukses |
| `success` | Cek sintetis berhasil: 8,4 GB, provider simulasi, sinyal -75 dBm |
| `zero` | Cek sintetis berhasil: 0 GB, status Kritis |
| `failed` | Cek gagal; kuota dan waktu sukses terakhir dipertahankan |
| `demo` | Kirim heartbeat → sukses 8,4 GB → sukses nol → gagal; hasil akhir nol dan gagal |
| `quit` | Hentikan server dan hapus database sementara |

`demo` mengirim empat laporan berurutan dengan cepat; untuk mengamati perubahan satu per satu gunakan perintah terpisah. Tidak ada heartbeat otomatis. Setelah **lebih dari 180 detik** tanpa pengiriman, refresh akan menampilkan Tidak terhubung. Jangan menyimpulkan paket habis hanya dari status ini. Masa aktif sintetis sengaja belum diketahui.

Simulator menjalankan server dan pengirim dalam satu proses khusus, memakai HTTP lokal nyata, token acak hanya di memori, serta database di folder sementara OS. Tidak membaca/menulis `monitoring.sqlite3` dan tidak memakai token operasional. Jangan mengimpor dan menjalankan simulator dalam proses server operasional. Database simulasi dihapus saat keluar normal, Ctrl+C, atau akhir input; penghentian paksa dapat menyisakan folder sementara. Setiap sesi baru dimulai kosong. Data ini bukan data penelitian.

Untuk langsung mengisi demo:

```powershell
.\.venv\Scripts\python.exe -B simulator.py --scenario demo
```

Opsi `--port 5002` tersedia bila 5001 dipakai; `--no-input` menjalankan server tanpa menu sampai Ctrl+C. Server selalu di `127.0.0.1`; tidak menerima alamat tujuan eksternal.

## Pengujian

Dari folder `iot-monitoring`:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -B -m unittest -v test_app test_simulator
.\.venv\Scripts\python.exe -m ruff check .
node --check static/js/script.js
node --test test_dashboard.cjs
git diff --check
```

Tes meliputi auth/fail closed, kosong/read-only, nol, heartbeat dan gagal cek, timeout 180 detik, scope node, validasi payload, persistensi lintas proses, migrasi/rollback, kegagalan database, halaman dan aset. Tidak memakai database operasional. History diuji untuk kosong, urutan, persistensi lintas proses, scope node, limit invalid, status historis, dan read-only. Ruff memeriksa kesalahan Python umum; unittest memeriksa perilaku. Pemeriksaan sintaks JavaScript memerlukan Node.js, bukan dependensi aplikasi. Tidak ada typecheck tambahan.

Pemeriksaan manual: buka database kosong, kirim heartbeat, kirim sukses nol, kirim gagal, lalu Refresh. Pastikan waktu sukses tetap. Setelah >180 detik tanpa heartbeat, Refresh menampilkan Offline. Hentikan server dan Refresh untuk memeriksa error serta data lama. Periksa keyboard dan layar sempit.

## Batas phase 1

Belum ada integrasi modem, multi-node, deployment, retensi database, rate limiting, atau replay protection/idempotency. POST berulang dianggap penerimaan baru; gunakan token hanya pada pengirim tepercaya. Snapshot bertambah per update, tanpa pembersihan otomatis. Status layar merupakan status saat refresh terakhir, bukan indikator real-time.
