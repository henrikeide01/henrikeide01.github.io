export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Kun POST er tillatt" });
  }

  try {
    const data = req.body || {};
    const web3Key = process.env.WEB3FORMS_ACCESS_KEY;
    const databaseUrl = process.env.FIREBASE_DATABASE_URL;

    if (!web3Key || !databaseUrl) {
      return res.status(500).json({
        ok: false,
        error: "Mangler serverinnstillinger"
      });
    }

    const kind = data.kind === "message" ? "message" : "booking";
    const id =
      data.id ||
      (kind === "message"
        ? `MSG-${Date.now()}`
        : `GPA-${Date.now()}`);

    const item =
      kind === "message"
        ? {
            id,
            name: data.name || "",
            email: data.email || "",
            phone: data.phone || "",
            message: data.message || "",
            status: "Ny",
            timestamp: new Date().toLocaleString("no-NO")
          }
        : {
            id,
            type: data.type || "Forespørsel",
            name: data.name || "",
            email: data.email || "",
            phone: data.phone || "",
            addr: data.addr || "Ikke oppgitt",
            date: data.date || "",
            slot: data.slot || "",
            msg: data.msg || "",
            status: "Ny",
            timestamp: new Date().toLocaleString("no-NO")
          };

    const path =
      kind === "message"
        ? `snekker_messages/${id}`
        : `snekker_bookings/${id}`;

    await fetch(`${databaseUrl}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item)
    });

    const fd = new FormData();
    fd.append("access_key", web3Key);
    fd.append(
      "subject",
      kind === "message"
        ? `Kontaktmelding fra ${item.name}`
        : `Forespørsel: ${item.type} - fra ${item.name}`
    );
    fd.append("from_name", "Pedersen Nettside");
    fd.append(
      "message",
      Object.entries(item)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n")
    );

    await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      body: fd
    });

    return res.status(200).json({ ok: true, id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: "Kunne ikke sende" });
  }
}
