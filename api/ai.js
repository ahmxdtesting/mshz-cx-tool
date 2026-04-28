export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(500).json({ error: 'AI not configured' });

  try {
    const { messages, max_tokens } = req.body;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'https://mshz-cx-tool.vercel.app',
        'X-Title': 'MSHZ CX Tool'
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        messages: messages,
        max_tokens: max_tokens || 800
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || data.error || JSON.stringify(data);
      return res.status(response.status).json({ error: errMsg });
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
