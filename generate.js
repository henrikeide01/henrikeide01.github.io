export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { query } = req.body;
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const apiKey = process.env.OLLAMA_API_KEY; // Valgfri nøkkel hvis tjenesten krever det
  const model = process.env.OLLAMA_MODEL || 'llama3';

  const systemPrompt = `Du er en norsk kokk og matekspert. Returner KUN gyldig JSON. Ingen markdown, ingen tekst utenfor JSON. 
Formatet MÅ være nøyaktig slik:
{
  "name": "Navn på rett",
  "price": 200,
  "ingredients": ["ingrediens 1", "ingrediens 2"]
}
Pris skal være et realistisk estimat i NOK for en middag for 2-3 personer i en norsk matbutikk. Hvis brukeren oppgir en rett, bruk det navnet.`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query || "Finn på en spennende og populær norsk eller internasjonal middagsrett." }
        ],
        stream: false,
        format: "json"
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      return res.status(response.status).json({ error: 'Ollama API error', details: errorData });
    }

    const data = await response.json();
    // Ollama returnerer innholdet i data.message.content
    const content = data.message.content.trim();
    
    // Vi parser innholdet for å være sikker på at det er JSON (Ollama med format: "json" er som regel flink til dette)
    const dishObj = JSON.parse(content);
    
    // Vi sender det tilbake i samme format som før så frontenden ikke merker forskjell
    return res.status(200).json({
        choices: [{
            message: {
                content: JSON.stringify(dishObj)
            }
        }]
    });
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
