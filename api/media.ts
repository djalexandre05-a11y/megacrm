import { getCredential } from '../src/lib/credentials.js';

// Domínios permitidos para a URL original e para redirecionamentos (Location)
const ALLOWED_DOMAINS = [
  'zernio.com',
  'amazonaws.com',
  'fbsbx.com',
  'whatsapp.net',
];

// Tempo máximo de espera pela resposta (10 segundos)
const FETCH_TIMEOUT_MS = 10000;

// Função auxiliar para verificar se um hostname é permitido
function isDomainAllowed(hostname: string): boolean {
  return ALLOWED_DOMAINS.some((domain) => hostname.endsWith(domain));
}

export default async function handler(req: any, res: any) {
  // 1. Verifica método HTTP
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    // 2. Obtém e valida o parâmetro 'url'
    const urlParam = req.query.url;
    if (!urlParam || typeof urlParam !== 'string') {
      return res.status(400).json({ error: 'Parâmetro "url" é obrigatório' });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlParam);
    } catch {
      return res.status(400).json({ error: 'URL inválida' });
    }

    // 3. Restringe protocolo (apenas HTTP/HTTPS)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Apenas URLs HTTP/HTTPS são permitidas' });
    }

    // 4. Verifica se o domínio da URL original está na lista de permitidos
    if (!isDomainAllowed(parsedUrl.hostname)) {
      console.warn(`Domínio bloqueado: ${parsedUrl.hostname}`);
      return res.status(403).json({ error: 'Domínio não autorizado para proxy' });
    }

    // 5. Obtém a chave de API
    const apiKey = await getCredential('zernio_api_key');
    if (!apiKey) {
      console.error('Chave de API Zernio não encontrada');
      return res.status(500).json({ error: 'Erro interno de configuração' });
    }

    // 6. Configura timeout para o fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    // 7. Faz a requisição com redirect manual
    const response = await fetch(urlParam, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 8. Lida com redirecionamentos (3xx)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        // Resolve o Location (pode ser relativo)
        const redirectUrl = new URL(location, urlParam);
        // Verifica se o domínio do redirecionamento é permitido
        if (isDomainAllowed(redirectUrl.hostname)) {
          // Redireciona o cliente para a URL do S3 (economiza banda)
          return res.redirect(response.status, redirectUrl.href);
        } else {
          // Se o destino não for permitido, retorna erro (segurança)
          console.warn(`Redirecionamento para domínio não permitido: ${redirectUrl.hostname}`);
          return res.status(403).json({ error: 'Redirecionamento para domínio não autorizado' });
        }
      } else {
        // Redirecionamento sem Location
        return res.status(500).json({ error: 'Redirecionamento sem destino' });
      }
    }

    // 9. Para respostas não-redirecionamento, verifica se houve erro HTTP
    if (!response.ok) {
      // Log do status e eventualmente do corpo (com cuidado)
      console.error(`Erro ao buscar mídia: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ error: 'Falha ao buscar a mídia' });
    }

    // 10. Define cabeçalhos de resposta
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    // Cache de longo prazo (1 ano)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // 11. Transmite o corpo da resposta em buffer
    const arrayBuffer = await response.arrayBuffer();
    return res.status(200).send(Buffer.from(arrayBuffer));
  } catch (error: any) {
    // 12. Tratamento de erros genérico (não expõe detalhes)
    console.error('Erro no proxy de mídia:', error.message);
    // Se for erro de abort (timeout), retorna mensagem específica
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Tempo limite excedido' });
    }
    return res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
}