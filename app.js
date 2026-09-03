// =================================================================
//  ABSENSI GURU — CLIENT (GitHub Pages, memanggil backend GAS via API)
// =================================================================

// ================= STATE GLOBAL =================
let currentUser = null;
let pengaturan = null;
let posisiSekarang = null;
let jarakSekarang = null;
let radiusAktif = null;      // radius titik lokasi terdekat saat ini
let namaTitikTerdekat = '';  // nama titik lokasi terdekat saat ini
let fotoBase64 = null;
let statusHariIni = { masuk: null, pulang: null };
let cameraStream = null;
let watchId = null;
let orientasiCetak = 'portrait'; // default sesuai permintaan: portrait, bisa diganti user ke landscape
const BULAN_NAMA = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

// Kolom cetak: Tanggal SENGAJA tidak di sini karena dikunci selalu tampil.
// key harus sama persis dengan field yang dipakai backend (getPengaturanKolomCetak/simpanPengaturanKolomCetak).
const KOLOM_CETAK_DAFTAR = [
  { key: 'tampilHari', label: 'Hari' },
  { key: 'tampilJamMasuk', label: 'Jam Masuk' },
  { key: 'tampilStatusMasuk', label: 'Status Masuk' },
  { key: 'tampilJamPulang', label: 'Jam Pulang' },
  { key: 'tampilStatusPulang', label: 'Status Pulang' },
  { key: 'tampilDurasi', label: 'Durasi Kerja' },
  { key: 'tampilKeterangan', label: 'Keterangan' }
];
let kolomCetak = { tampilHari:true, tampilJamMasuk:true, tampilStatusMasuk:true, tampilJamPulang:true, tampilStatusPulang:true, tampilDurasi:true, tampilKeterangan:true };
let rekapTerakhir = null; // menyimpan hasil rekap terakhir supaya toggle kolom bisa render ulang tanpa panggil API lagi

// ================= PEMANGGIL API (CORS-SAFE) =================
// PENTING: Content-Type harus text/plain agar browser TIDAK mengirim
// preflight OPTIONS (Apps Script web app tidak bisa merespons preflight).
async function callApi(action, params){
  if (!window.API_URL || window.API_URL.indexOf('GANTI_DENGAN') === 0){
    throw new Error('API_URL belum diatur. Buka index.html dan ganti window.API_URL dengan URL Web App GAS Anda.');
  }
  const res = await fetch(window.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action }, params || {}))
  });
  if (!res.ok) throw new Error('Server merespons HTTP ' + res.status);
  return await res.json();
}

// ================= UTIL =================
function show(el){ document.getElementById(el).style.display = ''; }
function hide(el){ document.getElementById(el).style.display = 'none'; }
function setText(id, txt){ document.getElementById(id).textContent = txt; }

function tampilkanPesan(idEl, pesan, tipe){
  const other = tipe === 'error' ? idEl.replace('error','success') : idEl.replace('success','error');
  const el = document.getElementById(idEl);
  el.textContent = pesan;
  el.style.display = pesan ? 'block' : 'none';
  const elOther = document.getElementById(other);
  if (elOther) elOther.style.display = 'none';
}

function haversineMeters(lat1, lng1, lat2, lng2){
  const R = 6371000;
  const toRad = v => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function pindahView(nama){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + nama).classList.add('active');
}

// Cek konfigurasi API_URL saat halaman dibuka, agar error terlihat jelas sejak awal
window.addEventListener('DOMContentLoaded', () => {
  if (!window.API_URL || window.API_URL.indexOf('GANTI_DENGAN') === 0){
    const w = document.getElementById('config-warning');
    w.textContent = 'API_URL belum dikonfigurasi. Edit index.html dan ganti window.API_URL dengan URL Web App GAS Anda (lihat PANDUAN_GITHUB_PAGES.md).';
    w.style.display = 'block';
    document.getElementById('btn-login').disabled = true;
  }
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  terapkanOrientasiCetak(orientasiCetak);
});

// ================= LOGIN =================
async function handleLogin(){
  const nip = document.getElementById('login-nip').value.trim();
  const pass = document.getElementById('login-pass').value.trim();
  tampilkanPesan('login-error', '', 'error');
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Memeriksa…';

  try {
    const res = await callApi('login', { nip, password: pass });
    btn.disabled = false; btn.textContent = 'Masuk';
    if (!res.success){ tampilkanPesan('login-error', res.message, 'error'); return; }
    currentUser = res;
    if (res.role === 'Admin'){ initAdmin(); pindahView('admin'); }
    else { initAbsen(); pindahView('absen'); }
  } catch (err){
    btn.disabled = false; btn.textContent = 'Masuk';
    tampilkanPesan('login-error', 'Gagal terhubung ke server: ' + err.message, 'error');
  }
}

function handleLogout(){
  if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
  if (watchId) navigator.geolocation.clearWatch(watchId);
  location.reload();
}

