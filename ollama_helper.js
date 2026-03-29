/**
 * ollama_helper.js
 * Helper koneksi ke Ollama lokal
 */
const { Ollama } = require('ollama');

const ollama = new Ollama({
  host: process.env.OLLAMA_HOST || 'http://localhost:11434',
});

async function checkOllama() {
  try {
    const model  = process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud';
    const models = await ollama.list();
    const exists = models.models.some(m => m.name.startsWith(model.split(':')[0]));
    if (!exists) {
      console.warn(`⚠️  Model '${model}' tidak ditemukan di Ollama. Jalankan: ollama pull ${model}`);
    } else {
      console.log(`✅ Ollama ready — model: ${model}`);
    }
    return true;
  } catch (err) {
    console.error('❌ Gagal terhubung ke Ollama:', err.message);
    return false;
  }
}

module.exports = { ollama, checkOllama };