const { UJI_BY_KATEGORI } = require('./evidence');
const { rekamHasil } = require('./snapshot');
const { getQueueStatus } = require('./queue-status');

const DEFAULT = {
  // Statistik queue di RabbitMQ Management API diperbarui tiap ~5 detik,
  // jadi pembacaan baru bermakna setelah jeda ini.
  minTungguMs:      6000,
  pollMs:           1000,
  batasNormalMs:    60 * 1000,
  batasPemulihanMs: 15 * 60 * 1000,
  maxRiwayat:       30,
};

// Tahap akhir tiap kategori; undefined = hasil.json tanpa nama tahap
const TAHAP_AKHIR = { invalid: 'setelah-x01' };

// Perekam evidence otomatis: dipanggil dari server saat publish, lalu memantau
// queue sampai uji selesai dan menyimpan snapshot pada saat yang tepat.
function buatPerekam({ rekam = rekamHasil, status = getQueueStatus, konfig = {} } = {}) {
  const k = { ...DEFAULT, ...konfig };
  const riwayat = [];
  let aktif = 0;

  const tidur = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function catat(tingkat, pesan) {
    riwayat.unshift({ waktu: new Date().toISOString(), tingkat, pesan });
    if (riwayat.length > k.maxRiwayat) riwayat.length = k.maxRiwayat;
  }

  async function simpan(uji, tahap) {
    const label = tahap ? `${uji} / ${tahap}` : uji;
    try {
      const r = await rekam(uji, tahap, 'otomatis');
      const { receipts, rejected } = r.perbandingan;
      catat(
        r.sesuai ? 'ok' : 'gagal',
        `${label} tersimpan → ${r.file} · receipts ${receipts.aktual}/${receipts.diharapkan}`
          + ` · rejected ${rejected.aktual}/${rejected.diharapkan}`
          + ` · ID ${r.sesuai ? 'SESUAI' : 'TIDAK SESUAI'}`
      );
    } catch (err) {
      catat('gagal', `${label} gagal direkam: ${err.message}`);
    }
  }

  const tahapAkhir = (kategori, tertahan) =>
    kategori === 'gangguan' ? (tertahan ? 'sesudah-pemulihan' : undefined) : TAHAP_AKHIR[kategori];

  // Panggil sebelum publish: kondisi awal U2 harus terekam sebelum G01–G05 masuk
  async function sebelumPublish(kategori) {
    if (kategori === 'gangguan') await simpan('U2', 'sebelum-gangguan');
  }

  async function pantau(kategori, uji, token) {
    const mulai = Date.now();
    let tertahan = false;
    await tidur(k.minTungguMs);

    while (token === aktif) {
      const q = await status().catch(() => null);

      if (q) {
        if (kategori === 'gangguan' && !tertahan && q.ready > 0 && q.consumers === 0) {
          tertahan = true;
          await simpan(uji, 'saat-tertahan');
          catat('info', `${uji}: pesan tertahan di queue (Ready=${q.ready}); menunggu worker dihidupkan kembali...`);
        } else if (q.ready === 0 && q.unacked === 0 && q.consumers > 0) {
          await simpan(uji, tahapAkhir(kategori, tertahan));
          return;
        }
      }

      const batas = tertahan ? k.batasPemulihanMs : k.batasNormalMs;
      if (Date.now() - mulai > batas) {
        catat('gagal', `${uji}: batas waktu ${Math.round(batas / 1000)} detik tercapai, target belum tercapai — merekam kondisi terakhir`);
        await simpan(uji, tahapAkhir(kategori, tertahan));
        return;
      }
      await tidur(k.pollMs);
    }
    catat('info', `${uji}: pemantauan ${kategori} dibatalkan karena ada publish baru`);
  }

  // Panggil setelah publish berhasil; berjalan di latar belakang
  function mulaiPemantauan(kategori) {
    const uji = UJI_BY_KATEGORI[kategori];
    if (!uji) return;
    const token = ++aktif;
    catat('info', `${uji}: event ${kategori} terkirim, menunggu diproses worker...`);
    pantau(kategori, uji, token).catch((err) => catat('gagal', `${uji}: pemantauan error: ${err.message}`));
  }

  return { sebelumPublish, mulaiPemantauan, ambilRiwayat: () => riwayat.slice() };
}

const perekam = buatPerekam();

module.exports = {
  buatPerekam,
  sebelumPublish:  perekam.sebelumPublish,
  mulaiPemantauan: perekam.mulaiPemantauan,
  ambilRiwayat:    perekam.ambilRiwayat,
};