// ================= HALAMAN ABSEN (GURU) =================
function initAbsen(){
  setText('absen-nama-guru', currentUser.nama);
  updateJamSekarang();
  setInterval(updateJamSekarang, 1000);

  callApi('getPengaturanPublik').then(p => {
    pengaturan = p;
    document.getElementById('absen-libur-notice').style.display = p.libur ? 'block' : 'none';
    updateTombolState();
  }).catch(() => {});
  callApi('getStatusHariIni', { nip: currentUser.nip }).then(renderStatusHariIni).catch(() => {});

  startGeolocation();
  startCamera();
}

function updateJamSekarang(){
  const d = new Date();
  setText('absen-jam-sekarang', d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' }));
}

function renderStatusHariIni(res){
  statusHariIni = res;
  tampilkanSelesai('masuk', res.masuk);
  tampilkanSelesai('pulang', res.pulang);
  updateTombolState();
}

// Menampilkan kartu "✓ Tercatat pukul .." tepat menggantikan tombol yang
// jenis absennya sudah terekam hari ini, sehingga tidak bisa absen ulang.
function tampilkanSelesai(jenis, info){
  const btn = document.getElementById('btn-' + jenis);
  const kotak = document.getElementById('selesai-' + jenis);
  if (info){
    btn.style.display = 'none';
    kotak.style.display = 'flex';
    setText('jam-selesai-' + jenis, info.jam);
    const badge = document.getElementById('kode-selesai-' + jenis);
    badge.textContent = info.status;
    badge.className = 'code-badge code-' + info.status;
  } else {
    btn.style.display = '';
    kotak.style.display = 'none';
  }
}

function startGeolocation(){
  if (!navigator.geolocation){
    document.getElementById('gauge-status').textContent = 'GPS tidak didukung perangkat ini';
    document.getElementById('gauge-status').className = 'gauge-status bad';
    return;
  }
  watchId = navigator.geolocation.watchPosition(pos => {
    posisiSekarang = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    updateGauge();
  }, () => {
    document.getElementById('gauge-status').textContent = 'Izin lokasi ditolak / tidak tersedia';
    document.getElementById('gauge-status').className = 'gauge-status bad';
  }, { enableHighAccuracy:true, maximumAge:2000, timeout:15000 });
}

function updateGauge(){
  if (!pengaturan || !posisiSekarang) return;
  const titikList = pengaturan.titikLokasi || [];
  if (titikList.length === 0){
    document.getElementById('gauge-status').textContent = 'Belum ada titik lokasi diatur admin';
    document.getElementById('gauge-status').className = 'gauge-status bad';
    return;
  }

  // Cari titik terdekat dari semua titik yang admin isi (titik kosong sudah
  // tidak dikirim backend sama sekali, jadi tidak perlu dicek di sini lagi).
  let titikTerdekat = titikList[0];
  let jarakMin = haversineMeters(posisiSekarang.lat, posisiSekarang.lng, titikList[0].lat, titikList[0].lng);
  for (let i = 1; i < titikList.length; i++) {
    const j = haversineMeters(posisiSekarang.lat, posisiSekarang.lng, titikList[i].lat, titikList[i].lng);
    if (j < jarakMin) { jarakMin = j; titikTerdekat = titikList[i]; }
  }
  jarakSekarang = Math.round(jarakMin);
  radiusAktif = titikTerdekat.radius;
  namaTitikTerdekat = titikTerdekat.nama;
  setText('gauge-jarak', jarakSekarang);

  const circumference = 113.1;
  const maxDisplay = Math.max(radiusAktif * 5, 100);
  const fraction = Math.max(0, Math.min(1, 1 - (jarakSekarang / maxDisplay)));
  const offset = circumference * (1 - fraction);
  const fillEl = document.getElementById('gauge-fill');
  fillEl.style.strokeDashoffset = offset;

  const statusEl = document.getElementById('gauge-status');
  if (jarakSekarang <= radiusAktif){
    fillEl.style.stroke = 'var(--emerald)';
    statusEl.className = 'gauge-status ok';
    statusEl.textContent = 'Dalam radius ' + namaTitikTerdekat + ' (maks ' + radiusAktif + ' m)';
  } else {
    fillEl.style.stroke = 'var(--rose)';
    statusEl.className = 'gauge-status bad';
    statusEl.textContent = 'Di luar radius, absen akan ditolak (terdekat: ' + namaTitikTerdekat + ')';
  }
  updateTombolState();
}

// ---------- KAMERA ----------
function pesanErrorKamera(err){
  const nama = err && err.name ? err.name : '';
  switch (nama){
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Izin kamera ditolak untuk situs ini. Ketuk ikon gembok/info di address bar → Izin Situs → aktifkan Kamera, lalu muat ulang halaman.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Kamera tidak ditemukan pada perangkat ini.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi kamera/video call lain lalu coba lagi.';
    case 'OverconstrainedError':
      return 'Kamera depan tidak tersedia, mencoba kamera lain…';
    case 'SecurityError':
      return 'Akses kamera diblokir karena halaman tidak dibuka melalui koneksi aman (https).';
    default:
      return 'Kamera tidak dapat diakses (' + (nama || 'error tidak diketahui') + '). Ketuk tombol di bawah untuk mencoba lagi.';
  }
}

function startCamera(){
  const hint = document.getElementById('camera-hint');
  hide('btn-retry-camera');
  hint.style.display = 'block';
  hint.textContent = 'Mengaktifkan kamera…';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    hint.textContent = 'Browser ini tidak mendukung akses kamera. Gunakan Chrome/Safari versi terbaru, jangan lewat browser dalam aplikasi (WhatsApp/Instagram).';
    show('btn-retry-camera');
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio:false })
    .then(pasangStreamKamera)
    .catch(err => {
      if (err && err.name === 'OverconstrainedError'){
        navigator.mediaDevices.getUserMedia({ video: true, audio:false })
          .then(pasangStreamKamera)
          .catch(err2 => tampilkanErrorKamera(err2));
      } else {
        tampilkanErrorKamera(err);
      }
    });
}

