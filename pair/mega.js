import * as mega from 'megajs';

const auth = { email: 'your-email@gmail.com', password: 'your-password', userAgent: 'Mozilla/5.0' };

export const upload = (data, name) => new Promise((resolve, reject) => {
  try {
    const storage = new mega.Storage(auth, () => {
      const up = storage.upload({ name, allowUploadBuffering: true });
      data.pipe(up);
      storage.on("add", (file) => { file.link((err, url) => { if (err) reject(err); else { storage.close(); resolve(url); } }); });
      storage.on("error", reject);
    });
  } catch (err) { reject(err); }
});

export const download = (url) => new Promise((resolve, reject) => {
  try {
    const file = mega.File.fromURL(url);
    file.loadAttributes((err) => { if (err) { reject(err); return; } file.downloadBuffer((err, buf) => { if (err) reject(err); else resolve(buf); }); });
  } catch (err) { reject(err); }
});
