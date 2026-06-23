# Rest Area Turnamen

Website bracket turnamen responsif dengan area publik read-only dan dashboard admin untuk mengelola turnamen.

## Menjalankan

```bash
npm start
```

Buka `http://localhost:3000`.

## Login Admin

Default lokal:

- Username: `admin`
- Password: `admin123`

Untuk mengganti kredensial:

```bash
$env:ADMIN_USERNAME="nama-admin"
$env:ADMIN_PASSWORD="password-kuat"
npm start
```

Data bracket disimpan di `data/brackets.json`.

## Deploy ke Render

Project ini sudah menyertakan `render.yaml` untuk deploy sebagai Web Service di Render.

1. Upload project ini ke GitHub.
2. Buka Render Dashboard.
3. Pilih `New` -> `Blueprint`.
4. Connect repository project ini.
5. Isi environment variable rahasia saat diminta:

```text
ADMIN_USERNAME=admin-kamu
ADMIN_PASSWORD=password-kuat
```

`SESSION_SECRET` akan dibuat otomatis oleh Render dari konfigurasi `render.yaml`.

Konfigurasi Render yang dipakai:

```text
Build Command: npm install
Start Command: npm start
DATA_DIR: /opt/render/project/src/data
```

Data turnamen disimpan di persistent disk Render pada path:

```text
/opt/render/project/src/data/brackets.json
```

Jangan gunakan password default `admin123` saat website sudah publik.

### Supabase untuk data permanen gratis

Jika memakai Render free tanpa persistent disk, data file lokal bisa reset saat redeploy/restart. Untuk menyimpan data di Supabase:

1. Buat project Supabase.
2. Buka SQL Editor Supabase.
3. Jalankan isi file `supabase-schema.sql`.
4. Tambahkan environment variable di Render:

```text
SUPABASE_URL=https://project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service-role-key-rahasia
```

Jika kedua env tersebut tersedia, aplikasi otomatis memakai Supabase. Jika tidak tersedia, aplikasi fallback ke `data/brackets.json`.