function pasangStreamKamera(stream){
  cameraStream = stream;
  const video = document.getElementById('camera-video');
  video.srcObject = stream;
  document.getElementById('camera-hint').style.display = 'none';
  hide('btn-retry-camera');
}

function tampilkanErrorKamera(err){
  document.getElementById('camera-hint').textContent = pesanErrorKamera(err);
  show('btn-retry-camera');
}

function retryCamera(){
  if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
  startCamera();
}

function ambilFoto(){
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  canvas.width = video.videoWidth || 480;
  canvas.height = video.videoHeight || 640;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  fotoBase64 = canvas.toDataURL('image/jpeg', 0.85);

  document.getElementById('camera-result').src = fotoBase64;
  document.getElementById('camera-result').style.display = 'block';
  video.style.display = 'none';
  document.getElementById('btn-shutter').style.display = 'none';
  document.getElementById('btn-retake').style.display = 'block';
  updateTombolState();
}

function ambilUlang(){
  fotoBase64 = null;
  document.getElementById('camera-result').style.display = 'none';
  document.getElementById('camera-video').style.display = 'block';
  document.getElementById('btn-shutter').style.display = 'block';
  document.getElementById('btn-retake').style.display = 'none';
  updateTombolState();
}

function updateTombolState(){
  const dalamRadius = jarakSekarang !== null && radiusAktif !== null && jarakSekarang <= radiusAktif;
  const adaFoto = !!fotoBase64;
  const hariLibur = pengaturan && pengaturan.libur;
  const btnMasuk = document.getElementById('btn-masuk');
  const btnPulang = document.getElementById('btn-pulang');

  btnMasuk.disabled = hariLibur || !(dalamRadius && adaFoto) || !!statusHariIni.masuk;
  btnPulang.disabled = hariLibur || !(dalamRadius && adaFoto) || !!statusHariIni.pulang || !statusHariIni.masuk;
}

async function kirimAbsen(jenis){
  if (!posisiSekarang || !fotoBase64){
    tampilkanPesan('absen-error', 'Pastikan lokasi terdeteksi dan foto selfie sudah diambil.', 'error');
    return;
  }
  const btnId = jenis === 'Masuk' ? 'btn-masuk' : 'btn-pulang';
  const btn = document.getElementById(btnId);
  btn.disabled = true; const teksAsli = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span>Mengirim…';
  tampilkanPesan('absen-error', '', 'error');
  tampilkanPesan('absen-success', '', 'success');

  try {
    const res = await callApi('submitAbsen', {
      nip: currentUser.nip, nama: currentUser.nama, jenis,
      lat: posisiSekarang.lat, lng: posisiSekarang.lng, fotoBase64
    });
    btn.textContent = teksAsli;
    if (!res.success){
      tampilkanPesan('absen-error', res.message, 'error');
      updateTombolState();
      return;
    }
    tampilkanPesan('absen-success', 'Absen ' + jenis + ' berhasil pukul ' + res.jam + ' — Status: ' + res.pesanStatus + ' (jarak ' + res.jarak + ' m dari ' + res.titikLokasi + ').', 'success');
    ambilUlang();
    callApi('getStatusHariIni', { nip: currentUser.nip }).then(renderStatusHariIni).catch(() => {});
  } catch (err){
    btn.textContent = teksAsli;
    tampilkanPesan('absen-error', 'Gagal mengirim: ' + err.message, 'error');
    updateTombolState();
  }
}

