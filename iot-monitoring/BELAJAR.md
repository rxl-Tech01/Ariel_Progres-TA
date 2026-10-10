# Belajar dari dashboard QuotaNode

Mulai dengan tiga file: `templates/index.html`, `static/css/style.css`, dan `static/js/script.js`. Kita menggunakan HTML, CSS, dan JavaScript biasa. Flask di `app.py` menyajikan halaman dan data dari SQLite. Tidak perlu mempelajari framework frontend tambahan untuk tahap ini.

## 1. HTML: tempat data ditampilkan

Cari `id="quota"` di `templates/index.html`:

```html
<p id="quota" class="quota-value is-unknown">Memuat…</p>
```

- `p` adalah elemen paragraf.
- `id="quota"` adalah alamat unik yang dicari JavaScript.
- `class="quota-value"` menghubungkan elemen dengan aturan tampilan CSS.
- `is-unknown` mengecilkan ukuran tulisan saat isinya berupa kalimat.
- `Memuat…` adalah isi awal, diganti setelah API memberi respons.

Tag `section` mengelompokkan bagian halaman, `article` menjadi kartu, dan `nav` menampung navigasi. Tautan `href="#history"` melompat ke bagian dengan `id="history"` pada halaman yang sama.

Bagian `{% if simulation %}` bukan HTML biasa. Itu sintaks Jinja yang dijalankan Flask sebelum HTML dikirim ke browser. Label simulasi hanya dibuat ketika server berada dalam mode simulasi. Macro `icon()` membuat SVG kecil yang dipakai ulang; ikon tidak bergantung pada internet.

**Latihan:** ubah kalimat di `page-subtitle`, simpan, lalu reload halaman. Jangan mengganti ID yang dipakai JavaScript. Jika perubahan HTML belum terlihat, Flask mungkin menyimpan template di memori; jalankan ulang server pengembangan.

## 2. CSS: warna, jarak, dan tata letak

Di awal `static/css/style.css`, `:root` menyimpan variabel warna:

```css
:root {
  --page-bg: #0b111b;
  --accent: #64ddcf;
}
```

`background: var(--page-bg)` mengambil warna latar dari variabel itu. Dengan begitu, beberapa bagian halaman menggunakan warna yang konsisten.

Cari `.overview-grid`. Pada desktop, grid membagi ruang untuk kuota dan kartu pendukung:

```css
.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: 18px;
}
```

`fr` adalah bagian ruang yang tersedia. Kolom kanan mendapat sedikit lebih banyak ruang. `gap` memberi jarak antarkolom. `minmax(0, ...)` mengizinkan kolom mengecil ketika teks panjang, supaya halaman tidak melebar di luar layar.

**Latihan:** ubah `gap` dari `18px` menjadi `24px`, lihat perbedaannya, lalu kembalikan. Ubah satu hal setiap kali agar kamu tahu penyebab perubahan.

## 3. Responsif: satu halaman untuk laptop dan HP

`<meta name="viewport" ...>` membuat lebar layout mengikuti layar perangkat. Media query mengubah aturan CSS menurut lebar **viewport** browser, bukan model HP:

```css
@media (max-width: 760px) {
  .metrics-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .history-table-wrap { display: none; }
  .history-cards { display: grid; }
}
```

`repeat(2, ...)` membentuk dua kolom dengan lebar sama. Tabel desktop disembunyikan dan kartu riwayat ditampilkan. Keduanya berasal dari array data yang sama; tidak ada API atau database khusus HP.

Breakpoint proyek:

| Lebar viewport | Perubahan |
| --- | --- |
| Di atas 1000 px | Kuota dan empat kartu pendukung berdampingan |
| 761–1000 px | Kuota di atas, empat kartu pendukung di bawah |
| Sampai 760 px | Kartu pendukung dua kolom; riwayat menjadi kartu |
| Sampai 440 px | Tombol refresh selebar area konten; informasi perangkat tersusun ulang |

