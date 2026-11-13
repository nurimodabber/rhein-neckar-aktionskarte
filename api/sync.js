// Alte Online-Räume: nur noch Lesen, damit ihr letzter Stand importiert werden kann.
const { get } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  const roomId = req.query && req.query.room;
  if (!roomId || typeof roomId !== 'string' || !/^[a-zA-Z0-9_-]{3,64}$/.test(roomId)) {
    return res.status(400).json({
      ok: false,
      error: 'Ungültige Raum-ID. Erlaubt sind 3-64 Zeichen (Buchstaben, Ziffern, Bindestrich, Unterstrich).'
    });
  }

  const blobKey = `rooms/${roomId}.json`;

  if (req.method === 'GET') {
    try {
      const result = await get(blobKey, { access: 'private' });
      if (!result) {
        return res.status(404).json({ ok: false, error: 'Raum existiert noch nicht' });
      }

      const etag = result.blob.etag;
      if (req.headers && req.headers['if-none-match'] && req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      const chunks = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk);
      }
      const rawText = Buffer.concat(chunks).toString('utf8');
      const parsed = JSON.parse(rawText);

      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      if (etag) res.setHeader('ETag', etag);

      return res.status(200).json({
        ok: true,
        room: roomId,
        data: parsed.data || parsed,
        version: parsed.version || 1,
        updatedAt: parsed.updatedAt || (result.blob.uploadedAt ? result.blob.uploadedAt.toISOString() : new Date().toISOString())
      });
    } catch (err) {
      console.error('Fehler beim Laden des Raums:', err);
      return res.status(500).json({ ok: false, error: 'Fehler beim Lesen des Raumstatus' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Methode nicht erlaubt' });
};