// ================= HALAMAN ADMIN =================
function initAdmin(){
  setText('admin-nama', currentUser.nama);
  const bulanSelect = document.getElementById('rekap-bulan');
  bulanSelect.innerHTML = BULAN_NAMA.map((b,i) => '<option value="' + (i+1) + '">' + b + '</option>').join('');
  const now = new Date();
  bulanSelect.value = now.getMonth() + 1;
  document.getElementById('rekap-tahun').value = now.getFullYear();

  callApi('getDaftarGuru').then(list => {
    const optsGuru = list.filter(g => g.role !== 'Admin').map(g => '<option value="' + g.nip + '">' + g.nama + ' — ' + g.nip + '</option>').join('');
    document.getElementById('rekap-nip').innerHTML = optsGuru;
    document.getElementById('izin-nip').innerHTML = optsGuru;
  }).catch(() => {});

  muatRiwayatIzin();
  muatPengaturanKolomCetak();
}

let jadwalKerjaSudahDimuat = false;
let titikLokasiSudahDimuat = false;

function gantiTabAdmin(tab){
  document.getElementById('tab-btn-rekap').classList.toggle('active', tab === 'rekap');
  document.getElementById('tab-btn-izin').classList.toggle('active', tab === 'izin');
  document.getElementById('tab-btn-jamkerja').classList.toggle('active', tab === 'jamkerja');
  document.getElementById('tab-btn-lokasi').classList.toggle('active', tab === 'lokasi');
  document.getElementById('tab-rekap').style.display = tab === 'rekap' ? '' : 'none';
  document.getElementById('tab-izin').style.display = tab === 'izin' ? '' : 'none';
  document.getElementById('tab-jamkerja').style.display = tab === 'jamkerja' ? '' : 'none';
  document.getElementById('tab-lokasi').style.display = tab === 'lokasi' ? '' : 'none';
  if (tab === 'jamkerja' && !jadwalKerjaSudahDimuat){
    muatJadwalKerja();
  }
  if (tab === 'lokasi' && !titikLokasiSudahDimuat){
    muatTitikLokasi();
  }
}

function kodeBadge(kode){
  if (!kode || kode === '-' || kode === 'Libur') return '<span class="code-badge code-blank">' + (kode || '-') + '</span>';
  return '<span class="code-badge code-' + kode + '">' + kode + '</span>';
}

// ================= PENGATURAN KOLOM CETAK =================
function muatPengaturanKolomCetak(){
  callApi('getPengaturanKolomCetak').then(res => {
    kolomCetak = res;
    renderToggleKolomUI();
  }).catch(() => {
    renderToggleKolomUI(); // tetap tampilkan toggle dengan default (semua on) kalau gagal memuat
  });
}

function renderToggleKolomUI(){
  const wrap = document.getElementById('kolom-toggle-list');
  wrap.innerHTML = KOLOM_CETAK_DAFTAR.map(k =>
    '<div class="toggle-row">' +
      '<span>' + k.label + '</span>' +
      '<label class="toggle-switch">' +
        '<input type="checkbox" data-kolom="' + k.key + '" ' + (kolomCetak[k.key] ? 'checked' : '') + '>' +
        '<span class="toggle-slider"></span>' +
      '</label>' +
    '</div>'
  ).join('');

  wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      kolomCetak[cb.getAttribute('data-kolom')] = cb.checked;
      // Render ulang langsung pakai data yang sudah ada (tanpa panggil API lagi)
      // supaya tabel di layar & area cetak selalu WYSIWYG dengan toggle terbaru.
      if (rekapTerakhir){
        renderTabelRekap(rekapTerakhir);
        renderAreaCetak(rekapTerakhir);
      }
    });
  });
}

async function simpanPengaturanKolomCetak(){
  tampilkanPesan('kolom-cetak-error', '', 'error');
  try {
    const res = await callApi('simpanPengaturanKolomCetak', kolomCetak);
    if (!res.success){ tampilkanPesan('kolom-cetak-error', res.message, 'error'); return; }
    tampilkanPesan('kolom-cetak-success', res.message, 'success');
  } catch (err){
    tampilkanPesan('kolom-cetak-error', 'Gagal menyimpan: ' + err.message, 'error');
  }
}

/** Daftar kolom yang tampil sekarang, urutan tetap, Tanggal selalu di posisi pertama & tidak bisa dimatikan. */
function kolomAktif(){
  const daftar = [{ key: 'tanggal', label: 'Tanggal' }];
  if (kolomCetak.tampilHari) daftar.push({ key: 'hari', label: 'Hari' });
  if (kolomCetak.tampilJamMasuk) daftar.push({ key: 'jamMasuk', label: 'Masuk' });
  if (kolomCetak.tampilStatusMasuk) daftar.push({ key: 'statusMasuk', label: 'Status' });
  if (kolomCetak.tampilJamPulang) daftar.push({ key: 'jamPulang', label: 'Pulang' });
  if (kolomCetak.tampilStatusPulang) daftar.push({ key: 'statusPulang', label: 'Status' });
  if (kolomCetak.tampilDurasi) daftar.push({ key: 'durasi', label: 'Durasi' });
  if (kolomCetak.tampilKeterangan) daftar.push({ key: 'keterangan', label: 'Keterangan' });
  return daftar;
}

