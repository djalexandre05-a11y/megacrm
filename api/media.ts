import { getCredential } from '../src/lib/credentials.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    const apiKey = await getCredential('zernio_api_key');
    if (!apiKey) {
      return res.status(500).json({ error: 'Zernio API Key missing' });
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch media' });
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    // Set caching headers
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    return res.status(200).send(buffer);
  } catch (error: any) {
    console.error('Media proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
}
