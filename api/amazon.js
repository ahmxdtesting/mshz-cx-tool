import crypto from 'crypto';

function sign(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

function getSignatureKey(secret, date, region, service) {
  const kDate = sign('AWS4' + secret, date);
  const kRegion = sign(kDate, region);
  const kService = sign(kRegion, service);
  return sign(kService, 'aws4_request');
}

function sha256hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

async function getLWAToken(clientId, clientSecret, refreshToken) {
  const resp = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error('LWA error: ' + JSON.stringify(data));
  return data.access_token;
}

function sigv4Sign({ method, host, path, query, accessToken, accessKeyId, secretAccessKey, region }) {
  const service = 'execute-api';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const canonicalQueryString = query || '';
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-access-token:${accessToken}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-access-token;x-amz-date';
  const payloadHash = sha256hex('');

  const canonicalRequest = [
    method, path, canonicalQueryString,
    canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope, sha256hex(canonicalRequest)
  ].join('\n');

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { amzDate, authHeader };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  const refreshToken = process.env.SP_API_REFRESH_TOKEN;
  const clientId = process.env.LWA_APP_ID;
  const clientSecret = process.env.LWA_CLIENT_SECRET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.SP_API_REGION || 'us-east-1';

  if (!refreshToken || !clientId || !clientSecret || !accessKeyId || !secretAccessKey) {
    return res.status(500).json({ error: 'Amazon credentials not configured' });
  }

  try {
    const accessToken = await getLWAToken(clientId, clientSecret, refreshToken);

    const host = 'sellingpartnerapi-na.amazon.com';
    const path = `/orders/v0/orders/${encodeURIComponent(orderId)}`;

    const { amzDate, authHeader } = sigv4Sign({
      method: 'GET', host, path, query: '',
      accessToken, accessKeyId, secretAccessKey, region
    });

    const orderResp = await fetch(`https://${host}${path}`, {
      headers: {
        'host': host,
        'x-amz-access-token': accessToken,
        'x-amz-date': amzDate,
        'Authorization': authHeader
      }
    });

    const orderData = await orderResp.json();
    if (!orderResp.ok) {
      const errMsg = orderData?.errors?.[0]?.message || JSON.stringify(orderData);
      return res.status(orderResp.status).json({ error: errMsg });
    }

    const order = orderData?.payload;
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Fetch order items
    const itemsPath = `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`;
    const { amzDate: amzDate2, authHeader: authHeader2 } = sigv4Sign({
      method: 'GET', host, path: itemsPath, query: '',
      accessToken, accessKeyId, secretAccessKey, region
    });

    const itemsResp = await fetch(`https://${host}${itemsPath}`, {
      headers: {
        'host': host,
        'x-amz-access-token': accessToken,
        'x-amz-date': amzDate2,
        'Authorization': authHeader2
      }
    });

    let items = [];
    if (itemsResp.ok) {
      const itemsData = await itemsResp.json();
      items = itemsData?.payload?.OrderItems || [];
    }

    return res.status(200).json({ order, items });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