function nilaiSelKolom(r, key, untukCetak){
  const ket = r.keterangan || (r.statusHari === 'A' ? 'Alpa' : (r.statusHari === 'DL' ? 'Dinas Luar' : (r.statusHari === 'C' ? 'Cuti' : '')));
  switch (key){
    case 'tanggal': return r.tanggal;
    case 'hari': return r.hari;
    case 'jamMasuk': return r.jamMasuk || '-';
    case 'statusMasuk': return untukCetak ? (r.statusMasuk || '-') : kodeBadge(r.statusMasuk);
    case 'jamPulang': return r.jamPulang || '-';
    case 'statusPulang': return untukCetak ? (r.statusPulang || '-') : kodeBadge(r.statusPulang);
    case 'durasi': return r.durasiKerja || '-';
    case 'keterangan': return ket || '-';
    default: return '-';
  }
}

async function muatRekap(){
  const nip = document.getElementById('rekap-nip').value;
  const bulan = document.getElementById('rekap-bulan').value;
  const tahun = document.getElementById('rekap-tahun').value;
  if (!nip){ tampilkanPesan('rekap-error', 'Pilih guru terlebih dahulu.', 'error'); return; }
  tampilkanPesan('rekap-error', '', 'error');
  document.getElementById('btn-cetak-pdf').disabled = true;
  document.getElementById('btn-preview-cetak').disabled = true;
  document.getElementById('link-pdf-siap').style.display = 'none';

  try {
    const res = await callApi('getRekapBulanan', { nip, bulan, tahun });
    rekapTerakhir = res;
    renderTabelRekap(res);
    document.getElementById('tabel-rekap').style.display = '';
    document.getElementById('btn-cetak-pdf').disabled = false;
    document.getElementById('btn-preview-cetak').disabled = false;
    renderRingkasanKehadiran(res.ringkasan);
    renderAreaCetak(res);
  } catch (err){
    tampilkanPesan('rekap-error', 'Gagal memuat rekap: ' + err.message, 'error');
  }
}

// Tabel di layar admin — kolomnya mengikuti toggle "Kolom Cetak" (WYSIWYG
// dengan Preview & Cetak). Dipanggil ulang setiap toggle berubah, tanpa
// perlu memanggil API lagi (pakai data dari rekapTerakhir).
function renderTabelRekap(rekap){
  const kolom = kolomAktif();
  document.getElementById('tabel-rekap-head').innerHTML =
    '<tr>' + kolom.map(k => '<th>' + k.label + '</th>').join('') + '</tr>';

  const tbody = document.getElementById('tabel-rekap-body');
  tbody.innerHTML = rekap.rows.map(r => {
    if (r.statusHari === 'Libur'){
      return '<tr><td>' + r.tanggal + '</td><td colspan="' + (kolom.length - 1) + '" style="color:var(--ink-soft);">Libur</td></tr>';
    }
    return '<tr>' + kolom.map(k => '<td>' + nilaiSelKolom(r, k.key, false) + '</td>').join('') + '</tr>';
  }).join('');
}

function renderRingkasanKehadiran(r){
  const el = document.getElementById('ringkasan-kehadiran');
  if (!r){ el.style.display = 'none'; return; }
  el.innerHTML =
    '<div class="ringkasan-grid">' +
      '<div class="ringkasan-item"><div class="n">' + r.H + '</div><div class="l">Tepat Waktu (H)</div></div>' +
      '<div class="ringkasan-item"><div class="n">' + r.HT + '</div><div class="l">Terlambat (HT)</div></div>' +
      '<div class="ringkasan-item"><div class="n">' + r.PA + '</div><div class="l">Pulang Cepat (PA)</div></div>' +
      '<div class="ringkasan-item"><div class="n">' + r.A + '</div><div class="l">Alpa (A)</div></div>' +
      '<div class="ringkasan-item"><div class="n">' + r.DL + '</div><div class="l">Dinas Luar (DL)</div></div>' +
      '<div class="ringkasan-item"><div class="n">' + r.C + '</div><div class="l">Cuti (C)</div></div>' +
    '</div>' +
    (r.pulangTidakTercatat > 0
      ? '<div class="ringkasan-catatan">Termasuk ' + r.pulangTidakTercatat + ' hari dengan catatan "Pulang tidak tercatat" (tetap dihitung H/HT).</div>'
      : '') +
    '<div class="ringkasan-total">' +
      '<div class="n">' + r.jumlahKehadiran + ' <span style="font-size:14px; font-weight:500;">/ ' + r.hariKerja + ' hari kerja</span></div>' +
      '<div class="l">Total Jumlah Kehadiran (H + HT) — untuk penghitungan TPP</div>' +
    '</div>';
  el.style.display = 'block';
}

