// =================================================================
//  ABSENSI GURU — CLIENT (GitHub Pages, memanggil backend GAS via API)
// =================================================================

// ================= STATE GLOBAL =================
let currentUser = null;
let pengaturan = null;
let posisiSekarang = null;
let jarakSekarang = null;
let fotoBase64 = null;
let statusHariIni = { masuk: null, pulang: null };
let cameraStream = null;
let watchId = null;
const BULAN_NAMA = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

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

  callApi('getPengaturanPublik').then(p => { pengaturan = p; }).catch(() => {});
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
  setText('ringkasan-masuk', res.masuk ? (res.masuk.jam + ' · ' + res.masuk.status) : '—');
  setText('ringkasan-pulang', res.pulang ? (res.pulang.jam + ' · ' + res.pulang.status) : '—');
  updateTombolState();
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
  jarakSekarang = Math.round(haversineMeters(posisiSekarang.lat, posisiSekarang.lng, pengaturan.lat, pengaturan.lng));
  setText('gauge-jarak', jarakSekarang);

  const circumference = 113.1;
  const maxDisplay = Math.max(pengaturan.radius * 5, 100);
  const fraction = Math.max(0, Math.min(1, 1 - (jarakSekarang / maxDisplay)));
  const offset = circumference * (1 - fraction);
  const fillEl = document.getElementById('gauge-fill');
  fillEl.style.strokeDashoffset = offset;

  const statusEl = document.getElementById('gauge-status');
  if (jarakSekarang <= pengaturan.radius){
    fillEl.style.stroke = 'var(--emerald)';
    statusEl.className = 'gauge-status ok';
    statusEl.textContent = 'Dalam radius (maks ' + pengaturan.radius + ' m)';
  } else {
    fillEl.style.stroke = 'var(--rose)';
    statusEl.className = 'gauge-status bad';
    statusEl.textContent = 'Di luar radius, absen akan ditolak';
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
  const dalamRadius = jarakSekarang !== null && pengaturan && jarakSekarang <= pengaturan.radius;
  const adaFoto = !!fotoBase64;
  const btnMasuk = document.getElementById('btn-masuk');
  const btnPulang = document.getElementById('btn-pulang');

  btnMasuk.disabled = !(dalamRadius && adaFoto) || !!statusHariIni.masuk;
  btnPulang.disabled = !(dalamRadius && adaFoto) || !!statusHariIni.pulang || !statusHariIni.masuk;
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
    tampilkanPesan('absen-success', 'Absen ' + jenis + ' berhasil pukul ' + res.jam + ' — Status: ' + res.pesanStatus + ' (jarak ' + res.jarak + ' m).', 'success');
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
}

function gantiTabAdmin(tab){
  document.getElementById('tab-btn-rekap').classList.toggle('active', tab === 'rekap');
  document.getElementById('tab-btn-izin').classList.toggle('active', tab === 'izin');
  document.getElementById('tab-rekap').style.display = tab === 'rekap' ? '' : 'none';
  document.getElementById('tab-izin').style.display = tab === 'izin' ? '' : 'none';
}

function kodeBadge(kode){
  if (!kode || kode === '-' || kode === 'Libur') return '<span class="code-badge code-blank">' + (kode || '-') + '</span>';
  return '<span class="code-badge code-' + kode + '">' + kode + '</span>';
}

async function muatRekap(){
  const nip = document.getElementById('rekap-nip').value;
  const bulan = document.getElementById('rekap-bulan').value;
  const tahun = document.getElementById('rekap-tahun').value;
  if (!nip){ tampilkanPesan('rekap-error', 'Pilih guru terlebih dahulu.', 'error'); return; }
  tampilkanPesan('rekap-error', '', 'error');
  document.getElementById('btn-cetak-pdf').disabled = true;

  try {
    const res = await callApi('getRekapBulanan', { nip, bulan, tahun });
    const tbody = document.getElementById('tabel-rekap-body');
    tbody.innerHTML = res.rows.map(r => {
      if (r.statusHari === 'Libur'){
        return '<tr><td>' + r.tanggal + '</td><td>' + r.hari + '</td><td colspan="5" style="color:var(--ink-soft);">Libur</td></tr>';
      }
      return '<tr><td>' + r.tanggal + '</td><td>' + r.hari + '</td>' +
        '<td>' + (r.jamMasuk || '-') + '</td><td>' + kodeBadge(r.statusMasuk) + '</td>' +
        '<td>' + (r.jamPulang || '-') + '</td><td>' + kodeBadge(r.statusPulang) + '</td>' +
        '<td>' + (r.keterangan || (r.statusHari === 'A' ? 'Alpa' : (r.statusHari === 'DL' ? 'Dinas Luar' : (r.statusHari === 'C' ? 'Cuti' : '')))) + '</td></tr>';
    }).join('');
    document.getElementById('tabel-rekap').style.display = '';
    document.getElementById('btn-cetak-pdf').disabled = false;
  } catch (err){
    tampilkanPesan('rekap-error', 'Gagal memuat rekap: ' + err.message, 'error');
  }
}

async function cetakPDF(){
  const nip = document.getElementById('rekap-nip').value;
  const bulan = document.getElementById('rekap-bulan').value;
  const tahun = document.getElementById('rekap-tahun').value;
  const btn = document.getElementById('btn-cetak-pdf');
  btn.disabled = true; const teksAsli = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span>Membuat PDF…';

  try {
    const res = await callApi('generateRekapPDF', { nip, bulan, tahun });
    btn.disabled = false; btn.textContent = teksAsli;
    if (!res.success){ tampilkanPesan('rekap-error', res.message, 'error'); return; }
    tampilkanPesan('rekap-success', 'PDF berhasil dibuat.', 'success');
    window.open(res.url, '_blank');
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
