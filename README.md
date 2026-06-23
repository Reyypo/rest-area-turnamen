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