// Membangun versi rapi dari rekap yang sama persis dengan data di layar,
// disimpan ke #area-cetak yang tersembunyi (lihat @media print di style.css).
// Tidak perlu panggilan API baru — datanya sudah ada di tangan (hasil muatRekap()).
// Kolomnya mengikuti toggle "Kolom Cetak" (sama seperti tabel di layar).
function renderAreaCetak(rekap){
  const el = document.getElementById('area-cetak');
  const kolom = kolomAktif();
  const headerCetak = '<tr>' + kolom.map(k => '<th>' + k.label + '</th>').join('') + '</tr>';
  const baris = rekap.rows.map(r => {
    if (r.statusHari === 'Libur'){
      return '<tr><td>' + r.tanggal + '</td><td colspan="' + (kolom.length - 1) + '">Libur</td></tr>';
    }
    return '<tr>' + kolom.map(k => '<td>' + nilaiSelKolom(r, k.key, true) + '</td>').join('') + '</tr>';
  }).join('');

  const ring = rekap.ringkasan;
  const ringkasanBaris = [
    ['Hadir Tepat Waktu (H)', ring.H], ['Hadir Terlambat (HT)', ring.HT],
    ['Pulang Cepat (PA)', ring.PA], ['Alpa (A)', ring.A],
    ['Dinas Luar (DL)', ring.DL], ['Cuti (C)', ring.C],
    ['Jumlah Hari Kerja', ring.hariKerja]
  ].map(b => '<tr><td>' + b[0] + '</td><td>' + b[1] + '</td></tr>').join('');

  el.innerHTML =
    '<div class="cetak-judul">LAMPIRAN DAFTAR HADIR GURU (DASAR PENCAIRAN TPG)</div>' +
    '<div class="cetak-sekolah">' + (rekap.namaSekolah || '') + '</div>' +
    '<div class="cetak-info">' +
      '<div><b>Nama Guru</b>: ' + rekap.nama + '</div>' +
      '<div><b>NIP</b>: ' + rekap.nip + '</div>' +
      '<div><b>Bulan</b>: ' + BULAN_NAMA[rekap.bulan - 1] + ' ' + rekap.tahun + '</div>' +
    '</div>' +
    '<table><thead>' + headerCetak + '</thead>' +
    '<tbody>' + baris + '</tbody></table>' +
    '<div class="cetak-ringkasan">' +
      '<b>Ringkasan Kehadiran Bulan Ini</b>' +
      '<table>' + ringkasanBaris +
        '<tr class="total-row"><td>TOTAL JUMLAH KEHADIRAN (H + HT)</td><td>' + ring.jumlahKehadiran + '</td></tr>' +
      '</table>' +
    '</div>' +
    '<div class="cetak-ttd">' +
      '<div>Mengetahui,</div>' +
      '<div class="nama">' + (rekap.namaKepsek || 'Kepala Sekolah') + '</div>' +
      '<div>NIP. ' + (rekap.nipKepsek || '-') + '</div>' +
    '</div>';
}

function setOrientasi(o){
  orientasiCetak = o;
  document.getElementById('btn-orientasi-portrait').classList.toggle('active', o === 'portrait');
  document.getElementById('btn-orientasi-landscape').classList.toggle('active', o === 'landscape');
}

