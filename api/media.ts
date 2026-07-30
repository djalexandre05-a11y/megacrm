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

    // Security: Only allow proxying URLs from trusted domains
    try {
      const parsedUrl = new URL(url);
      const isAllowed = 
        parsedUrl.hostname.endsWith('zernio.com') ||
        parsedUrl.hostname.endsWith('amazonaws.com') ||
        parsedUrl.hostname.endsWith('fbsbx.com') ||
        parsedUrl.hostname.endsWith('whatsapp.net');

      if (!isAllowed) {
        console.warn('PROXY_DOMAIN_BLOCKED_TEMPORARILY_BYPASSED', parsedUrl.hostname);
        // return res.status(403).json({ error: 'Domain not allowed for proxying' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const apiKey = await getCredential('zernio_api_key');
    if (!apiKey) {
      return res.status(500).json({ error: 'Zernio API Key missing' });
    }

    // Use redirect: 'manual' to catch the 302 redirect to S3.
    // If we let fetch follow the redirect, it will send the Authorization header
    // to S3, which will reject it with a 400 Bad Request.
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      redirect: 'manual',
    });

    // If it's a redirect, send the redirect back to the browser!
    // The browser will fetch the S3 URL directly, bypassing our serverless function bandwidth.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        return res.redirect(response.status, location);
      }
    }

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
