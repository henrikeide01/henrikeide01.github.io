export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { query } = req.body;
  
  // Vi bruker OLLAMA_URL og OLLAMA_API_KEY som du legger inn i Vercel
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const apiKey = process.env.OLLAMA_API_KEY; 
  const model = process.env.OLLAMA_MODEL || 'llama3';

  const systemPrompt = `Du er en norsk kokk. Svar KUN med JSON. 
Format: {"name": "Navn", "price": 200, "ingredients": ["item1", "item2"]}`;

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query || "Finn på en middag." }
        ],
        stream: false,
        format: "json"
      })
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Ollama feil' });
    }

    const data = await response.json();
    const content = data.message.content.trim();
    const dishObj = JSON.parse(content);
    
    return res.status(200).json({
        choices: [{ message: { content: JSON.stringify(dishObj) } }]
    });
  } catch (error) {
    return res.status(500).json({ error: 'Server feil', details: error.message });
  }
}
