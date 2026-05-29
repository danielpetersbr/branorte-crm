import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const phone = url.searchParams.get("phone")?.replace(/[^0-9]/g, "");

  if (!phone) {
    return Response.redirect("https://mbranorte2.digisac.io/", 302);
  }

  const token = Deno.env.get("DIGISAC_API_TOKEN");

  try {
    const res = await fetch("https://mbranorte2.digisac.io/api/v1/contacts/list", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        where: { $or: { "data.number": { $iLike: `%${phone}%` } } },
        limit: 1,
      }),
    });

    if (!res.ok) {
      return Response.redirect("https://mbranorte2.digisac.io/", 302);
    }

    const data = await res.json();
    const contact = data?.data?.[0];

    if (!contact) {
      return Response.redirect("https://mbranorte2.digisac.io/", 302);
    }

    const ticketId = contact.currentTicketId;
    if (ticketId) {
      return Response.redirect(`https://mbranorte2.digisac.io/chats/${ticketId}`, 302);
    }

    const contactId = contact.id;
    return Response.redirect(`https://mbranorte2.digisac.io/contacts/${contactId}`, 302);

  } catch (err) {
    console.error("Error:", err);
    return Response.redirect("https://mbranorte2.digisac.io/", 302);
  }
});
