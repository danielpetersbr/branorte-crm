Deno.serve((req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const now = new Date();

  const brDatetime = now.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const hour = parseInt(
    now.toLocaleString('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    })
  );

  const minute = parseInt(
    now.toLocaleString('en-US', {
      timeZone: 'America/Sao_Paulo',
      minute: 'numeric',
    })
  );

  const dayOfWeek = now.toLocaleString('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
  });

  const isBusinessDay = !['Saturday', 'Sunday'].includes(dayOfWeek);
  const timeDecimal = hour + minute / 60;
  const isBusinessHours = isBusinessDay && timeDecimal >= 7.5 && timeDecimal < 17.5;

  return new Response(
    JSON.stringify({
      datetime: brDatetime,
      hora: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      dia_semana: dayOfWeek,
      horario_comercial: isBusinessHours,
      instrucao: isBusinessHours
        ? 'HORARIO COMERCIAL: Proibido passar preco. Fazer triagem e transferir pro vendedor.'
        : 'FORA DO HORARIO: Fazer atendimento completo com precos (MODO 2) apos triagem.',
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
});