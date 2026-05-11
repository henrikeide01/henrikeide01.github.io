export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { query } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API Key er ikke satt opp på serveren.' });
  }

  const systemPrompt = `Du er en norsk kokk og matekspert. Returner KUN gyldig JSON. Ingen markdown, ingen tekst utenfor JSON. 
Formatet MÅ være nøyaktig slik:
{
  "name": "Navn på rett",
  "price": 200,
  "ingredients": ["ingrediens 1", "ingrediens 2"]
}
Pris skal være et realistisk estimat i NOK for en middag for 2-3 personer i en norsk matbutikk. Hvis brukeren oppgir en rett, bruk det navnet.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query || "Finn på en spennende og populær norsk eller internasjonal middagsrett." }
        ],
        temperature: 0.8
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      return res.status(response.status).json({ error: 'OpenAI API error', details: errorData });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