**Latihan:** buka Developer Tools browser (`F12`), aktifkan tampilan perangkat, lalu coba 320, 390, 768, dan 1440 px. Pastikan halaman tidak perlu digeser ke samping, tombol mudah disentuh, dan kalimat “Belum diketahui” tetap terbaca. Pada desktop, tabel boleh bergeser di dalam panelnya sendiri.

Emulasi ukuran HP pada laptop berbeda dari akses memakai HP sungguhan. Alamat `127.0.0.1` selalu menunjuk perangkat yang membukanya: di HP, alamat itu menunjuk HP, bukan laptop. Server saat ini hanya untuk akses lokal laptop. Akses HP lewat Wi-Fi memerlukan pengaturan jaringan tersendiri; perubahan desain responsif tidak otomatis membuka akses jaringan.

## 4. JavaScript: menghubungkan data dan tampilan

Cari `refreshData()` dan `renderDashboard()` di `static/js/script.js`.

Alur saat halaman dibuka atau tombol refresh ditekan:

1. `fetch()` meminta JSON dari `/api/node/latest` dan `/api/node/history`.
2. `validateNodeData()` memeriksa bentuk data.
3. `renderDashboard(data)` mengisi kartu.
4. `renderHistory(history.readings)` membentuk tabel dan kartu HP.
5. `setInterval(..., 10000)` meminta pembaruan lagi setiap 10 detik, tanpa menumpuk request yang masih berjalan.

Inti pengisian data:

```javascript
document.getElementById("quota").textContent = "8.4 GB";
```

Ini contoh untuk memahami DOM, bukan pembacaan perangkat. Kode aplikasi mengambil nilai dari respons API. `textContent` menampilkan string sebagai teks, sehingga nama operator yang berisi karakter HTML tidak dieksekusi sebagai kode.

`null` berbeda dari `0`: `null` berarti belum diketahui; `0` berarti nilainya diketahui nol. Karena itu jangan menulis `if (!data.quota)` untuk menentukan apakah kuota tersedia. Gunakan `data.quota === null`.

Kartu HP menggunakan `<details>` dan `<summary>` agar bisa dibuka dengan sentuhan maupun keyboard. Riwayat yang tidak berubah tidak dibangun ulang, supaya fokus keyboard dan detail yang terbuka tetap terjaga saat polling.

## 5. Latihan dengan simulator

Dari folder `iot-monitoring`:

```powershell
.\.venv\Scripts\python.exe -B simulator.py
```

Buka `http://127.0.0.1:5001/`. Jika port sedang dipakai preview yang sudah berjalan, gunakan `--port 5002` dan buka port tersebut. Di terminal simulator, coba perintah satu per satu:

1. `heartbeat`: koneksi terhubung, kuota belum diketahui.
2. `success`: kuota sintetis menjadi 8,4 GB.
3. `zero`: nilai menjadi 0 GB dan indikator Kritis.
4. `failed`: cek gagal tetapi nilai nol dan waktu sukses tetap.
5. Tidak mengirim lebih dari 180 detik: koneksi menjadi Tidak terhubung setelah refresh.

Klik Refresh data atau tunggu pembaruan otomatis setelah setiap langkah. `quit` menutup simulator. Data simulasi bukan data penelitian.

## 6. Baru lanjut ke backend

Setelah HTML, CSS, dan JavaScript lebih nyaman, baca fungsi `latest_node()`, `node_history()`, dan `update_node()` di `app.py`. Browser hanya membaca data. Pengirim node melakukan POST dengan token. Menekan Refresh data tidak menjalankan USSD, tidak mengirim heartbeat perangkat, dan tidak menambah riwayat.

Target belajar tahap ini: bisa menjelaskan hubungan **ID HTML → aturan CSS → pengisian JavaScript → API Flask**, lalu mencoba satu perubahan kecil sendiri.