// @page tidak bisa diubah lewat class/inline style seperti elemen biasa,
// jadi kita suntik/timpa tag <style> berisi @page sesuai pilihan pengguna
// tepat sebelum window.print() dipanggil.
function terapkanOrientasiCetak(orientasi){
  let styleEl = document.getElementById('style-orientasi-cetak');
  if (!styleEl){
    styleEl = document.createElement('style');
    styleEl.id = 'style-orientasi-cetak';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = '@media print { @page{ size: A4 ' + orientasi + '; margin:12mm; } }';
}

// Memicu dialog print bawaan browser — ini SEKALIGUS berfungsi sebagai
// preview (browser selalu menampilkan preview sebelum benar-benar cetak)
// dan menu pengaturan cetak (ukuran kertas, orientasi, margin, skala),
// tanpa perlu membangun UI kustom untuk itu.
function previewCetak(){
  terapkanOrientasiCetak(orientasiCetak);
  window.print();
}

async function cetakPDF(){
  const nip = document.getElementById('rekap-nip').value;
  const bulan = document.getElementById('rekap-bulan').value;
  const tahun = document.getElementById('rekap-tahun').value;
  const btn = document.getElementById('btn-cetak-pdf');
  const linkSiap = document.getElementById('link-pdf-siap');
  linkSiap.style.display = 'none';
  btn.disabled = true; const teksAsli = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span>Membuat PDF…';

  try {
    const res = await callApi('generateRekapPDF', { nip, bulan, tahun, orientasi: orientasiCetak });
    btn.disabled = false; btn.textContent = teksAsli;
    if (!res.success){ tampilkanPesan('rekap-error', res.message, 'error'); return; }
    // Tombol manual di sini SENGAJA dipakai (bukan window.open otomatis) karena
    // window.open yang dipanggil setelah "await" seringkali diblokir browser
    // (dianggap bukan lagi hasil klik langsung pengguna). Tombol asli yang
    // benar-benar diklik pengguna tidak pernah kena blokir semacam ini.
    linkSiap.href = res.url;
    linkSiap.style.display = 'block';
    tampilkanPesan('rekap-success', 'PDF berhasil dibuat. Ketuk tombol hijau di bawah untuk membukanya.', 'success');
  } catch (err){
    btn.disabled = false; btn.textContent = teksAsli;
    tampilkanPesan('rekap-error', 'Gagal membuat PDF: ' + err.message, 'error');
  }
}

async function simpanIzin(){
  const data = {
    tanggalMulai: document.getElementById('izin-mulai').value,
    tanggalSelesai: document.getElementById('izin-selesai').value,
    nip: document.getElementById('izin-nip').value,
    jenis: document.getElementById('izin-jenis').value,
    keterangan: document.getElementById('izin-keterangan').value
  };
  if (!data.tanggalMulai || !data.tanggalSelesai || !data.nip){
    tampilkanPesan('izin-error', 'Lengkapi tanggal dan pilih guru.', 'error');
    return;
  }
  tampilkanPesan('izin-error', '', 'error');
  try {
    const res = await callApi('tambahIzinDinas', data);
    if (!res.success){ tampilkanPesan('izin-error', res.message, 'error'); return; }
    tampilkanPesan('izin-success', res.message, 'success');
    document.getElementById('izin-keterangan').value = '';
    muatRiwayatIzin();
  } catch (err){
    tampilkanPesan('izin-error', 'Gagal menyimpan: ' + err.message, 'error');
  }
}

function muatRiwayatIzin(){
  callApi('getDaftarIzinDinas').then(list => {
    document.getElementById('tabel-izin-body').innerHTML = list.slice(0, 15).map(iz =>
      '<tr><td>' + iz.mulai + '</td><td>' + iz.selesai + '</td><td>' + iz.nip + '</td><td>' + kodeBadge(iz.jenis) + '</td><td>' + (iz.keterangan || '-') + '</td></tr>'
    ).join('');
  }).catch(() => {});
}

// ================= JAM KERJA PER HARI (ADMIN) =================
function muatJadwalKerja(){
  const wrap = document.getElementById('jadwal-kerja-list');
  wrap.innerHTML = '<p style="color:var(--ink-soft); font-size:13px;">Memuat jadwal…</p>';
  callApi('getJadwalKerja').then(list => {
    jadwalKerjaSudahDimuat = true;
    wrap.innerHTML = list.map(j =>
      '<div class="jadwal-row" data-hari="' + j.hari + '">' +
        '<div class="hari-label">' + j.hari + '<span class="badge-libur" style="display:' + (j.libur ? 'inline' : 'none') + ';">Libur</span></div>' +
        '<div>' +
          '<div class="jadwal-field-label">Masuk</div>' +
          '<input type="time" class="jadwal-masuk" value="' + j.jamMasuk + '">' +
        '</div>' +
        '<div>' +
          '<div class="jadwal-field-label">Pulang</div>' +
          '<input type="time" class="jadwal-pulang" value="' + j.jamPulang + '">' +
        '</div>' +
      '</div>'
    ).join('');

    // Badge "Libur" ikut update live begitu admin mengosongkan/mengisi kedua jam,
    // supaya jelas terlihat sebelum sempat klik Simpan.
    wrap.querySelectorAll('.jadwal-row').forEach(row => {
      const masuk = row.querySelector('.jadwal-masuk');
      const pulang = row.querySelector('.jadwal-pulang');
      const badge = row.querySelector('.badge-libur');
      const perbaruiBadge = () => {
        badge.style.display = (!masuk.value && !pulang.value) ? 'inline' : 'none';
      };
      masuk.addEventListener('input', perbaruiBadge);
      pulang.addEventListener('input', perbaruiBadge);
    });
  }).catch(err => {
    wrap.innerHTML = '';
    tampilkanPesan('jadwal-error', 'Gagal memuat jadwal: ' + err.message, 'error');
  });
}

async function simpanJadwalKerja(){
  const baris = document.querySelectorAll('#jadwal-kerja-list .jadwal-row');
  if (baris.length === 0){
    tampilkanPesan('jadwal-error', 'Jadwal belum dimuat, coba buka tab ini ulang.', 'error');
    return;
  }
  const jadwal = Array.from(baris).map(row => ({
    hari: row.getAttribute('data-hari'),
    // SENGAJA tidak diberi fallback di sini — kosong harus tetap terkirim
    // kosong supaya backend bisa menandai hari itu Libur.
    jamMasuk: row.querySelector('.jadwal-masuk').value || '',
    jamPulang: row.querySelector('.jadwal-pulang').value || ''
  }));

  tampilkanPesan('jadwal-error', '', 'error');
  try {
    const res = await callApi('simpanJadwalKerja', { jadwal });
    if (!res.success){ tampilkanPesan('jadwal-error', res.message, 'error'); return; }
    tampilkanPesan('jadwal-success', res.message, 'success');
  } catch (err){
    tampilkanPesan('jadwal-error', 'Gagal menyimpan: ' + err.message, 'error');
  }
}

// ================= TITIK LOKASI ABSEN (ADMIN) =================
function muatTitikLokasi(){
  const wrap = document.getElementById('titik-lokasi-list');
  wrap.innerHTML = '<p style="color:var(--ink-soft); font-size:13px;">Memuat titik lokasi…</p>';
  callApi('getTitikLokasi').then(list => {
    titikLokasiSudahDimuat = true;
    wrap.innerHTML = list.map((t, idx) =>
      '<div class="titik-card" data-index="' + idx + '">' +
        '<input type="text" class="titik-nama-input" placeholder="Nama titik (mis. Gedung Utama)" value="' + (t.nama || '') + '">' +
        '<div class="titik-field-row">' +
          '<div>' +
            '<div class="jadwal-field-label">Latitude</div>' +
            '<input type="number" step="any" class="titik-lat" placeholder="-7.xxxxx" value="' + t.lat + '">' +
          '</div>' +
          '<div>' +
            '<div class="jadwal-field-label">Longitude</div>' +
            '<input type="number" step="any" class="titik-lng" placeholder="110.xxxxx" value="' + t.lng + '">' +
          '</div>' +
          '<div>' +
            '<div class="jadwal-field-label">Radius (m)</div>' +
            '<input type="number" class="titik-radius" placeholder="30" value="' + t.radius + '">' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn-ghost btn-block titik-gps-btn">📍 Ambil dari GPS Saya</button>' +
        '<div class="titik-gps-status"></div>' +
      '</div>'
    ).join('');

    wrap.querySelectorAll('.titik-card').forEach(card => {
      card.querySelector('.titik-gps-btn').addEventListener('click', () => ambilGPSTitik(card));
    });
  }).catch(err => {
    wrap.innerHTML = '';
    tampilkanPesan('lokasi-error', 'Gagal memuat titik lokasi: ' + err.message, 'error');
  });
}

// Mengisi Latitude/Longitude satu kartu titik memakai GPS HP admin saat itu
// juga — admin tinggal berdiri di lokasinya, tidak perlu buka Google Maps.
function ambilGPSTitik(card){
  const btn = card.querySelector('.titik-gps-btn');
  const status = card.querySelector('.titik-gps-status');
  if (!navigator.geolocation){
    status.textContent = 'GPS tidak didukung perangkat ini.';
    status.style.display = 'block';
    return;
  }
  const teksAsli = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Mengambil lokasi…';
  status.style.display = 'none';

  navigator.geolocation.getCurrentPosition(pos => {
    card.querySelector('.titik-lat').value = pos.coords.latitude.toFixed(6);
    card.querySelector('.titik-lng').value = pos.coords.longitude.toFixed(6);
    btn.disabled = false; btn.textContent = teksAsli;
    status.textContent = '✓ Lokasi berhasil diambil (akurasi ±' + Math.round(pos.coords.accuracy) + ' m). Jangan lupa klik Simpan.';
    status.style.color = 'var(--emerald)';
    status.style.display = 'block';
  }, err => {
    btn.disabled = false; btn.textContent = teksAsli;
    status.textContent = 'Gagal ambil lokasi: izin GPS ditolak atau tidak tersedia.';
    status.style.color = 'var(--rose)';
    status.style.display = 'block';
  }, { enableHighAccuracy:true, timeout:15000 });
}

async function simpanTitikLokasi(){
  const kartu = document.querySelectorAll('#titik-lokasi-list .titik-card');
  if (kartu.length === 0){
    tampilkanPesan('lokasi-error', 'Data belum dimuat, coba buka tab ini ulang.', 'error');
    return;
  }
  const titik = Array.from(kartu).map(card => ({
    nama: card.querySelector('.titik-nama-input').value || '',
    // SENGAJA tidak diberi fallback — kosong harus tetap terkirim kosong
    // supaya titik itu dianggap belum aktif (dilewati saat validasi absen).
    lat: card.querySelector('.titik-lat').value || '',
    lng: card.querySelector('.titik-lng').value || '',
    radius: card.querySelector('.titik-radius').value || ''
  }));

  tampilkanPesan('lokasi-error', '', 'error');
  try {
    const res = await callApi('simpanTitikLokasi', { titik });
    if (!res.success){ tampilkanPesan('lokasi-error', res.message, 'error'); return; }
    tampilkanPesan('lokasi-success', res.message, 'success');
  } catch (err){
    tampilkanPesan('lokasi-error', 'Gagal menyimpan: ' + err.message, 'error');
  }
}
