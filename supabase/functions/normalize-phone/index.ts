import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  try {
    const body = await req.json();
    const raw: string = body.numero || body.phone || body.whatsapp || "";

    // Strategy: find phone number in messy text
    // Step 1: Find chunks that look like phone numbers
    // Match: optional +55, then DDD (2 digits), then 8-9 digits, with any formatting
    // Also handles: "48 9 9831-3374", "(48) 99831-3374", "48998313374"
    
    // First: split by words, find segments that start with digit and have 8+ digits total
    const segments = raw.split(/[a-zA-ZÀ-ú]+/).filter(s => s.trim().length > 0);
    let bestDigits = "";
    
    for (const seg of segments) {
      const d = seg.replace(/[^0-9]/g, "");
      if (d.length >= 8 && d.length > bestDigits.length) {
        bestDigits = d;
      }
    }
    
    // If that didnt work, try: remove all letters, then extract digits
    if (bestDigits.length < 8) {
      const noLetters = raw.replace(/[a-zA-ZÀ-ú]/g, "");
      const d = noLetters.replace(/[^0-9]/g, "");
      if (d.length >= 8) {
        bestDigits = d;
      }
    }
    
    // Last resort: all digits from the string
    if (bestDigits.length < 8) {
      bestDigits = raw.replace(/[^0-9]/g, "");
    }

    let n = bestDigits;
    if (n.startsWith("0")) n = n.substring(1);

    // Normalize
    if (n.length === 13 && n.startsWith("55") && n.charAt(4) === "9") {
      n = "55" + n.substring(2, 4) + n.substring(5);
    } else if (n.length === 11 && n.charAt(2) === "9") {
      n = "55" + n.substring(0, 2) + n.substring(3);
    } else if (n.length === 10) {
      n = "55" + n;
    } else if (n.length === 12 && n.startsWith("55")) {
      // Already correct
    } else if (!n.startsWith("55")) {
      n = "55" + n;
    }

    return new Response(
      JSON.stringify({ numero_normalizado: n, valido: n.length === 12 && n.startsWith("55") }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Connection": "keep-alive" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
});