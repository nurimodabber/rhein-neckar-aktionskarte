const { put, get } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Support query or body for roomId
  const roomId = (req.query && req.query.room) || (req.body && req.body.room);
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

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { data, version, clientTimestamp } = body;

      if (!data || typeof data !== 'object') {
        return res.status(400).json({ ok: false, error: 'Fehlendes oder ungültiges "data"-Objekt' });
      }

      const newVersion = (Number(version) || 0) + 1;
      const nowIso = new Date().toISOString();

      const envelope = {
        room: roomId,
        version: newVersion,
        updatedAt: nowIso,
        clientTimestamp: clientTimestamp || Date.now(),
        data
      };

      const serialized = JSON.stringify(envelope);

      if (Buffer.byteLength(serialized, 'utf8') > 3 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: 'Nutzlast überschreitet das Limit von 3 MB' });
      }

      await put(blobKey, serialized, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json'
      });

      return res.status(200).json({
        ok: true,
        room: roomId,
        version: newVersion,
        updatedAt: nowIso
      });
    } catch (err) {
      console.error('Fehler beim Speichern des Raums:', err);
      return res.status(500).json({ ok: false, error: 'Fehler beim Speichern des Raumstatus' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Methode nicht erlaubt' });
};
